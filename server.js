require("dotenv").config();
const express = require("express");
const { downloadAttachment, sendVoiceMessage, sendTextMessage } = require("./lib/timelinesClient");
const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const { parseTimelinesPayload, isAudioAttachment } = require("./lib/timelinesPayload");

const app = express();
app.use(express.json({ limit: "20mb" }));

// Evita procesar el mismo mensaje dos veces si TimelinesAI reintenta el webhook.
const processedMessageIds = new Set();

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

    const { messageId, chatId, direction, attachment, text } = parseTimelinesPayload(req.body);

    if (!messageId || processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);

    if (direction !== "incoming" || !chatId) {
      return; // ignoramos mensajes salientes propios, eventos sin chat, etc.
    }

    const audioAdjunto = isAudioAttachment(attachment);

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

    // 3. Generar la respuesta con Claude (decide también el formato de salida)
    const { formato, texto: replyText } = await generateReply(userText, inputMode);
    console.log(`Respuesta generada [formato: ${formato}]:`, replyText);

    // 4. Enviar la respuesta en el formato decidido
    if (formato === "voz") {
      const audioMp3 = await synthesizeSpeech(replyText);
      // Convertir a ogg/opus para que WhatsApp lo muestre como nota de
      // voz (con forma de onda) en vez de un archivo adjunto genérico.
      const audioOgg = await convertToOggOpus(audioMp3);
      await sendVoiceMessage(chatId, audioOgg, "respuesta.ogg");
      console.log(`Respuesta de voz enviada al chat ${chatId}`);
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
