// lib/chatExportadoCore.js
// Lógica compartida para convertir un chat exportado de WhatsApp (zip o txt) en
// contacto + negocio de HubSpot. La usan routes/chatExportado.js (entrada por Drive)
// y el detector dentro del webhook de WhatsApp (entrada directa por chat).

const AdmZip = require('adm-zip');
const { parseChatExport } = require('./parseChatExport');

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_API = 'https://api.hubapi.com';
const PIPELINE_ID = 'default';
const ETAPA_BASE_DE_DATOS = '1414280089';

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

async function crearContacto(nombreCompleto) {
  const [firstname, ...resto] = nombreCompleto.split(' ');
  const lastname = resto.join(' ') || '';
  return hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties: { firstname, lastname } }),
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
 */
async function procesarChatExportado(buffer, filename = '') {
  const rawText = extraerTextoChat(buffer, filename);
  const datos = parseChatExport(rawText);

  const contacto = await crearContacto(datos.nombreCliente);
  const negocio = await crearNegocio(datos);
  await asociarContactoYNegocio(contacto.id, negocio.id);

  return { contacto, negocio, datos };
}

module.exports = { procesarChatExportado };
