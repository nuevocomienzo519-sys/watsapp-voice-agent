const fetch = require("node-fetch");
const FormData = require("form-data");

const BASE = process.env.TIMELINES_API_BASE;
const TOKEN = process.env.TIMELINES_API_TOKEN;

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    ...extra,
  };
}

/**
 * Descarga el archivo adjunto (nota de voz) de un mensaje de TimelinesAI.
 * @param {string} attachmentUrl - URL del adjunto que viene en el payload del webhook.
 * @returns {Promise<Buffer>}
 */
async function downloadAttachment(attachmentUrl) {
  const res = await fetch(attachmentUrl);
  if (!res.ok) {
    throw new Error(
      `No se pudo descargar el adjunto de TimelinesAI: ${res.status} ${res.statusText}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Envía un mensaje de voz (audio) de vuelta al mismo chat.
 *
 * IMPORTANTE: para que WhatsApp lo muestre como nota de voz nativa (burbuja
 * redonda reproducible) y no como un archivo adjunto genérico, el adjunto
 * tiene que subirse con el content-type EXACTO "audio/ogg; codecs=opus".
 * Si se sube sin content-type (o con uno genérico como
 * application/octet-stream), WhatsApp lo entrega como documento descargable
 * en vez de nota de voz reproducible — eso es lo que causaba el problema.
 *
 * @param {string} chatId - ID del chat de TimelinesAI (viene en el payload del webhook).
 * @param {Buffer} audioBuffer - Audio ya convertido a ogg/opus.
 * @param {string} filename
 */
async function sendVoiceMessage(chatId, audioBuffer, filename = "respuesta.ogg") {
  const form = new FormData();
  form.append("file", audioBuffer, {
    filename,
    contentType: "audio/ogg; codecs=opus",
  });

  const res = await fetch(`${BASE}/chats/${chatId}/messages`, {
    method: "POST",
    headers: authHeaders(form.getHeaders()),
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Fallo al enviar el mensaje de voz por TimelinesAI: ${res.status} - ${body}`
    );
  }
  return res.json();
}

/**
 * Envía un mensaje de texto de vuelta al mismo chat.
 * @param {string} chatId - ID del chat de TimelinesAI.
 * @param {string} text - Texto a enviar.
 */
async function sendTextMessage(chatId, text) {
  const res = await fetch(`${BASE}/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Fallo al enviar el mensaje de texto por TimelinesAI: ${res.status} - ${body}`
    );
  }
  return res.json();
}

module.exports = { downloadAttachment, sendVoiceMessage, sendTextMessage };
