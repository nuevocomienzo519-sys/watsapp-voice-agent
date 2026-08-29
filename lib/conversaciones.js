// lib/conversaciones.js
//
// Guarda el historial de conversaciones en Postgres para que sobreviva a
// los reinicios de Render (el plan Free duerme el servicio y borra la RAM).
//
// Resuelve dos cosas:
//   1. El agente recuerda el contexto aunque el servicio se haya reiniciado.
//   2. El panel web puede mostrar los chats desde cualquier dispositivo.
//
// Variable de entorno necesaria en Render:
//   DATABASE_URL  -> la "Internal Database URL" del Postgres
//
// Si DATABASE_URL no está definida, el módulo NO truena: se desactiva solo
// y el agente sigue funcionando con el historial en memoria, como antes.

const { Pool } = require("pg");

const MAX_HISTORY_MESSAGES = 20; // ~10 turnos (usuario + asistente)

let pool = null;
let listoPromesa = null;

function habilitado() {
  return Boolean(process.env.DATABASE_URL);
}

function obtenerPool() {
  if (!habilitado()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
    pool.on("error", (err) => {
      console.error("[conversaciones] Error en el pool de Postgres:", err.message);
    });
  }
  return pool;
}

// Crea la tabla la primera vez. Se ejecuta una sola vez por proceso.
async function inicializar() {
  if (!habilitado()) return false;
  if (listoPromesa) return listoPromesa;

  listoPromesa = (async () => {
    const p = obtenerPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS mensajes (
        id            BIGSERIAL PRIMARY KEY,
        chat_id       TEXT        NOT NULL,
        telefono      TEXT,
        nombre        TEXT,
        rol           TEXT        NOT NULL,
        texto         TEXT        NOT NULL,
        creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_mensajes_chat_fecha
         ON mensajes (chat_id, creado_en DESC);`
    );
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_mensajes_fecha
         ON mensajes (creado_en DESC);`
    );
    console.log("[conversaciones] Postgres listo.");
    return true;
  })().catch((err) => {
    console.error("[conversaciones] No se pudo inicializar Postgres:", err.message);
    listoPromesa = null;
    return false;
  });

  return listoPromesa;
}

// Guarda el turno completo (mensaje del cliente + respuesta del agente).
async function guardarTurno({ chatId, telefono, nombre, textoCliente, textoAgente }) {
  if (!habilitado() || !chatId) return;
  try {
    await inicializar();
    const p = obtenerPool();

    if (textoCliente) {
      await p.query(
        `INSERT INTO mensajes (chat_id, telefono, nombre, rol, texto)
         VALUES ($1, $2, $3, 'user', $4)`,
        [String(chatId), telefono || null, nombre || null, textoCliente]
      );
    }
    if (textoAgente) {
      await p.query(
        `INSERT INTO mensajes (chat_id, telefono, nombre, rol, texto)
         VALUES ($1, $2, $3, 'assistant', $4)`,
        [String(chatId), telefono || null, nombre || null, textoAgente]
      );
    }
  } catch (err) {
    // Nunca tumbar la respuesta al cliente por un fallo de base de datos.
    console.error("[conversaciones] Error guardando turno:", err.message);
  }
}

// Devuelve el historial reciente en el formato que espera Claude.
async function obtenerHistorial(chatId) {
  if (!habilitado() || !chatId) return [];
  try {
    await inicializar();
    const p = obtenerPool();
    const { rows } = await p.query(
      `SELECT rol, texto FROM mensajes
        WHERE chat_id = $1
        ORDER BY creado_en DESC, id DESC
        LIMIT $2`,
      [String(chatId), MAX_HISTORY_MESSAGES]
    );
    return rows
      .reverse()
      .map((r) => ({ role: r.rol, content: r.texto }));
  } catch (err) {
    console.error("[conversaciones] Error leyendo historial:", err.message);
    return [];
  }
}

// Lista de chats con su último mensaje, para el panel.
async function listarChats(limite = 50) {
  if (!habilitado()) return [];
  await inicializar();
  const p = obtenerPool();
  const { rows } = await p.query(
    `SELECT DISTINCT ON (chat_id)
            chat_id, telefono, nombre, rol, texto, creado_en
       FROM mensajes
      ORDER BY chat_id, creado_en DESC, id DESC`
  );
  return rows
    .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
    .slice(0, limite);
}

// Todos los mensajes de un chat, para el detalle del panel.
async function obtenerConversacion(chatId, limite = 200) {
  if (!habilitado() || !chatId) return [];
  await inicializar();
  const p = obtenerPool();
  const { rows } = await p.query(
    `SELECT rol, texto, creado_en, nombre, telefono
       FROM mensajes
      WHERE chat_id = $1
      ORDER BY creado_en ASC, id ASC
      LIMIT $2`,
    [String(chatId), limite]
  );
  return rows;
}

module.exports = {
  habilitado,
  inicializar,
  guardarTurno,
  obtenerHistorial,
  listarChats,
  obtenerConversacion,
  MAX_HISTORY_MESSAGES,
};
