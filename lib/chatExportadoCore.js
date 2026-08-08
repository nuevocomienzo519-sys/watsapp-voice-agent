// lib/chatExportadoCore.js
// Lógica compartida para convertir un chat exportado de WhatsApp (zip o txt) en
// contacto + negocio de HubSpot. La usan routes/chatExportado.js (entrada por Drive)
// y el detector dentro del webhook de WhatsApp (entrada directa por chat).

const AdmZip = require('adm-zip');
const { parseChatExport, extraerTelefono } = require('./parseChatExport');
const { iniciarChatPorTelefono } = require('./timelinesClient');

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_API = 'https://api.hubapi.com';
const PIPELINE_ID = 'default';
const ETAPA_BASE_DE_DATOS = '1414280089';

const MENSAJE_RETOMA_CONTACTO =
  '¡Hola! 👋 Soy del equipo de Nuevo Comienzo. Tenemos tu información de una conversación anterior sobre nuestros desarrollos Diamante y Santuario en Franco, Silao. Queríamos retomar el contacto por si sigues interesado(a) — cuéntame si te gustaría conocer disponibilidad y precios actualizados, o si prefieres que no te contactemos más. ¡Quedo al pendiente!';

async function hubspotFetch(path, options = {}) {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function crearContacto(nombreCompleto, telefono) {
  const [firstname, ...resto] = nombreCompleto.split(' ');
  const lastname = resto.join(' ') || '';
  const properties = { firstname, lastname };
  if (telefono) properties.phone = telefono;
  return hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function crearNegocio({ nombreCliente, proyecto, asesor }) {
  const properties = {
    dealname: `${nombreCliente}${proyecto ? ' - ' + proyecto : ''}`,
    pipeline: PIPELINE_ID,
    dealstage: ETAPA_BASE_DE_DATOS,
  };
  if (proyecto) properties.proyecto = proyecto;
  if (asesor) properties.asesor = asesor;
  return hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function asociarContactoYNegocio(contactId, dealId) {
  await hubspotFetch(
    `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`,
    { method: 'PUT' }
  );
}

/**
 * Extrae el texto del chat.txt a partir de un Buffer, sea zip o txt plano.
 */
function extraerTextoChat(buffer, filename = '') {
  const pareceZip = /\.zip$/i.test(filename) || buffer.slice(0, 2).toString() === 'PK';
  if (pareceZip) {
    const zip = new AdmZip(buffer);
    // El export de iPhone nombra el archivo "_chat.txt"; el de Android lo
    // nombra distinto (ej. "WhatsApp Chat with X.txt"). Buscamos cualquier
    // .txt, prefiriendo uno que contenga "chat" en el nombre si hay varios.
    const entradasTxt = zip.getEntries().filter((e) => /\.txt$/i.test(e.entryName));
    const entry =
      entradasTxt.find((e) => /chat/i.test(e.entryName)) || entradasTxt[0];
    if (!entry) throw new Error('El ZIP no trae ningún archivo .txt');
    return entry.getData().toString('utf8');
  }
  return buffer.toString('utf8'); // ya es el .txt directo
}

/**
 * Punto de entrada único: buffer del archivo (zip o txt) -> contacto + negocio creados.
 * @param {Buffer} buffer contenido del archivo (zip o txt)
 * @param {string} filename nombre del archivo, para saber si es zip o txt
 * @param {string} textoMensaje texto completo del mensaje de WhatsApp (caption), para
 *   extraer el teléfono si el usuario lo incluyó (ej. "contacto exportado 4721234567")
 */
async function procesarChatExportado(buffer, filename = '', textoMensaje = '') {
  const rawText = extraerTextoChat(buffer, filename);
  const datos = parseChatExport(rawText);
  const telefono = extraerTelefono(textoMensaje);

  const contacto = await crearContacto(datos.nombreCliente, telefono);
  const negocio = await crearNegocio(datos);
  await asociarContactoYNegocio(contacto.id, negocio.id);

  let chatWhatsappCreado = false;
  let errorChatWhatsapp = null;
  if (telefono) {
    try {
      await iniciarChatPorTelefono(telefono, MENSAJE_RETOMA_CONTACTO, datos.nombreCliente);
      chatWhatsappCreado = true;
    } catch (err) {
      errorChatWhatsapp = err.message;
      console.error('[chat-exportado] No se pudo iniciar el chat de WhatsApp Business:', err.message);
    }
  }

  return { contacto, negocio, datos: { ...datos, telefono, chatWhatsappCreado, errorChatWhatsapp } };
}

module.exports = { procesarChatExportado };
