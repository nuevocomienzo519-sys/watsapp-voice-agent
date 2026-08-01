/**
 * TimelinesAI ha tenido más de una forma de payload de webhook según el
 * plan y la versión (v1/v2). En vez de asumir una sola forma, esta función
 * intenta varias rutas conocidas/plausibles para cada campo, y si ninguna
 * funciona, devuelve null en ese campo en vez de tronar.
 *
 * Aun así: la ÚNICA forma de estar 100% seguro es ver un payload real.
 * Este archivo deja un log detallado la primera vez que llega un mensaje
 * (ver server.js) para que puedas confirmar o corregir el mapeo en minutos.
 */

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

/**
 * Normaliza el payload crudo del webhook a una forma estable:
 * { messageId, chatId, direction, attachment: { url, type, filename } | null }
 */
function parseTimelinesPayload(rawBody) {
  // Algunas cuentas envuelven el mensaje real en distintas llaves.
  const message = firstDefined(
    rawBody.message,
    rawBody.data?.message,
    rawBody.data,
    rawBody
  ) || {};

  const chat = firstDefined(message.chat, rawBody.chat) || {};

  const messageId = firstDefined(
    message.id,
    message.message_id,
  message.message_uid,
    message.messageId,
    message.uuid
  );

  const chatId = firstDefined(
    message.chat_id,
    message.chatId,
    chat.id,
    chat.chat_id
  );

  // "incoming"/"outgoing" en unas cuentas, is_from_me boolean en otras.
  let direction = firstDefined(message.direction, message.type_direction);
  if (direction === "received") direction = "incoming";
if (direction === "sent") direction = "outgoing";
  if (!direction && typeof message.is_from_me === "boolean") {
    direction = message.is_from_me ? "outgoing" : "incoming";
  }
  if (!direction && typeof message.from_me === "boolean") {
    direction = message.from_me ? "outgoing" : "incoming";
  }

  const rawAttachment = firstDefined(
    message.attachment,
    message.media,
    message.attachments?.[0],
    message.file
  );

  let attachment = null;
  if (rawAttachment) {
    const url = firstDefined(
      rawAttachment.url,
      rawAttachment.file_url,
      rawAttachment.download_url,
      rawAttachment.link
    );
    const type = firstDefined(rawAttachment.type, rawAttachment.mime_type, rawAttachment.content_type);
    const filename = firstDefined(rawAttachment.filename, rawAttachment.file_name, rawAttachment.name);
    if (url) {
      attachment = { url, type, filename };
    }
  }

  // Texto del mensaje (para mensajes que NO son nota de voz).
  const text = firstDefined(
    message.text,
    message.body,
    message.caption,
    message.content
  );
  const cleanText = typeof text === "string" ? text.trim() : null;

  return {
    messageId,
    chatId,
    direction,
    attachment,
    text: cleanText && cleanText.length > 0 ? cleanText : null,
    _raw: message,
  };
}

/**
 * ¿Este adjunto parece ser una nota de voz / audio?
 */
function isAudioAttachment(attachment) {
  if (!attachment) return false;
  const type = (attachment.type || "").toLowerCase();
  const url = attachment.url || "";
  const filename = attachment.filename || "";
  return (
    type.includes("audio") ||
    type.includes("ogg") ||
    type.includes("opus") ||
    /\.(ogg|mp3|m4a|opus|wav)(\?|$)/i.test(url) ||
    /\.(ogg|mp3|m4a|opus|wav)$/i.test(filename)
  );
}

module.exports = { parseTimelinesPayload, isAudioAttachment };
