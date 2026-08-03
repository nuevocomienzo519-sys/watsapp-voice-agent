const fetch = require("node-fetch");

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
  // Algunas respuestas (204) no traen body
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
  const cleanPhone = phone.replace(/[^\d]/g, ""); // solo dígitos, sin +

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

module.exports = { findContactByPhone, createTask };
