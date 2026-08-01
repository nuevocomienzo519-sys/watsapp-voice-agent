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
  const res = await fetch(attachmentUrl, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(
      `No se pudo descargar el adjunto de TimelinesAI: ${res.status} ${res.statusText}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Envía un mensaje de voz (audio) de vuelta al mismo chat.
 * @param {string} chatId - ID del chat de TimelinesAI (viene en el payload del webhook).
 * @param {Buffer} audioBuffer - Audio ya sintetizado (mp3 u ogg).
 * @param {string} filename
 */
async function sendVoiceMessage(chatId, audioBuffer, filename = "respuesta.mp3") {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("file", audioBuffer, { filename });

  const res = await fetch(`${BASE}/messages`, {
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
 *
 * Nota: si tu cuenta de TimelinesAI espera otro nombre de campo para el
 * texto (algunas cuentas usan "message" en vez de "text"), este es el
 * lugar para ajustarlo — revisa la respuesta de error en el log si falla.
 */
async function sendTextMessage(chatId, text) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("text", text);

  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: authHeaders(form.getHeaders()),
    body: form,
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
