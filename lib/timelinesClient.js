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
 * IMPORTANTE: TimelinesAI tiene un endpoint DEDICADO para notas de voz
 * (/chats/{chat_id}/voice_message), separado del endpoint genérico de
 * mensajes (/chats/{chat_id}/messages). Solo el endpoint dedicado hace que
 * WhatsApp lo entregue como nota de voz nativa (burbuja redonda
 * reproducible); el endpoint genérico lo entrega como archivo adjunto
 * normal, aunque el content-type sea correcto. Acepta ogg, oga o mp3.
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
  const res = await fetch(`${BASE}/chats/${chatId}/voice_message`, {
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

/**
 * Inicia un chat NUEVO mandando un mensaje directo a un número de teléfono
 * (funciona aunque ese número nunca le haya escrito antes a este WhatsApp
 * Business). Usa el endpoint genérico /messages (no /chats/{id}/messages,
 * que requiere que el chat ya exista).
 *
 * @param {string} phone - Teléfono en formato +52XXXXXXXXXX.
 * @param {string} text - Mensaje inicial a enviar.
 * @param {string} chatName - Nombre para identificar el chat nuevo en WhatsApp Business/TimelinesAI.
 */
async function iniciarChatPorTelefono(phone, text, chatName) {
  const body = { phone, text };
  if (chatName) body.chat_name = chatName;

  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(
      `Fallo al iniciar chat por teléfono en TimelinesAI: ${res.status} - ${bodyText}`
    );
  }
  return res.json();
}

module.exports = {
  downloadAttachment,
  sendVoiceMessage,
  sendTextMessage,
  iniciarChatPorTelefono,
};
