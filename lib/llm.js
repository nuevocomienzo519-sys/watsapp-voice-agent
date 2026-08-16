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
  nombreParecePlaceholder,
  actualizarNombreContacto,
} = require("./hubspot");

const DATA_PATH = path.join(__dirname, "..", "data", "proyectos.json");
const CONFIAT_PATH = path.join(__dirname, "..", "data", "confiat.json");
const CATALOG_URL = process.env.CATALOG_URL;

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
- Personalidad: habla como una persona real y cercana, no como un
  script leído. Varía la forma de empezar tus oraciones (no siempre
  "Claro, te comento que..."), usa conectores naturales de conversación
  ("mira", "de hecho", "eso sí", "fíjate que"), y deja que se note que
  te interesa ayudar, no solo dar el dato. Evita sonar acartonado o
  repetir las mismas frases hechas en cada respuesta. Piensa en cómo
  hablaría un asesor de ventas simpático y de confianza, no un
  comunicado oficial.
- Cuando menciones cantidades de dinero (precios, mensualidades,
  enganches, ingresos), escríbelas siempre en palabras, nunca con
  símbolo de pesos ni comas — por ejemplo "un millón setecientos mil
  pesos" en vez de "$1,700,000". Esto es porque tu respuesta puede
  convertirse a audio y los números con símbolos se leen mal en voz
  alta. EXCEPCIÓN: en el bloque ---RESUMEN--- (si lo usas) sí escribe
  las cifras normales con números y símbolo de $, porque ese bloque es
  para releerse en texto, no para escucharse.
- Ya tienes en tus mensajes anteriores el historial de esta conversación:
  úsalo para no repetir preguntas ya respondidas y para entender
  referencias como "ese modelo", "la opción que dijiste", etc.
- Si no tienes un dato específico (precio exacto, disponibilidad actual,
  algo que no aparece arriba), no lo inventes: dilo con naturalidad y
  ofrece poner al cliente en contacto con un asesor humano.
- Si preguntan por financiamiento, crédito hipotecario o mensualidades,
  usa los datos de Confiat de arriba (si existen) y ACLARA SIEMPRE que
  son cifras de referencia, sujetas a la evaluación de crédito real del
  cliente — nunca las presentes como una aprobación garantizada.
- Si el cliente muestra interés en Diamante o Santuario (pregunta por
  modelos, precios, disponibilidad) o pide ver el catálogo completo o
  todas las opciones disponibles, comparte el link del catálogo
  (${CATALOG_URL}) SOLO en texto — un link nunca debe ir en la parte
  de tu respuesta que se convierte a voz, porque TTS lo lee letra por
  letra y suena mal:
  - Si el cliente escribió por TEXTO: agrega el link al final de tu
    respuesta, en su propia línea, con este formato exacto:
    Ver catálogo completo: ${CATALOG_URL}
  - Si el cliente escribió por NOTA DE VOZ: usa SIEMPRE
    "FORMATO: voz_y_texto" en este caso (aunque no haya otros datos que
    resumir), y coloca el link ÚNICAMENTE dentro del bloque
    ---RESUMEN---, nunca en el mensaje principal que se convierte a
    audio. En el mensaje de voz, menciona de forma natural que le
    mandas el link por texto (ej. "te paso el link del catálogo aquí
    abajo") — nunca digas la URL en voz.
- Máximo 4-5 oraciones (o su equivalente en lista breve), sin contar la
  línea del catálogo si aplica.

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
  lista de amenidades, varias opciones de pago, varios datos concretos
  juntos que convenga que el cliente pueda releer, O el link del
  catálogo (ver regla arriba), usa "FORMATO: voz_y_texto": la respuesta
  completa se manda en audio (igual de detallada que siempre, pero SIN
  el link) Y ADEMÁS se manda un mensaje de texto breve con el resumen
  de esos datos concretos (y el link si aplica), en el mismo turno.
- Si el cliente escribió por texto, siempre "FORMATO: texto" (nunca se
  mezcla con voz).

Si usaste "FORMATO: voz_y_texto", después del mensaje completo (el que se
convierte a voz) agrega este bloque adicional, empezando en su propia
línea:
---RESUMEN---
(aquí el resumen breve en texto plano de los datos concretos —
precios, lista, opciones, y el link del catálogo si aplica — pensado
para releerse, no para el oído)

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

async function generateReply(userText, inputMode, contexto = {}, history = []) {
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
      messages: [...history, { role: "user", content: userText }],
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
 * detectada por Claude.
 *
 * La asignación de proyecto/asesor corre SIEMPRE que el deal exista y le
 * falte alguno de los dos datos — no solo en el primer mensaje del
 * cliente — así se autocorrige si el Workflow de HubSpot tardó en crear
 * el deal la primera vez.
 */
async function procesarIntencion({ intencion, proyecto, detalle, contexto }) {
  const phone = contexto.phone;
  const contact = phone ? await findContactByPhone(phone) : null;
  const esClienteNuevo = !contact;

  const contactId = contact?.id;
  const deal = contactId ? await findDealByContactId(contactId) : null;
  const dealId = deal?.id;

  // Si el contacto ya existe pero su nombre es el número (así lo crea
  // TimelinesAI cuando no conoce el nombre real), lo actualizamos con el
  // nombre de perfil de WhatsApp que sí tenemos en cada mensaje.
  const senderName = contexto.senderName;
  if (contactId && senderName && nombreParecePlaceholder(contact.properties?.firstname)) {
    try {
      await actualizarNombreContacto(contactId, senderName);
      console.log(`Nombre de contacto actualizado a "${senderName}" (contactId ${contactId})`);
    } catch (err) {
      console.error("No se pudo actualizar el nombre del contacto:", err.message);
    }
  }

  if (dealId) {
    const necesitaAsesor = !deal?.properties?.asesor;
    const necesitaProyecto = proyecto && !deal?.properties?.proyecto;
    if (necesitaAsesor) await asignarAsesorRoundRobin(dealId);
    if (necesitaProyecto) await asignarProyecto(dealId, proyecto);
    if (necesitaAsesor || necesitaProyecto) {
      console.log(`Asesor/Proyecto asignados (o re-intentados) en deal ${dealId} (nuevo=${esClienteNuevo})`);
    }
  }

  if (!intencion || intencion === "ninguna") return;

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
}

module.exports = { generateReply };
