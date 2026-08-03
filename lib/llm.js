const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const { findContactByPhone, createTask } = require("./hubspot");

const DATA_PATH = path.join(__dirname, "..", "data", "proyectos.json");
const CONFIAT_PATH = path.join(__dirname, "..", "data", "confiat.json");

function campoUtil(valor) {
  if (!valor) return false;
  if (typeof valor === "string") return !valor.startsWith("TODO") && valor.trim() !== "";
  if (Array.isArray(valor)) return valor.some(campoUtil);
  return true;
}

/**
 * Arma la sección de datos de proyectos a partir de data/proyectos.json,
 * incluyendo SOLO los campos que ya fueron llenados (no placeholders "TODO").
 * Así el agente nunca menciona algo que el usuario no confirmó.
 */
function construirSeccionProyectos() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    console.error("No se pudo leer data/proyectos.json:", err.message);
    return "(No hay datos de proyectos cargados; ofrece siempre contactar a un asesor humano.)";
  }

  const bloques = data.proyectos.map((p) => {
    const lineas = [`### ${p.nombre}`];
    if (campoUtil(p.tipo_producto)) lineas.push(`- Producto: ${p.tipo_producto}`);
    if (campoUtil(p.precio_desde)) lineas.push(`- Precio desde: ${p.precio_desde}`);
    if (campoUtil(p.habitaciones)) lineas.push(`- Habitaciones: ${p.habitaciones}`);
    if (campoUtil(p.plantas)) lineas.push(`- Plantas: ${p.plantas}`);
    if (Array.isArray(p.modelos) && p.modelos.length > 0) {
      lineas.push("- Modelos disponibles:");
      p.modelos.forEach((m) => {
        const detalles = [];
        if (campoUtil(m.habitaciones)) detalles.push(`${m.habitaciones} recámaras`);
        if (campoUtil(m.plantas)) detalles.push(`${m.plantas} plantas`);
        const sufijo = detalles.length > 0 ? ` (${detalles.join(", ")})` : "";
        lineas.push(`  · ${m.nombre} — ${m.precio}${sufijo}`);
      });
    }
    if (campoUtil(p.amenidades)) lineas.push(`- Amenidades: ${p.amenidades.join(", ")}`);
    if (campoUtil(p.esquemas_de_pago)) lineas.push(`- Esquemas de pago: ${p.esquemas_de_pago.join(", ")}`);
    if (campoUtil(p.diferenciadores)) lineas.push(`- Diferenciadores: ${p.diferenciadores}`);
    if (lineas.length === 1) lineas.push("- (Sin datos cargados todavía para este proyecto.)");
    return lineas.join("\n");
  });

  return bloques.join("\n\n");
}

/**
 * Arma la sección de financiamiento hipotecario a partir de
 * data/confiat.json (aliado Confiat/SOC Asesores). Incluye qué es
 * Confiat, documentos requeridos, criterios de calificación, y las
 * cotizaciones de referencia por banco.
 */
function construirSeccionFinanciamiento() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CONFIAT_PATH, "utf8"));
  } catch (err) {
    console.error("No se pudo leer data/confiat.json:", err.message);
    return null; // Si no existe el archivo, simplemente no se menciona financiamiento.
  }

  const lineas = [
    `### Financiamiento hipotecario (aliado: ${data.organizacion})`,
    data.descripcion,
    "",
    "Documentos que se piden al cliente para perfilarlo:",
    ...data.documentos_requeridos.map((d) => `- ${d}`),
    "",
    `Sobre el aforo: ${data.criterios_calificacion.aforo}`,
    `Sobre buró de crédito: ${data.criterios_calificacion.buro_de_credito}`,
    `Ingresos informales/independientes: ${data.criterios_calificacion.ingresos}`,
    "",
    "Cotizaciones de referencia por banco (valor de vivienda, crédito, plazo, tasa, pago mensual, ingreso requerido, enganche):",
  ];

  data.simulaciones.forEach((s) => {
    const plazo = s.plazo_anos ? `${s.plazo_anos} años` : `${s.plazo_meses} meses`;
    lineas.push(
      `- ${s.banco} (${s.producto}): vivienda $${s.valor_vivienda.toLocaleString("es-MX")}, ` +
        `crédito $${s.monto_credito.toLocaleString("es-MX")}, plazo ${plazo}, tasa ${s.tasa}` +
        (s.cat ? `, CAT ${s.cat}` : "") +
        `, pago mensual aprox. $${s.pago_mensual.toLocaleString("es-MX")}, ` +
        `ingreso requerido aprox. $${s.ingreso_requerido.toLocaleString("es-MX")}, ` +
        `enganche $${s.enganche.toLocaleString("es-MX")}`
    );
  });

  lineas.push("", data.notas);

  return lineas.join("\n");
}

function construirSystemPrompt(inputMode) {
  const seccionProyectos = construirSeccionProyectos();
  const seccionFinanciamiento = construirSeccionFinanciamiento();
  const canalCliente =
    inputMode === "audio"
      ? "El cliente te escribió por NOTA DE VOZ."
      : "El cliente te escribió por MENSAJE DE TEXTO.";

  return `
Eres el asistente de Nuevo Comienzo, una inmobiliaria en Franco, Silao.
Respondes por WhatsApp a clientes interesados en los desarrollos Diamante,
Santuario. ${canalCliente}

Información real de los proyectos (usa solo estos datos; si el dato que te
piden no aparece aquí, NO LO INVENTES):

${seccionProyectos}
${seccionFinanciamiento ? `\n${seccionFinanciamiento}\n` : ""}
Reglas de contenido:
- Responde en español, de forma cálida y natural.
- Si no tienes un dato específico (precio exacto, disponibilidad actual,
  algo que no aparece arriba), no lo inventes: dilo con naturalidad y
  ofrece poner al cliente en contacto con un asesor humano.
- Si preguntan por financiamiento, crédito hipotecario o mensualidades,
  usa los datos de Confiat de arriba (si existen) y ACLARA SIEMPRE que
  son cifras de referencia, sujetas a la evaluación de crédito real del
  cliente — nunca las presentes como una aprobación garantizada.
- Máximo 4-5 oraciones (o su equivalente en lista breve).

FORMATO DE SALIDA — decides cómo se va a entregar tu respuesta:
Tu respuesta debe empezar EXACTAMENTE con una de estas tres líneas (nada
antes), seguida de una línea en blanco y luego el mensaje:
FORMATO: voz
FORMATO: texto
FORMATO: voz_y_texto

Cómo decidir:
- Respeta SIEMPRE el canal del cliente: si te escribió por nota de voz,
  la respuesta completa va en voz ("FORMATO: voz" o "FORMATO:
  voz_y_texto"); si te escribió por texto, usa "FORMATO: texto".
- Si el cliente te escribió por NOTA DE VOZ y tu respuesta trae precios,
  lista de amenidades, varias opciones de pago, o varios datos concretos
  juntos que convenga que el cliente pueda releer, usa
  "FORMATO: voz_y_texto": la respuesta completa se manda en audio (igual
  de detallada que siempre) Y ADEMÁS se manda un mensaje de texto breve
  con el resumen de esos datos concretos, en el mismo turno.
- Si el cliente escribió por texto, siempre "FORMATO: texto" (nunca se
  mezcla con voz).

Si usaste "FORMATO: voz_y_texto", después del mensaje completo (el que se
convierte a voz) agrega este bloque adicional, empezando en su propia
línea:
---RESUMEN---
(aquí el resumen breve en texto plano de los datos concretos —
precios, lista, opciones — pensado para releerse, no para el oído)

DESPUÉS de todo lo anterior, agrega SIEMPRE un bloque final que NUNCA se
le muestra al cliente (el servidor lo recorta antes de enviar), con esta
forma EXACTA, empezando en su propia línea:
---INTERNO---
{"intencion": "cita" | "info_especifica" | "ninguna", "detalle": "resumen breve en español de qué se agendó o qué se preguntó"}

Cómo llenar ese bloque interno:
- "cita": el cliente confirmó o pidió agendar una visita/llamada/reunión concreta (con fecha/hora o "en un rato", etc.).
- "info_especifica": el cliente preguntó por algo concreto y accionable (precio de un modelo, esquema de pago, disponibilidad, documentos para trámite, etc.) que amerita seguimiento puntual, no solo plática general.
- "ninguna": saludo, plática general, agradecimiento, o nada que amerite una tarea especial.
- "detalle" debe ser información útil para quien va a dar seguimiento (ej. "Agendó visita para mañana a las 5pm en Diamante" o "Preguntó el esquema de pagos de Santuario modelo X").
`;
}

/**
 * Llama a Claude para generar la respuesta del agente, decidiendo también
 * el formato de entrega (voz/texto/voz_y_texto) y si hay que crear una
 * tarea de seguimiento en HubSpot (cita agendada o info específica).
 *
 * @param {string} userText - Texto del cliente (ya transcrito si venía en audio).
 * @param {"audio"|"text"} inputMode
 * @param {{chatId: string, phone: string}} [contexto] - Datos del chat/contacto para crear la tarea en HubSpot.
 * @returns {Promise<{formato: "voz"|"texto"|"voz_y_texto", texto: string, resumen?: string}>}
 */
async function generateReply(userText, inputMode, contexto = {}) {
  const systemPrompt = construirSystemPrompt(inputMode);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Error llamando a Claude: ${res.status} - ${body}`);
  }

  const data = await res.json();
  const rawText = (data.content?.[0]?.text || "").trim();

  // Separa el bloque interno (---INTERNO---) del resto del mensaje.
  const [antesDeInterno, bloqueInterno] = rawText.split("---INTERNO---");

  // Si hay FORMATO: voz_y_texto, además separa el resumen (---RESUMEN---).
  const [mensajeCompleto, bloqueResumen] = antesDeInterno.split("---RESUMEN---");

  const match = mensajeCompleto
    .trim()
    .match(/^FORMATO:\s*(voz_y_texto|voz|texto)\s*\n+([\s\S]*)$/i);

  const formato = match ? match[1].toLowerCase() : "texto";
  const texto = match ? match[2].trim() : mensajeCompleto.trim();
  const resumen =
    formato === "voz_y_texto" && bloqueResumen ? bloqueResumen.trim() : undefined;

  // Intenta crear la tarea de seguimiento en HubSpot según lo que Claude detectó.
  // Cualquier error aquí NO debe impedir que la respuesta llegue al cliente.
  if (bloqueInterno) {
    try {
      const jsonMatch = bloqueInterno.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const { intencion, detalle } = JSON.parse(jsonMatch[0]);
        if (intencion === "cita" || intencion === "info_especifica") {
          const contact = contexto.phone
            ? await findContactByPhone(contexto.phone)
            : null;
          await createTask({
            subject:
              intencion === "cita"
                ? "Cita agendada por WhatsApp"
                : "Cliente pidió información específica",
            body: detalle || "(sin detalle)",
            contactId: contact?.id,
            priority: intencion === "cita" ? "HIGH" : "MEDIUM",
          });
        }
      }
    } catch (err) {
      console.error("No se pudo crear la tarea de seguimiento en HubSpot:", err.message);
    }
  }

  return { formato, texto, resumen };
}

module.exports = { generateReply };
