const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "proyectos.json");

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

function construirSystemPrompt(inputMode) {
  const seccionProyectos = construirSeccionProyectos();
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

Reglas de contenido:
- Responde en español, de forma cálida y natural.
- Si no tienes un dato específico (precio exacto, disponibilidad actual,
  algo que no aparece arriba), no lo inventes: dilo con naturalidad y
  ofrece poner al cliente en contacto con un asesor humano.
- Máximo 4-5 oraciones (o su equivalente en lista breve).

FORMATO DE SALIDA — decides cómo se va a entregar tu respuesta:
Tu respuesta debe empezar EXACTAMENTE con una de estas dos líneas (nada
antes), seguida de una línea en blanco y luego el mensaje:
FORMATO: voz
FORMATO: texto

Cómo decidir:
- Por defecto, respeta el canal del cliente: si te escribió por nota de
  voz usa "FORMATO: voz"; si te escribió por texto usa "FORMATO: texto".
- EXCEPCIÓN: usa "FORMATO:
