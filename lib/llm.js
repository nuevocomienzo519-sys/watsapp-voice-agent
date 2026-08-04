const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const {
  findContactByPhone,
  createTask,
  findDealByContactId,
  moverEtapaDeal,
  asignarProyecto,
  asignarAsesorRoundRobin,
  crearTareaDocumentacion,
} = require("./hubspot");

const DATA_PATH = path.join(__dirname, "..", "data", "proyectos.json");
const CONFIAT_PATH = path.join(__dirname, "..", "data", "confiat.json");

function campoUtil(valor) {
  if (!valor) return false;
  if (typeof valor === "string") return !valor.startsWith("TODO") && valor.trim() !== "";
  if (Array.isArray(valor)) return valor.some(campoUtil);
  return true;
}

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

function construirSeccionFinanciamiento() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CONFIAT_PATH, "utf8"));
  } catch (err) {
    console.error("No se pudo leer data/confiat.json:", err.message);
    return null;
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
{"intencion": "cita" | "info_especifica" | "precalificacion_solicitada" | "no_califica" | "inicio_expediente" | "expediente_completado" | "ninguna", "proyecto": "Diamante" | "Santuario" | "Cotocanet" | null, "detalle": "resumen breve en español de qué pasó"}

Cómo llenar el campo "intencion" (elige SOLO UNA, la más específica que aplique):
- "cita": el cliente confirmó o pidió agendar una visita/llamada/reunión concreta.
- "precalificacion_solicitada": el cliente aceptó iniciar el proceso de precalificación de crédito (dio o va a dar sus datos para que lo evalúen).
- "no_califica": quedó claro en la conversación que el cliente NO califica para el crédito/compra (tú NUNCA decides esto por tu cuenta — solo lo marcas si el cliente o el flujo de la conversación ya lo confirmó explícitamente, por ejemplo porque un asesor humano se lo informó y el cliente lo menciona).
- "inicio_expediente": el cliente califica y confirma que va a empezar a mandar su documentación (credencial, comprobante de domicilio, etc.) para iniciar el expediente de compra.
- "expediente_completado": queda claro que el cliente ya entregó toda su documentación y el expediente se completó con éxito (normalmente esto lo confirma un asesor humano, no lo asumas solo porque el cliente "dice" que ya mandó todo si no hay confirmación clara).
- "info_especifica": el cliente preguntó por algo concreto y accionable (precio, esquema de pago, disponibilidad) que amerita seguimiento puntual, pero no cae en ninguna categoría anterior.
- "ninguna": saludo, plática general, agradecimiento, o nada que amerite acción especial.

Cómo llenar "proyecto": si en algún momento de la conversación (esta u otras
anteriores) quedó claro que el cliente pregunta por Diamante, Santuario o
Cotocanet, ponlo aquí. Si no se ha mencionado ningún proyecto todavía, usa null.

"detalle" debe ser información útil para quien va a dar seguimiento (ej.
"Agendó visita para mañana a las 5pm en Diamante" o "Confirmó que va a
mandar su documentación para iniciar expediente de Santuario").

IMPORTANTE: sé conservador. Si tienes duda entre dos intenciones, o no
está clara la confirmación explícita del cliente, usa "info_especifica"
o "ninguna" en vez de forzar una categoría más avanzada del proceso.
`;
}

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
  const textBlock = (data.content || []).find((block) => block.type === "text");
  const rawText = (textBlock?.text || "").trim();

  const [antesDeInterno, bloqueInterno] = rawText.split("---INTERNO---");
  const [mensajeCompleto, bloqueResumen] = antesDeInterno.split("---RESUMEN---");

  const match = mensajeCompleto
    .trim()
    .match(/^FORMATO:\s*(voz_y_texto|voz|texto)\s*\n+([\s\S]*)$/i);

  let formato = match ? match[1].toLowerCase() : "texto";
  let texto = match ? match[2].trim() : mensajeCompleto.trim();
  let resumen =
    formato === "voz_y_texto" && bloqueResumen ? bloqueResumen.trim() : undefined;

  if (inputMode === "audio" && formato === "texto") {
    console.warn("Claude devolvió FORMATO: texto para un mensaje de audio; forzando a voz.");
    formato = "voz";
  }

  if (!texto) {
    console.warn(
      "El mensaje para el cliente salió vacío. Respuesta cruda de Claude:",
      rawText
    );
    texto =
      "Disculpa, tuve un problema generando la respuesta. ¿Me repites tu pregunta, por favor?";
    resumen = undefined;
  }

  if (bloqueInterno) {
    try {
      const jsonMatch = bloqueInterno.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const { intencion, proyecto, detalle } = JSON.parse(jsonMatch[0]);
        await procesarIntencion({ intencion, proyecto, detalle, contexto });
      }
    } catch (err) {
      console.error("No se pudo procesar la intención en HubSpot:", err.message);
    }
  }

  return { formato, texto, resumen };
}

/**
 * Ejecuta las acciones correspondientes en HubSpot según la intención
 * detectada por Claude: mover etapa, asignar proyecto/asesor, crear tareas.
 * El deal ya existe cuando esto se ejecuta (lo crea un Workflow de HubSpot
 * al llegar el chat exportado), así que solo lo buscamos, nunca lo creamos.
 */
async function procesarIntencion({ intencion, proyecto, detalle, contexto }) {
  if (!intencion || intencion === "ninguna") return;

  const phone = contexto.phone;
  const contact = phone ? await findContactByPhone(phone) : null;
  const esClienteNuevo = !contact;

  const contactId = contact?.id;
  const deal = contactId ? await findDealByContactId(contactId) : null;
  const dealId = deal?.id;

  switch (intencion) {
    case "cita":
      await createTask({
        subject: "Cita agendada por WhatsApp",
        body: detalle || "(sin detalle)",
        contactId,
        priority: "HIGH",
      });
      if (dealId) await asignarAsesorRoundRobin(dealId);
      break;

    case "info_especifica":
      await createTask({
        subject: "Cliente pidió información específica",
        body: detalle || "(sin detalle)",
        contactId,
        priority: "MEDIUM",
      });
      break;

    case "precalificacion_solicitada":
      if (dealId) await moverEtapaDeal(dealId, "qualifiedtobuy");
      await createTask({
        subject: "Precalificación de crédito solicitada",
        body: detalle || "(sin detalle)",
        contactId,
        priority: "HIGH",
      });
      break;

    case "no_califica":
      if (dealId) await moverEtapaDeal(dealId, "closedlost");
      await createTask({
        subject: "Cliente no calificó",
        body: detalle || "(sin detalle)",
        contactId,
        priority: "LOW",
      });
      break;

    case "inicio_expediente":
      if (dealId) await moverEtapaDeal(dealId, "presentationscheduled");
      await crearTareaDocumentacion({
        contactId,
        documentos: [
          "Credencial de identificación",
          "Comprobante de domicilio",
          // TODO: completar con el resto de la lista exacta cuando la tengas.
        ],
      });
      break;

    case "expediente_completado":
      if (dealId) await moverEtapaDeal(dealId, "decisionmakerboughtin");
      await createTask({
        subject: "Expediente completado con éxito",
        body: detalle || "(sin detalle)",
        contactId,
        priority: "MEDIUM",
      });
      break;
  }

  // El deal ya se crea automáticamente por un Workflow de HubSpot al
  // llegar el chat exportado. Aquí solo asignamos proyecto y asesor
  // por turnos la primera vez que detectamos al cliente.
  if (esClienteNuevo && dealId) {
    if (proyecto) await asignarProyecto(dealId, proyecto);
    await asignarAsesorRoundRobin(dealId);
  }
}

module.exports = { generateReply };
