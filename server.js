require("dotenv").config();
const express = require("express");
const { downloadAttachment, sendVoiceMessage, sendTextMessage } = require("./lib/timelinesClient");
const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const { parseTimelinesPayload, isAudioAttachment } = require("./lib/timelinesPayload");
const { procesarChatExportado } = require("./lib/chatExportadoCore");

const app = express();
app.use(express.json({ limit: "20mb" }));

// Evita procesar el mismo mensaje dos veces si TimelinesAI reintenta el webhook.
const processedMessageIds = new Set();

// Chats donde el agente NO debe responder automáticamente, salvo que el
// mensaje incluya la palabra clave de activación. Por ahora solo el grupo
// "Los Miguelines" (chat_id 57693202 en TimelinesAI).
const CHATS_SILENCIADOS = new Set([57693202]);
const PALABRA_ACTIVACION = "@asistentewaba";

// Palabra clave para disparar la creación automática en HubSpot de un
// chat exportado de WhatsApp (zip o txt) mandado directo por este canal.
const PALABRA_CLAVE_CHAT_EXPORTADO = /contacto\s+exportado/i;

// Historial de conversación por chat, para que Claude recuerde el
// contexto entre mensajes. Se guarda en memoria del proceso: se
// reinicia si el servicio se reinicia o redespliega en Render.
const conversationHistory = new Map();
const MAX_HISTORY_MESSAGES = 20; // ~10 turnos (usuario + asistente)

function getHistory(chatId) {
  return conversationHistory.get(chatId) || [];
}

function appendHistory(chatId, userText, replyText) {
  const historial = getHistory(chatId);
  historial.push({ role: "user", content: userText });
  historial.push({ role: "assistant", content: replyText });
  while (historial.length > MAX_HISTORY_MESSAGES) historial.shift();
  conversationHistory.set(chatId, historial);
}

app.post("/webhooks/timelines", async (req, res) => {
  // 1. Verificación básica del secreto compartido
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send("No autorizado");
  }

  // Responde rápido a TimelinesAI para que no reintente por timeout;
  // el procesamiento real sigue después, de forma asíncrona.
  res.status(200).send("OK");

  try {
    // Log completo del payload. Déjalo activo las primeras semanas: si
    // algo del mapeo de abajo no aplica a tu cuenta, aquí está la fuente
    // de verdad para corregirlo en lib/timelinesPayload.js.
    console.log("Payload recibido de TimelinesAI:", JSON.stringify(req.body, null, 2));

    const { messageId, chatId, direction, phone, attachment, text } = parseTimelinesPayload(req.body);
    const senderName = req.body?.message?.sender?.full_name || null;

    if (!messageId || processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);

    if (direction !== "incoming" || !chatId) {
      return; // ignoramos mensajes salientes propios, eventos sin chat, etc.
    }

    const audioAdjunto = isAudioAttachment(attachment);

    // Detección de "contacto exportado": si el mensaje trae la palabra
    // clave y un adjunto zip/txt, se crea el contacto+negocio en HubSpot
    // (etapa "Base de datos") y se corta aquí, sin pasar por Whisper/Claude.
    const esChatExportado =
      text &&
      PALABRA_CLAVE_CHAT_EXPORTADO.test(text) &&
      attachment?.filename &&
      /\.(zip|txt)$/i.test(attachment.filename);

    if (esChatExportado) {
      try {
        const archivo = await downloadAttachment(attachment.url);
        const { contacto, negocio, datos } = await procesarChatExportado(archivo, attachment.filename, text);
        console.log(
          `[chat-exportado] Creado -> contacto ${contacto.id}, negocio ${negocio.id}, proyecto=${datos.proyecto}, asesor=${datos.asesorLabel}, telefono=${datos.telefono}`
        );
        const confirmacion =
          `Listo ✅ Cliente "${datos.nombreCliente}" creado en Base de datos` +
          (datos.proyecto ? ` (proyecto: ${datos.proyecto})` : ' — no detecté el proyecto, revísalo manualmente') +
          (datos.telefono
            ? `. Teléfono guardado: ${datos.telefono}. ` +
              (datos.chatWhatsappCreado
                ? 'Chat de WhatsApp Business iniciado con mensaje de retoma de contacto.'
                : `No se pudo iniciar el chat de WhatsApp (${datos.errorChatWhatsapp}).`)
            : '. No incluiste un teléfono válido, agrégalo manualmente (así tampoco se pudo iniciar el chat de WhatsApp).');
        await sendTextMessage(chatId, confirmacion);
      } catch (err) {
        console.error("[chat-exportado] Error:", err);
        await sendTextMessage(chatId, `❌ No pude procesar el chat exportado: ${err.message}`);
      }
      return;
    }

    // El mensaje debe ser nota de voz O texto; si no es ninguno de los
    // dos (ej. imagen, ubicación, sticker), lo ignoramos por ahora.
    if (!audioAdjunto && !text) {
      return;
    }

    const inputMode = audioAdjunto ? "audio" : "text";
    let userText;

    if (inputMode === "audio") {
      // 2a. Descargar y transcribir la nota de voz del cliente
      const audioIn = await downloadAttachment(attachment.url);
      userText = await transcribeAudio(audioIn, attachment.filename || "nota.ogg");
      console.log("Transcripción:", userText);
    } else {
      // 2b. Mensaje de texto: se usa directo, sin Whisper.
      userText = text;
      console.log("Texto recibido:", userText);
    }

    // Chats silenciados: se ignora todo, salvo que el mensaje incluya la
    // palabra clave de activación (en ese caso se le quita la palabra
    // antes de mandarlo a Claude, para que no confunda la respuesta).
    if (CHATS_SILENCIADOS.has(chatId)) {
      const tieneActivacion = userText
        .toLowerCase()
        .includes(PALABRA_ACTIVACION.toLowerCase());

      if (!tieneActivacion) {
        console.log(`Chat ${chatId} silenciado, mensaje ignorado (sin palabra de activación).`);
        return;
      }

      userText = userText.replace(new RegExp(PALABRA_ACTIVACION, "ig"), "").trim();

      // Si mandaron solo la palabra de activación, sin pregunta, le damos
      // un texto por defecto para que Claude no reciba un mensaje vacío.
      if (!userText) {
        userText = "Hola, ¿en qué puedo ayudarte?";
      }
    }

    // 3. Generar la respuesta con Claude (decide también el formato de
    // salida, y de paso crea en HubSpot la tarea de seguimiento si detecta
    // una cita agendada o una solicitud de información específica, y
    // actualiza el nombre del contacto si hace falta).
    // Le mandamos el historial de esta conversación para que recuerde
    // el contexto entre mensajes.
    const { formato, texto: replyText, resumen } = await generateReply(
      userText,
      inputMode,
      { chatId, phone, senderName },
      getHistory(chatId)
    );
    console.log(`Respuesta generada [formato: ${formato}]:`, replyText);

    appendHistory(chatId, userText, replyText);

    // 4. Enviar la respuesta en el formato decidido.
    // "voz_y_texto": se manda la respuesta completa en audio Y un texto
    // breve con el resumen (precios/listas), en el mismo turno.
    if (formato === "voz" || formato === "voz_y_texto") {
      const audioMp3 = await synthesizeSpeech(replyText);
      // Convertir a ogg/opus para que WhatsApp lo muestre como nota de
      // voz (con forma de onda) en vez de un archivo adjunto genérico.
      const audioOgg = await convertToOggOpus(audioMp3);
      await sendVoiceMessage(chatId, audioOgg, "respuesta.ogg");
      console.log(`Respuesta de voz enviada al chat ${chatId}`);

      if (formato === "voz_y_texto" && resumen) {
        await sendTextMessage(chatId, resumen);
        console.log(`Resumen de texto enviado al chat ${chatId}`);
      }
    } else {
      await sendTextMessage(chatId, replyText);
      console.log(`Respuesta de texto enviada al chat ${chatId}`);
    }
  } catch (err) {
    console.error("Error procesando el mensaje:", err);
  }
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
  console.log(
    `URL de webhook a registrar en TimelinesAI: https://TU-DOMINIO/webhooks/timelines?secret=${process.env.WEBHOOK_SECRET}`
  );
});
