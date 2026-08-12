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

/**
 * Sube un archivo (ej. una tarjeta de contacto .vcf) al workspace de
 * TimelinesAI para poder mandarlo después como adjunto en un mensaje. La
 * subida en sí NO consume crédito de mensajes — solo el envío del mensaje
 * que lo referencia (ver enviarAdjuntoAChat).
 *
 * @param {Buffer} buffer - Contenido del archivo.
 * @param {string} filename - Nombre del archivo (ej. "Fernanda_Angel.vcf").
 * @param {string} contentType - Mime-type (ej. "text/vcard").
 * @returns {Promise<{uid: string, filename: string, size: number, mimetype: string}>}
 */
async function subirArchivoTimelinesAI(buffer, filename, contentType) {
  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType,
  });
  const res = await fetch(`${BASE}/files_upload`, {
    method: "POST",
    headers: authHeaders(form.getHeaders()),
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Fallo al subir el archivo a TimelinesAI: ${res.status} - ${body}`
    );
  }
  const json = await res.json();
  return json.data;
}

/**
 * Manda un archivo ya subido (por file_uid) como adjunto dentro de un chat
 * EXISTENTE — a diferencia de iniciarChatPorTelefono, esto es una
 * respuesta dentro de una conversación que ya existe (ej. donde te
 * mandaron el chat exportado), no un mensaje nuevo a un número.
 *
 * @param {string} chatId - ID del chat de TimelinesAI.
 * @param {string} fileUid - uid regresado por subirArchivoTimelinesAI.
 * @param {string} [texto] - Texto opcional para acompañar el adjunto.
 */
async function enviarAdjuntoAChat(chatId, fileUid, texto) {
  const payload = { file_uid: fileUid };
  if (texto) payload.text = texto;
  const res = await fetch(`${BASE}/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Fallo al enviar el adjunto por TimelinesAI: ${res.status} - ${body}`
    );
  }
  return res.json();
}

module.exports = {
  downloadAttachment,
  sendVoiceMessage,
  sendTextMessage,
  iniciarChatPorTelefono,
  subirArchivoTimelinesAI,
  enviarAdjuntoAChat,
};
