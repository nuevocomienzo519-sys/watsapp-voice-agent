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
 * Revisa ÚNICAMENTE los mensajes que escribió el cliente (nunca los del
 * asesor) para detectar si en algún punto de la conversación se presenta
 * con su nombre. Se usa solo cuando el cliente no estaba guardado con
 * nombre en el teléfono que exportó el chat (ver telefonoDelChat).
 * @param {string[]} mensajesCliente mensajes del cliente, en orden
 * @returns {Promise<string|null>} nombre detectado, o null si no se encontró
 */
async function detectarNombreClienteConIA(mensajesCliente) {
  if (!mensajesCliente || mensajesCliente.length === 0) return null;

  const conversacionCliente = mensajesCliente.map((t, i) => `${i + 1}. ${t}`).join('\n');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 200,
        system:
          'Vas a recibir ÚNICAMENTE los mensajes escritos por UNA persona (un ' +
          'cliente potencial) dentro de una conversación de ventas de bienes ' +
          'raíces por WhatsApp. Tu única tarea es detectar si esta persona, en ' +
          'algún momento de TODA la conversación, se presenta o dice su propio ' +
          'nombre (ej. "Hola, soy Juan Pérez", "Mi nombre es María", "Habla ' +
          'Carlos"). ' +
          'IMPORTANTE: si menciona el nombre de otra persona (un asesor de ' +
          'ventas, un familiar, otro contacto que le recomendó el proyecto, ' +
          'etc.), eso NO cuenta como su propio nombre — ignóralo por completo. ' +
          'Solo cuenta si es inequívocamente el nombre de quien está ' +
          'escribiendo estos mensajes. Si tienes cualquier duda, responde que ' +
          'no se encontró — mejor no asignar nombre que asignar uno ' +
          'equivocado. ' +
          'Responde ÚNICAMENTE con un JSON, sin texto adicional antes ni ' +
          'después, con esta forma exacta: ' +
          '{"nombre_encontrado": true|false, "nombre": "Nombre Apellido" o null}',
        messages: [{ role: 'user', content: conversacionCliente }],
      }),
    });
  } catch (err) {
    console.error('[chat-exportado] Error de red detectando nombre con IA:', err.message);
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`[chat-exportado] Error detectando nombre con IA: ${res.status} - ${body}`);
    return null;
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  const rawText = (textBlock?.text || '').trim();

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const { nombre_encontrado, nombre } = JSON.parse(jsonMatch[0]);
    if (nombre_encontrado && nombre && nombre.trim()) return nombre.trim();
    return null;
  } catch (err) {
    console.error(
      '[chat-exportado] No se pudo parsear la respuesta de detección de nombre:',
      err.message,
      '| respuesta cruda:',
      rawText
    );
    return null;
  }
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

  // Prioridad: el número detectado automáticamente del propio chat exportado
  // (remitente crudo, cuando el cliente no estaba guardado); si no se detectó
  // ahí, usa el que se haya escrito a mano en el texto del mensaje (caption).
  const telefono = datos.telefonoDelChat || extraerTelefono(textoMensaje);

  // Si el cliente no estaba guardado con nombre (nombreCliente quedó como
  // placeholder "Cliente XXXX"), intentamos detectar su nombre real
  // revisando TODA la conversación del cliente con IA, sin mezclarla nunca
  // con los mensajes del asesor.
  let nombreCliente = datos.nombreCliente;
  if (datos.telefonoDelChat) {
    try {
      const nombreDetectado = await detectarNombreClienteConIA(datos.mensajesCliente);
      if (nombreDetectado) {
        nombreCliente = nombreDetectado;
        console.log(`[chat-exportado] Nombre detectado con IA: "${nombreDetectado}"`);
      }
    } catch (err) {
      console.error('[chat-exportado] Error detectando nombre con IA:', err.message);
    }
  }

  const datosFinales = { ...datos, nombreCliente, telefono };

  const contacto = await crearContacto(nombreCliente, telefono);
  const negocio = await crearNegocio(datosFinales);
  await asociarContactoYNegocio(contacto.id, negocio.id);

  let chatWhatsappCreado = false;
  let errorChatWhatsapp = null;
  if (telefono) {
    try {
      await iniciarChatPorTelefono(telefono, MENSAJE_RETOMA_CONTACTO, nombreCliente);
      chatWhatsappCreado = true;
    } catch (err) {
      errorChatWhatsapp = err.message;
      console.error('[chat-exportado] No se pudo iniciar el chat de WhatsApp Business:', err.message);
    }
  }

  return { contacto, negocio, datos: { ...datosFinales, chatWhatsappCreado, errorChatWhatsapp } };
}

module.exports = { procesarChatExportado };
