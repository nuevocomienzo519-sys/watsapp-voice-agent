/**
 * Normaliza el payload del webhook de WhatsApp Cloud API (Meta) a la MISMA
 * forma que ya devolvía parseTimelinesPayload, para que el resto de
 * server.js (toda la lógica de negocio: HubSpot, asesores, intenciones,
 * etc.) no tenga que cambiar:
 *   { messageId, chatId, direction, phone, senderName,
 *     attachment: {url, type, filename} | null, text }
 *
 * Diferencias importantes de SIGNIFICADO a tener en cuenta:
 * - chatId aquí es en realidad el número de WhatsApp del remitente, en
 *   formato E.164 SIN el "+" (ej. "5214721234567") — así es como la Cloud
 *   API pide el campo "to" al responder. Meta no tiene concepto de "chat"
 *   separado del número, a diferencia de TimelinesAI.
 * - attachment.url aquí NO es una URL descargable directamente: es el
 *   media ID que entrega Meta. whatsappCloudClient.downloadAttachment() ya
 *   sabe resolver ese ID en dos pasos, así que el resto del código puede
 *   seguir llamándolo igual (downloadAttachment(attachment.url)).
 * - direction siempre es "incoming": Meta solo manda webhooks de mensajes
 *   que el cliente te escribió, nunca de tus propias respuestas salientes
 *   (a diferencia de TimelinesAI, que sincroniza ambos sentidos).
 */
function parseWhatsappCloudPayload(rawBody) {
  const entry = rawBody?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  // Webhooks de "status" (✓✓ entregado/leído, o de plantillas) no traen
  // "messages" — no son mensajes nuevos del cliente, se ignoran.
  const message = value?.messages?.[0];
  if (!message) {
    return {
      messageId: null,
      chatId: null,
      direction: null,
      phone: null,
      senderName: null,
      attachment: null,
      text: null,
      _raw: rawBody,
    };
  }

  const contact = value?.contacts?.[0];
  const fromPhoneRaw = message.from; // ej. "5214721234567" (sin "+")
  const phone = fromPhoneRaw ? `+${fromPhoneRaw}` : null;
  const senderName = contact?.profile?.name || null;

  let attachment = null;
  let text = null;

  switch (message.type) {
    case "text":
      text = message.text?.body || null;
      break;
    case "audio":
      attachment = {
        url: message.audio?.id,
        type: message.audio?.mime_type || "audio/ogg",
        filename: "audio.ogg",
      };
      break;
    case "image":
      attachment = {
        url: message.image?.id,
        type: message.image?.mime_type || "image/jpeg",
        filename: "imagen.jpg",
      };
      text = message.image?.caption || null;
      break;
    case "video":
      attachment = {
        url: message.video?.id,
        type: message.video?.mime_type || "video/mp4",
        filename: "video.mp4",
      };
      text = message.video?.caption || null;
      break;
    case "document":
      attachment = {
        url: message.document?.id,
        type: message.document?.mime_type || "application/octet-stream",
        filename: message.document?.filename || "documento",
      };
      text = message.document?.caption || null;
      break;
    default:
      // sticker, location, contacts, reaction, button, interactive, etc. —
      // no manejados todavía; llega sin texto ni adjunto reconocido.
      break;
  }

  return {
    messageId: message.id || null,
    chatId: fromPhoneRaw || null, // SIN "+": así lo pide la Cloud API en "to"
    direction: "incoming",
    phone,
    senderName,
    attachment,
    text: text && text.trim().length > 0 ? text.trim() : null,
    _raw: message,
  };
}

/**
 * ¿Este adjunto parece ser una nota de voz / audio?
 */
function isAudioAttachment(attachment) {
  if (!attachment) return false;
  const type = (attachment.type || "").toLowerCase();
  return type.includes("audio") || type.includes("ogg") || type.includes("opus");
}

module.exports = { parseWhatsappCloudPayload, isAudioAttachment };
