require("dotenv").config();
const express = require("express");
const { downloadAttachment, sendVoiceMessage, sendTextMessage } = require("./lib/timelinesClient");
const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const { parseTimelinesPayload, isAudioAttachment } = require("./lib/timelinesPayload");
const { procesarChatExportado } = require("./lib/chatExportadoCore");
const extraerFotosRouter = require("./routes/extraerFotos");
const openaiProxyRouter = require("./routes/openaiProxy");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(extraerFotosRouter);
app.use(openaiProxyRouter);

// Evita procesar el mismo mensaje dos veces si TimelinesAI reintenta el webhook.
const processedMessageIds = new Set();

// Chats donde el agente NO debe responder automáticamente, salvo que el
// mensaje incluya la palabra clave de activación. Por ahora solo el grupo
// "Los Miguelines" (chat_id 57693202 en TimelinesAI).
const CHATS_SILENCIADOS = new Set([57693202]);
const PALABRA_ACTIVACION = "@asistentewaba";

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

    // --- FILTRO DE CHATS SILENCIADOS ---
    // Va ANTES de descargar adjuntos, transcribir audio, o procesar chat
    // exportado: nada de eso debe llamar a la API de TimelinesAI si el
    // chat está silenciado y no trae la palabra de activación.
    // Number(chatId) por seguridad: si chatId llega como string desde
    // parseTimelinesPayload, Set.has() con un number no lo detecta.
    const chatSilenciado = CHATS_SILENCIADOS.has(Number(chatId));
    let textoLimpio = text;

    if (chatSilenciado) {
      if (audioAdjunto) {
        // No transcribimos: no hay forma de saber si trae la palabra de
        // activación sin gastar la llamada de descarga/transcripción, así
        // que en chats silenciados las notas de voz se ignoran siempre.
        console.log(`Chat ${chatId} silenciado: se ignora nota de voz sin transcribir (no consume API).`);
        return;
      }

      const tieneActivacion =
        !!text && text.toLowerCase().includes(PALABRA_ACTIVACION.toLowerCase());

      if (!tieneActivacion) {
        console.log(`Chat ${chatId} silenciado, mensaje ignorado (sin palabra de activación).`);
        return;
      }

      textoLimpio = text.replace(new RegExp(PALABRA_ACTIVACION, "ig"), "").trim();

      // Si mandaron solo la palabra de activación, sin pregunta, le damos
      // un texto por defecto para que Claude no reciba un mensaje vacío.
      if (!textoLimpio) {
        textoLimpio = "Hola, ¿en qué puedo ayudarte?";
      }
    }
    // --- FIN FILTRO DE CHATS SILENCIADOS ---

    // Detección de "contacto exportado": basta con mandar el archivo
    // .zip/.txt del export de WhatsApp — ya no requiere ninguna palabra
    // clave en el mensaje. Se crea el contacto+negocio en HubSpot (etapa
    // "Base de datos") y se corta aquí, sin pasar por Whisper/Claude. El
    // texto del mensaje (si lo hay) se sigue usando como respaldo para el
    // teléfono manual (ver extraerTelefono en lib/parseChatExport.js).
    const esChatExportado =
      attachment?.filename &&
      /\.(zip|txt)$/i.test(attachment.filename);

    if (esChatExportado) {
      try {
        const archivo = await downloadAttachment(attachment.url);
        const { contacto, negocio, datos } = await procesarChatExportado(
          archivo,
          attachment.filename,
          textoLimpio,
          chatId
        );
        console.log(
          `[chat-exportado] Creado -> contacto ${contacto.id}, negocio ${negocio.id}, proyecto=${datos.proyecto}, asesor=${datos.asesorLabel}, telefono=${datos.telefono}`
        );
        const confirmacion =
          `📦 Archivo: ${datos.filenameOriginal}\n\n` +
          `✅ Cliente: ${datos.nombreCliente}\n` +
          (datos.proyecto
            ? `📁 Proyecto: ${datos.proyecto}\n`
            : `⚠️ Proyecto: no detectado, revisar manualmente\n`) +
          (datos.asesorLabel ? `🧑‍💼 Asesor: ${datos.asesorLabel}\n` : '') +
          `📍 Etapa: Base de datos (no se mueve sola, solo tú la cambias manualmente)\n\n` +
          `📎 ${datos.resumenAdjuntos}\n\n` +
          (datos.telefono
            ? datos.tarjetaEnviada
              ? '📇 Tarjeta de contacto compartida aquí mismo.'
              : `⚠️ No se pudo compartir la tarjeta de contacto (${datos.errorTarjeta}).`
            : '⚠️ No se detectó teléfono válido, agrégalo manualmente en HubSpot.');
        await sendTextMessage(chatId, confirmacion);
      } catch (err) {
        console.error("[chat-exportado] Error:", err);
        await sendTextMessage(chatId, `❌ No pude procesar el chat exportado: ${err.message}`);
      }
      return;
    }

    // El mensaje debe ser nota de voz O texto; si no es ninguno de los
    // dos (ej. imagen, ubicación, sticker), lo ignoramos por ahora.
    if (!audioAdjunto && !textoLimpio) {
      return;
    }

    const inputMode = audioAdjunto ? "audio" : "text";
    let userText;

    if (inputMode === "audio") {
      // 2a. Descargar y transcribir la nota de voz del cliente
      // (nunca llega aquí si el chat está silenciado: se filtró arriba)
      const audioIn = await downloadAttachment(attachment.url);
      userText = await transcribeAudio(audioIn, attachment.filename || "nota.ogg");
      console.log("Transcripción:", userText);
    } else {
      // 2b. Mensaje de texto: se usa directo, sin Whisper.
      userText = textoLimpio;
      console.log("Texto recibido:", userText);
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

// Endpoint temporal para extraer y descargar en .zip las fotos de un día
// específico en un chat/grupo de TimelinesAI. Ver routes/extraerFotos.js
// para el detalle — se usa entrando directo desde el navegador a
// /extraer-fotos?secret=TU_WEBHOOK_SECRET

// Página temporal para conectar el número de WhatsApp a la Cloud API vía
// Embedded Signup, con la opción de coexistencia (mantener la app normal
// de WhatsApp Business funcionando a la par). Solo se usa una vez durante
// la migración; se puede quitar después si se quiere.
app.get("/conectar-whatsapp", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Conectar WhatsApp - Nuevo Comienzo</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center; }
    button { background: #25D366; color: white; border: none; padding: 14px 28px; font-size: 16px; border-radius: 6px; cursor: pointer; }
    button:hover { background: #1ebe5b; }
    #resultado { margin-top: 20px; text-align: left; white-space: pre-wrap; background: #f4f4f4; padding: 12px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Conectar número de WhatsApp</h2>
  <p>Da clic al botón y sigue el flujo. Cuando te pregunte, elige la opción de conectar tu cuenta existente de WhatsApp Business app.</p>
  <button onclick="launchWhatsAppSignup()">Conectar WhatsApp</button>
  <div id="resultado"></div>

  <script>
    window.fbAsyncInit = function () {
      FB.init({
        appId: '1068574982377434',
        cookie: true,
        xfbml: true,
        version: 'v22.0',
      });
    };
    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s);
      js.id = id;
      js.src = 'https://connect.facebook.net/es_LA/sdk.js';
      fjs.parentNode.insertBefore(js, fjs);
    })(document, 'script', 'facebook-jssdk');

    // Captura los datos que WhatsApp manda por postMessage al completar el flujo
    window.addEventListener('message', (event) => {
      if (!event.origin.includes('facebook.com')) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          document.getElementById('resultado').textContent =
            'Datos recibidos de WhatsApp:\\n' + JSON.stringify(data, null, 2);
        }
      } catch (e) {
        // ignorar mensajes que no son JSON
      }
    });

    function launchWhatsAppSignup() {
      FB.login(
        function (response) {
          if (response.status === 'connected' && response.authResponse) {
            const code = response.authResponse.code;
            document.getElementById('resultado').textContent =
              'Código de autorización recibido:\\n' + code +
              '\\n\\nManda captura de esto.';
          } else {
            document.getElementById('resultado').textContent = 'Cancelaste el inicio de sesión o no autorizaste todo.';
          }
        },
        {
          config_id: '3312158045654863',
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            sessionInfoVersion: 3,
            featureType: 'whatsapp_business_app_onboarding',
          },
        }
      );
    }
  </script>
</body>
</html>`);
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
  console.log(
    `URL de webhook a registrar en TimelinesAI: https://TU-DOMINIO/webhooks/timelines?secret=${process.env.WEBHOOK_SECRET}`
  );
});
