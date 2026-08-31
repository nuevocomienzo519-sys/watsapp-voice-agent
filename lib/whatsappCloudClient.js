const fetch = require("node-fetch");
const FormData = require("form-data");

const GRAPH_VERSION = "v20.0";
const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function downloadAttachment(mediaId) {
    const resInfo = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
          headers: authHeaders(),
    });
    if (!resInfo.ok) {
          throw new Error(
                  `No se pudo resolver el adjunto de WhatsApp: ${resInfo.status} ${await resInfo.text()}`
                );
    }
    const { url } = await resInfo.json();
    const resFile = await fetch(url, { headers: authHeaders() });
    if (!resFile.ok) {
          throw new Error(
                  `No se pudo descargar el adjunto de WhatsApp: ${resFile.status} ${resFile.statusText}`
                );
    }
    return Buffer.from(await resFile.arrayBuffer());
}

async function subirMediaAudio(audioBuffer, filename) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", audioBuffer, { filename, contentType: "audio/ogg; codecs=opus" });
    const res = await fetch(`${BASE}/media`, {
          method: "POST",
          headers: authHeaders(form.getHeaders()),
          body: form,
    });
    if (!res.ok) {
          throw new Error(`Fallo al subir el audio a WhatsApp: ${res.status} - ${await res.text()}`);
    }
    const json = await res.json();
    return json.id;
}

async function sendVoiceMessage(to, audioBuffer, filename = "respuesta.ogg") {
    const mediaId = await subirMediaAudio(audioBuffer, filename);
    const res = await fetch(`${BASE}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to,
                  type: "audio",
                  audio: { id: mediaId },
          }),
    });
    if (!res.ok) {
          throw new Error(
                  `Fallo al enviar el mensaje de voz por WhatsApp: ${res.status} - ${await res.text()}`
                );
    }
    return res.json();
}

async function sendTextMessage(to, text) {
    const res = await fetch(`${BASE}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to,
                  type: "text",
                  text: { body: text, preview_url: false },
          }),
    });
    if (!res.ok) {
          throw new Error(
                  `Fallo al enviar el mensaje de texto por WhatsApp: ${res.status} - ${await res.text()}`
                );
    }
    return res.json();
}

async function sendImageMessage(to, imageUrl, caption) {
    const res = await fetch(`${BASE}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to,
                  type: "image",
                  image: { link: imageUrl, caption: caption || undefined },
          }),
    });
    if (!res.ok) {
          throw new Error(
                  `Fallo al enviar la imagen por WhatsApp: ${res.status} - ${await res.text()}`
                );
    }
    return res.json();
}

async function enviarMensajePlantilla(to, nombrePlantilla, idioma, parametros = []) {
    const res = await fetch(`${BASE}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to,
                  type: "template",
                  template: {
                            name: nombrePlantilla,
                            language: { code: idioma || "es_MX" },
                            components: parametros.length
                              ? [{ type: "body", parameters: parametros.map((texto) => ({ type: "text", text: texto })) }]
                                        : undefined,
                  },
          }),
    });
    if (!res.ok) {
          throw new Error(
                  `Fallo al enviar la plantilla por WhatsApp: ${res.status} - ${await res.text()}`
                );
    }
    return res.json();
}

module.exports = {
    downloadAttachment,
    sendVoiceMessage,
    sendTextMessage,
    sendImageMessage,
    enviarMensajePlantilla,
};
