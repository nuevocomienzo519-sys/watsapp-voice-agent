// lib/exportacionPendiente.js
//
// Candado de exportación de chats. Cuando llega un chat exportado (.zip/.txt)
// y no se pudo detectar con certeza el nombre o el teléfono del cliente, se
// abre una "exportación pendiente" para ese chat: el agente deja de hacer
// cualquier otra cosa ahí hasta que se confirmen los datos o se cancele.
//
// Todo vive en memoria (Map). Si el servicio se reinicia, los pendientes se
// pierden — es intencional: no se guarda ningún registro en disco.
//
// Variables de entorno:
//   ASISTENTE_NOMBRE   nombre con el que se presenta el agente (default: Mondri)

const NOMBRE_AGENTE = process.env.ASISTENTE_NOMBRE || "Mondri";

// Una exportación a medias caduca sola a los 60 minutos, para no dejar un
// chat bloqueado para siempre si el asesor nunca contesta.
const MINUTOS_VIDA = 60;
const MS_VIDA = MINUTOS_VIDA * 60 * 1000;

const PASO_NOMBRE = "nombre";
const PASO_TELEFONO = "telefono";

const pendientes = new Map(); // chatId -> datos
const saludados = new Map(); // chatId -> timestamp del saludo

// --- Utilidades internas ----------------------------------------------------

function clave(chatId) {
  return String(chatId);
}

function vencido(registro) {
  return !registro || Date.now() - registro.creadoEn > MS_VIDA;
}

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// --- Ciclo de vida del pendiente -------------------------------------------

function abrir(chatId, datos = {}) {
  const registro = {
    chatId: clave(chatId),
    contactoId: datos.contactoId || null,
    negocioId: datos.negocioId || null,
    filenameOriginal: datos.filenameOriginal || null,
    nombreDetectado: datos.nombreDetectado || null,
    nombreCliente: datos.nombreCliente || null,
    telefono: datos.telefono || null,
    resumenConversacion: datos.resumenConversacion || null,
    paso: datos.paso || PASO_NOMBRE,
    intentos: 0,
    creadoEn: Date.now(),
  };
  pendientes.set(registro.chatId, registro);
  return registro;
}

function leer(chatId) {
  const k = clave(chatId);
  const registro = pendientes.get(k);
  if (!registro) return null;
  if (vencido(registro)) {
    pendientes.delete(k);
    return null;
  }
  return registro;
}

function actualizar(chatId, cambios = {}) {
  const registro = leer(chatId);
  if (!registro) return null;
  const nuevo = { ...registro, ...cambios, intentos: 0 };
  pendientes.set(clave(chatId), nuevo);
  return nuevo;
}

function cerrar(chatId) {
  pendientes.delete(clave(chatId));
}

// --- Validaciones -----------------------------------------------------------

const PALABRAS_CANCELAR = ["cancelar", "cancela", "cancelalo", "cancelado", "olvidalo", "ya no"];
const PALABRAS_SI = ["si", "sí", "si.", "correcto", "asi es", "exacto", "ok", "okey", "vale", "claro", "afirmativo", "es correcto", "si es"];

function esCancelacion(texto) {
  const t = normalizar(texto);
  if (!t) return false;
  return PALABRAS_CANCELAR.some((p) => t === p || t.startsWith(p + " "));
}

function esConfirmacion(texto) {
  const t = normalizar(texto).replace(/[.!]+$/, "");
  if (!t) return false;
  return PALABRAS_SI.includes(t);
}

// Nombres que NO son nombres de cliente: placeholders del parser, números,
// nombres genéricos de archivo exportado y los propios asesores del equipo.
const NO_ES_NOMBRE = [
  "cliente", "clientes", "contacto", "contacto exportado", "sin nombre",
  "desconocido", "whatsapp", "chat", "grupo", "asesor", "yo", "tu", "usted",
  "cliente diamante", "cliente santuario", "nuevo comienzo",
];

const ASESORES = [
  "miguel", "miguel angel", "miguel mondragon", "mondragon", "mondri",
  "alejandro", "alejandro santibanez", "santibanez",
  "jesika", "jessica", "jesika garcia", "garcia venegas",
  "noemi", "noemi lopez", "irly", "irly lopez", "raquel", "raquel rey", "jose",
];

function nombreValido(texto) {
  const crudo = String(texto || "").trim();
  if (!crudo) return null;
  if (crudo.length < 3 || crudo.length > 60) return null;

  const t = normalizar(crudo);

  // Puros dígitos o casi: es un teléfono, no un nombre.
  const digitos = crudo.replace(/\D/g, "").length;
  if (digitos >= 6) return null;
  if (!/[a-záéíóúñ]/i.test(crudo)) return null;

  if (NO_ES_NOMBRE.includes(t)) return null;
  if (ASESORES.some((a) => t === a)) return null;

  // Al menos una palabra de 3+ letras.
  const palabras = crudo.split(/\s+/).filter((p) => p.length >= 3);
  if (!palabras.length) return null;
  if (palabras.length > 6) return null;

  return crudo;
}

// Devuelve el teléfono normalizado a 10 dígitos (formato México) o null.
function telefonoValido(texto) {
  const crudo = String(texto || "");
  let d = crudo.replace(/\D/g, "");
  if (!d) return null;

  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("1")) d = d.slice(1);

  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d)) return null; // 0000000000, 1111111111...
  return d;
}

// --- Saludo de presentación (una sola vez por chat) -------------------------

function yaSaludo(chatId) {
  const k = clave(chatId);
  const cuando = saludados.get(k);
  if (!cuando) return false;
  // El saludo se recuerda 30 días; después se vuelve a presentar.
  if (Date.now() - cuando > 30 * 24 * 3600 * 1000) {
    saludados.delete(k);
    return false;
  }
  return true;
}

function marcarSaludado(chatId) {
  saludados.set(clave(chatId), Date.now());
}

function saludoDePresentacion() {
  return (
    `👋 Hola, soy ${NOMBRE_AGENTE}, el asistente virtual de la inmobiliaria.\n\n` +
    `Yo me encargo de registrar los chats que me mandas y de darles seguimiento ` +
    `en el sistema. Si algo no me cuadra, te pregunto antes de guardarlo.`
  );
}

// --- Mensajes del cuestionario ---------------------------------------------

function preguntaNombre(p = {}) {
  if (p.nombreDetectado) {
    return (
      `Antes de guardarlo necesito confirmar una cosa.\n\n` +
      `¿El cliente se llama *${p.nombreDetectado}*?\n\n` +
      `Responde *SÍ* para confirmarlo, o escríbeme el nombre correcto.\n` +
      `_(Escribe CANCELAR si prefieres dejarlo)_`
    );
  }
  return (
    `Antes de guardarlo necesito el dato que no pude sacar del chat.\n\n` +
    `¿Cómo se llama el cliente? Escríbeme su nombre.\n` +
    `_(Escribe CANCELAR si prefieres dejarlo)_`
  );
}

function preguntaTelefono(p = {}) {
  const quien = p.nombreCliente ? `de *${p.nombreCliente}*` : "del cliente";
  return (
    `Perfecto. Ahora el teléfono ${quien}, a 10 dígitos.\n\n` +
    `Ejemplo: 4721652507\n` +
    `_(Escribe CANCELAR si prefieres dejarlo)_`
  );
}

function nombreRechazado(p = {}) {
  return (
    `Ese no me sirve como nombre del cliente 🤔\n\n` +
    (p.nombreDetectado
      ? `¿Es *${p.nombreDetectado}*? Responde SÍ, o mándame el nombre correcto.`
      : `Mándame nada más el nombre, por ejemplo: María López.`) +
    `\n_(o CANCELAR para dejarlo)_`
  );
}

function telefonoRechazado(p = {}) {
  return (
    `Ese número no me cuadra 🤔 Necesito 10 dígitos, sin espacios ni guiones.\n\n` +
    `Ejemplo: 4721652507\n` +
    `_(o CANCELAR para dejarlo)_`
  );
}

function recordatorioBloqueo(p = {}) {
  const falta =
    p.paso === PASO_TELEFONO
      ? "el teléfono del cliente, a 10 dígitos"
      : "el nombre del cliente";
  return (
    `Tengo una exportación a medias en este chat y no puedo seguir con otra cosa ` +
    `hasta cerrarla.\n\nMe falta ${falta}. Escríbemelo en texto, por favor.\n` +
    `_(o CANCELAR para dejarlo)_`
  );
}

function cancelado() {
  return (
    `Listo, lo cancelé ✅ No guardé nada de esa exportación.\n\n` +
    `Cuando quieras, vuelve a mandarme el archivo del chat.`
  );
}

function terminado(nombreCliente, telefono, avisoEnvio) {
  let msg =
    `✅ Guardado.\n\n` +
    `👤 ${nombreCliente || "Cliente"}\n` +
    `📱 ${telefono}\n` +
    `📍 Etapa: Base de datos`;
  if (avisoEnvio) msg += `\n\n${avisoEnvio}`;
  return msg;
}

module.exports = {
  PASO_NOMBRE,
  PASO_TELEFONO,
  MINUTOS_VIDA,
  abrir,
  leer,
  actualizar,
  cerrar,
  esCancelacion,
  esConfirmacion,
  nombreValido,
  telefonoValido,
  yaSaludo,
  marcarSaludado,
  saludoDePresentacion,
  preguntaNombre,
  preguntaTelefono,
  nombreRechazado,
  telefonoRechazado,
  recordatorioBloqueo,
  cancelado,
  terminado,
};
