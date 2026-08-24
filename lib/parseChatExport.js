// lib/parseChatExport.js
// Parsea el chat.txt que viene dentro del ZIP de "Exportar chat" de WhatsApp
// (soporta el formato de iPhone y el de Android, con o sin coma después de la fecha).
// No depende de nada externo — es lógica pura, fácil de probar.

const ASESORES_CONOCIDOS = [
  { match: /mondrag/i, valor: 'miguel_mondragon', label: 'Miguel Mondragón' },
  { match: /irly|irle/i, valor: 'irle', label: 'Irly Lopez' },
  { match: /noem/i, valor: 'noemi', label: 'Noemí yahaira' },
  { match: /alejandro|santiba/i, valor: 'alejandro', label: 'Alejandro Santibañez' },
];

// Patrones adicionales que identifican al lado "nuestro" (equipo/negocio) en
// el chat exportado, aunque no correspondan a un asesor específico con
// propiedad de HubSpot asignable — por ejemplo, cuando el chat se exportó
// desde la cuenta general de WhatsApp Business del negocio en vez del
// celular personal de un asesor. Sin esto, si ningún remitente coincidía
// con ASESORES_CONOCIDOS, el código no tenía forma de saber cuál de los dos
// lados era "nosotros", y terminaba tomando el primer remitente del chat
// como si fuera el cliente (casi siempre el que saluda primero, o sea
// nosotros) — esto causaba que el contacto se registrara con nuestro
// nombre y que el teléfono nunca se detectara (porque nunca se llegaba a
// examinar al remitente correcto).
const PATRONES_INTERNOS_GENERICOS = [/nuevo\s*comienzo/i, /los\s*miguelines/i];

const PROYECTOS_CONOCIDOS = ['diamante', 'santuario'];

/**
 * Extrae los mensajes crudos del texto del chat.txt
 * @param {string} rawText contenido del .txt (utf8)
 * @returns {Array<{fecha:string, hora:string, remitente:string, texto:string}>}
 */
function extraerMensajes(rawText) {
  const clean = rawText.replace(/[\u200e\u200f]/g, ''); // quita marcas invisibles LRM/RLM

  // Formato iPhone: [DD/MM/AA, H:MM:SS a. m./p. m.] Remitente: texto
  // Formato Android: DD/MM/AA[,] H:MM[:SS] a. m./p. m. - Remitente: texto
  // (la coma después de la fecha es opcional según la versión/idioma de WhatsApp)
  const msgRegex =
    /\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]?\s?[-–]?\s([^:\n]+):\s?([\s\S]*?)(?=\n?\u200e?\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s\d{1,2}:\d{2}|$)/g;

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
 * Solo reconoce a los 4 asesores específicos (para poder asignar la
 * propiedad "asesor" en HubSpot) — no incluye la cuenta genérica del
 * negocio, que se maneja aparte con esRemitenteInterno().
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
 * ¿Este remitente es "nuestro lado" de la conversación (un asesor conocido
 * O la cuenta genérica del negocio), y por lo tanto NO puede ser el
 * cliente? A diferencia de identificarAsesor(), esta función sirve
 * únicamente para excluir correctamente al remitente "cliente" — no para
 * asignar la propiedad asesor en HubSpot.
 */
function esRemitenteInterno(nombre) {
  if (ASESORES_CONOCIDOS.some((a) => a.match.test(nombre))) return true;
  if (PATRONES_INTERNOS_GENERICOS.some((p) => p.test(nombre))) return true;
  return false;
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
 * ¿El texto del remitente es en realidad un número de teléfono crudo?
 * Pasa esto cuando el contacto NO estaba guardado en el teléfono que
 * exportó el chat: WhatsApp muestra el número tal cual en vez de un nombre.
 */
function esNumeroTelefono(remitente) {
  const soloSimbolos = remitente.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(soloSimbolos);
}

/**
 * Normaliza un número de teléfono (quita espacios/paréntesis/guiones,
 * conserva el + si venía). Ej: "+52 472 164 2507" -> "+524721642507".
 */
function normalizarTelefono(remitente) {
  const digitos = remitente.replace(/[^\d+]/g, '');
  return digitos.startsWith('+') ? digitos : `+${digitos}`;
}

/**
 * Busca un número de teléfono escrito a mano en el texto del mensaje
 * (caption) que acompaña al archivo exportado. Se usa como respaldo/override
 * manual cuando el chat no trae el número crudo (ej. cliente sí estaba
 * guardado con nombre en el teléfono que exportó).
 * Ej: "contacto exportado 4721642507" -> "+4721642507"
 */
function extraerTelefono(texto = '') {
  // texto puede llegar como null (no solo undefined) cuando WhatsApp manda
  // un archivo sin ningún mensaje de acompañamiento — el valor por defecto
  // de arriba NO cubre ese caso (en JS solo se activa con undefined).
  if (!texto) return null;
  const match = texto.match(/(\+?\d[\d\s()-]{7,}\d)/);
  if (!match) return null;
  return normalizarTelefono(match[1]);
}

/**
 * Busca menciones de un proyecto conocido en el cuerpo de los mensajes,
 * como respaldo cuando el nombre del contacto no trae el sufijo " Para <Proyecto>"
 * (típico cuando el cliente no estaba guardado y el remitente es un número crudo).
 */
function detectarProyectoEnMensajes(mensajes) {
  const textoCompleto = mensajes.map((m) => m.texto).join(' ');
  return PROYECTOS_CONOCIDOS.find((p) => new RegExp(p, 'i').test(textoCompleto)) || null;
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

  // El "cliente" es el primer remitente que NO sea interno (ni un asesor
  // conocido ni la cuenta genérica del negocio) — antes solo se excluía al
  // asesor específico encontrado por identificarAsesor(), así que si el
  // chat se exportó desde la cuenta genérica del negocio (que no coincide
  // con ningún asesor conocido), se tomaba por error el primer remitente
  // de la conversación como "cliente", casi siempre nosotros mismos.
  const remitentesExternos = remitentesUnicos.filter((r) => !esRemitenteInterno(r));
  const nombreClienteCrudo = remitentesExternos[0] || remitentesUnicos[0];

  let nombre;
  let proyecto;
  let telefonoDelChat = null;

  if (esNumeroTelefono(nombreClienteCrudo)) {
    // El cliente no estaba guardado como contacto en el teléfono que exportó
    // el chat: WhatsApp muestra su número crudo como remitente en vez de un
    // nombre. Lo usamos como teléfono real del lead. Como no hay nombre,
    // generamos uno provisional (se intentará mejorar buscando en los
    // mensajes del cliente si se presenta — ver detectarNombreClienteConIA
    // en chatExportadoCore.js).
    telefonoDelChat = normalizarTelefono(nombreClienteCrudo);
    nombre = `Cliente ${telefonoDelChat.slice(-4)}`;
    proyecto = detectarProyectoEnMensajes(mensajes);
  } else {
    const separado = separarNombreYProyecto(nombreClienteCrudo);
    nombre = separado.nombre;
    proyecto = separado.proyecto || detectarProyectoEnMensajes(mensajes);
  }

  const primerMensajeAsesor = asesor
    ? mensajes.find((m) => m.remitente === asesor.nombreEnChat && m.texto)?.texto
    : null;

  // Solo los mensajes que escribió el cliente (excluyendo al asesor), en
  // orden, para poder buscar dentro de ellos si el cliente se presenta con
  // su nombre — sin mezclarlos nunca con los mensajes del asesor.
  const mensajesCliente = mensajes
    .filter((m) => m.remitente === nombreClienteCrudo)
    .map((m) => m.texto)
    .filter(Boolean);

  return {
    nombreCliente: nombre,
    proyecto, // 'diamante' | 'santuario' | null
    asesor: asesor ? asesor.valor : null, // valor interno de HubSpot o null
    asesorLabel: asesor ? asesor.label : null,
    primerMensajeAsesor: primerMensajeAsesor || null,
    totalMensajes: mensajes.length,
    fechaPrimerMensaje: mensajes[0].fecha,
    // Teléfono detectado automáticamente del propio chat (remitente crudo),
    // o null si el cliente ya estaba guardado con nombre en el teléfono
    // que exportó — en ese caso se recurre al texto del caption (extraerTelefono).
    telefonoDelChat,
    mensajesCliente,
  };
}

module.exports = {
  parseChatExport,
  extraerMensajes,
  identificarAsesor,
  esRemitenteInterno,
  separarNombreYProyecto,
  extraerTelefono,
  esNumeroTelefono,
  normalizarTelefono,
  detectarProyectoEnMensajes,
};
