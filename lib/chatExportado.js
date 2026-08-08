// lib/parseChatExport.js
// Parsea el chat.txt que viene dentro del ZIP de "Exportar chat" de WhatsApp
// (soporta el formato de iPhone y el de Android).
// No depende de nada externo — es lógica pura, fácil de probar.

const ASESORES_CONOCIDOS = [
  { match: /mondrag/i, valor: 'miguel_mondragon', label: 'Miguel Mondragón' },
  { match: /irly|irle/i, valor: 'irle', label: 'Irly Lopez' },
  { match: /noem/i, valor: 'noemi', label: 'Noemí yahaira' },
  { match: /alejandro|santiba/i, valor: 'alejandro', label: 'Alejandro Santibañez' },
];

const PROYECTOS_CONOCIDOS = ['diamante', 'santuario'];

/**
 * Extrae los mensajes crudos del texto del chat.txt
 * @param {string} rawText contenido del .txt (utf8)
 * @returns {Array<{fecha:string, hora:string, remitente:string, texto:string}>}
 */
function extraerMensajes(rawText) {
  const clean = rawText.replace(/[\u200e\u200f]/g, ''); // quita marcas invisibles LRM/RLM

  // Formato iPhone: [DD/MM/AA, H:MM:SS a. m./p. m.] Remitente: texto
  // Formato Android: DD/MM/AA, H:MM a. m./p. m. - Remitente: texto (sin corchetes, sin segundos)
  const msgRegex =
    /\[?(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]?\s?[-–]?\s([^:]+):\s?([\s\S]*?)(?=\n?\u200e?\[?\d{1,2}\/\d{1,2}\/\d{2,4},|$)/g;

  const mensajes = [];
  let match;
  while ((match = msgRegex.exec(clean)) !== null) {
    mensajes.push({
      fecha: match[1],
      hora: match[2],
      remitente: match[3].trim(),
      texto: match[4].trim(),
    });
  }
  return mensajes;
}

/**
 * Identifica al asesor conocido dentro de la lista de remitentes, si hay alguno.
 */
function identificarAsesor(remitentes) {
  for (const nombre of remitentes) {
    for (const asesor of ASESORES_CONOCIDOS) {
      if (asesor.match.test(nombre)) return { ...asesor, nombreEnChat: nombre };
    }
  }
  return null;
}

/**
 * Del nombre del contacto (tal como quedó guardado en el chat, ej.
 * "Maria Del Carmen Cardoso Hernandez Para Diamante"), separa el nombre limpio
 * y el proyecto si viene indicado con el sufijo " Para <Proyecto>".
 */
function separarNombreYProyecto(nombreCrudo) {
  const re = /^(.*?)\s+Para\s+(Diamante|Santuario)\s*$/i;
  const m = nombreCrudo.match(re);
  if (m) {
    return { nombre: m[1].trim(), proyecto: m[2].toLowerCase() };
  }
  // Fallback: buscar la palabra del proyecto en cualquier parte del nombre
  const proyectoEncontrado = PROYECTOS_CONOCIDOS.find((p) =>
    new RegExp(p, 'i').test(nombreCrudo)
  );
  return { nombre: nombreCrudo.trim(), proyecto: proyectoEncontrado || null };
}

/**
 * Punto de entrada principal: recibe el texto del chat.txt y regresa
 * la estructura lista para crear el contacto/negocio en HubSpot.
 */
function parseChatExport(rawText) {
  const mensajes = extraerMensajes(rawText);
  if (mensajes.length === 0) {
    throw new Error('No se encontraron mensajes reconocibles en el chat.txt');
  }

  const remitentesUnicos = [...new Set(mensajes.map((m) => m.remitente))];
  const asesor = identificarAsesor(remitentesUnicos);

  // El "cliente" es cualquier remitente que NO sea el asesor identificado
  const nombreClienteCrudo =
    remitentesUnicos.find((r) => !asesor || r !== asesor.nombreEnChat) || remitentesUnicos[0];

  const { nombre, proyecto } = separarNombreYProyecto(nombreClienteCrudo);

  const primerMensajeAsesor = asesor
    ? mensajes.find((m) => m.remitente === asesor.nombreEnChat && m.texto)?.texto
    : null;

  return {
    nombreCliente: nombre,
    proyecto, // 'diamante' | 'santuario' | null
    asesor: asesor ? asesor.valor : null, // valor interno de HubSpot o null
    asesorLabel: asesor ? asesor.label : null,
    primerMensajeAsesor: primerMensajeAsesor || null,
    totalMensajes: mensajes.length,
    fechaPrimerMensaje: mensajes[0].fecha,
  };
}

module.exports = { parseChatExport, extraerMensajes, identificarAsesor, separarNombreYProyecto };
