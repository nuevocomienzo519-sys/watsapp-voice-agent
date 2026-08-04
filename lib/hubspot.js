const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_BASE = "https://api.hubapi.com";

async function hubspotRequest(path, options = {}) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${body}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

/**
 * Busca un contacto de HubSpot por número de teléfono.
 * @param {string} phone - Teléfono en cualquier formato (con o sin +).
 * @returns {Promise<{id: string}|null>}
 */
async function findContactByPhone(phone) {
  if (!phone) return null;
  const cleanPhone = phone.replace(/[^\d]/g, "");
  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: "phone", operator: "CONTAINS_TOKEN", value: cleanPhone },
        ],
      },
    ],
    properties: ["firstname", "lastname", "phone"],
    limit: 1,
  };
  const data = await hubspotRequest("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data && data.results && data.results[0] ? data.results[0] : null;
}

/**
 * Crea una tarea en HubSpot, opcionalmente asociada a un contacto existente.
 * @param {Object} params
 * @param {string} params.subject - Título corto de la tarea.
 * @param {string} params.body - Detalle/objetivo de la tarea.
 * @param {string} [params.contactId] - ID del contacto de HubSpot a asociar.
 * @param {"LOW"|"MEDIUM"|"HIGH"} [params.priority]
 */
async function createTask({ subject, body, contactId, priority = "MEDIUM" }) {
  const payload = {
    properties: {
      hs_task_subject: subject,
      hs_task_body: body,
      hs_task_status: "NOT_STARTED",
      hs_task_priority: priority,
      hs_timestamp: Date.now(),
    },
  };
  if (contactId) {
    payload.associations = [
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 204, // Task -> Contact
          },
        ],
      },
    ];
  }
  return hubspotRequest("/crm/v3/objects/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Busca el deal más reciente asociado a un contacto.
 * @param {string} contactId
 * @returns {Promise<{id: string, properties: object}|null>}
 */
async function findDealByContactId(contactId) {
  if (!contactId) return null;
  const data = await hubspotRequest(
    `/crm/v3/objects/contacts/${contactId}/associations/deals`
  );
  if (!data || !data.results || data.results.length === 0) return null;

  const dealIds = data.results.map((r) => r.id);
  const deals = await Promise.all(
    dealIds.map((id) =>
      hubspotRequest(
        `/crm/v3/objects/deals/${id}?properties=dealstage,proyecto,asesor,hs_lastmodifieddate`
      )
    )
  );
  deals.sort(
    (a, b) =>
      new Date(b.properties.hs_lastmodifieddate) -
      new Date(a.properties.hs_lastmodifieddate)
  );
  return deals[0];
}

/**
 * Mueve un deal a una nueva etapa del pipeline "Ventas y Seguimiento".
 * @param {string} dealId
 * @param {"appointmentscheduled"|"qualifiedtobuy"|"presentationscheduled"|"decisionmakerboughtin"|"closedlost"} etapa
 */
async function moverEtapaDeal(dealId, etapa) {
  if (!dealId) return null;
  return hubspotRequest(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { dealstage: etapa } }),
  });
}

/**
 * Asigna el proyecto (Diamante, Santuario, Cotocanet) a un deal.
 * @param {string} dealId
 * @param {string} proyecto
 */
async function asignarProyecto(dealId, proyecto) {
  if (!dealId || !proyecto) return null;
  return hubspotRequest(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { proyecto } }),
  });
}

// --- Asignación de asesor por turnos (round-robin) ---
// Miguel Mondragón queda excluido de la rotación por regla de negocio.
const ASESORES_ROTACION = ["Irly Lopez", "Noemí Yahaira", "Alejandro Santibañez"];
const ESTADO_PATH = path.join(__dirname, "..", "data", "estado_rotacion.json");

function leerUltimoIndice() {
  try {
    const data = JSON.parse(fs.readFileSync(ESTADO_PATH, "utf8"));
    return data.ultimoIndice ?? -1;
  } catch {
    return -1;
  }
}

function guardarUltimoIndice(indice) {
  fs.writeFileSync(ESTADO_PATH, JSON.stringify({ ultimoIndice: indice }), "utf8");
}

/**
 * Regresa el siguiente asesor en la rotación (round-robin), excluyendo a Miguel Mondragón.
 * @returns {string} nombre del asesor
 */
function siguienteAsesorRoundRobin() {
  const ultimo = leerUltimoIndice();
  const siguiente = (ultimo + 1) % ASESORES_ROTACION.length;
  guardarUltimoIndice(siguiente);
  return ASESORES_ROTACION[siguiente];
}

/**
 * Asigna un asesor (por turnos) a un deal.
 * @param {string} dealId
 */
async function asignarAsesorRoundRobin(dealId) {
  if (!dealId) return null;
  const asesor = siguienteAsesorRoundRobin();
  await hubspotRequest(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { asesor } }),
  });
  return asesor;
}

/**
 * Crea la tarea de "documentación en trámite" para un contacto/deal.
 * @param {Object} params
 * @param {string} [params.contactId]
 * @param {string[]} params.documentos
 */
async function crearTareaDocumentacion({ contactId, documentos }) {
  const lista = documentos.map((d) => `- ${d}`).join("\n");
  return createTask({
    subject: "Documentación en trámite",
    body: `El cliente inició su expediente. Documentos a revisar:\n${lista}`,
    contactId,
    priority: "HIGH",
  });
}

module.exports = {
  findContactByPhone,
  createTask,
  findDealByContactId,
  moverEtapaDeal,
  asignarProyecto,
  asignarAsesorRoundRobin,
  crearTareaDocumentacion,
};
