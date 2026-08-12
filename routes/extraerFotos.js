
// routes/extraerFotos.js
// Endpoint temporal para extraer y descargar (en un .zip) todas las fotos
// de un día específico en un chat/grupo de TimelinesAI. Solo LEE mensajes
// (no consume crédito de envío, ese es el único que está limitado).
//
// Uso: entra desde el navegador a:
//   https://TU-DOMINIO/extraer-fotos?secret=TU_WEBHOOK_SECRET
// Parámetros opcionales:
//   chat_id -> por defecto 57693202 (grupo "Los Miguelines")
//   fecha   -> formato YYYY-MM-DD, por defecto el día de hoy

const express = require("express");
const AdmZip = require("adm-zip");

const router = express.Router();
const BASE = process.env.TIMELINES_API_BASE;
const TOKEN = process.env.TIMELINES_API_TOKEN;

const EXTENSIONES_IMAGEN = /\.(jpe?g|png|webp|gif)$/i;

function hoyISO() {
  // Fecha de hoy en formato YYYY-MM-DD, zona horaria de México (evita que
  // el servidor de Render, en otra zona horaria, calcule "hoy" distinto).
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function obtenerMensajesDelDia(chatId, fecha) {
  const mensajes = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = new URL(`${BASE}/chats/${chatId}/messages`);
    url.searchParams.set("after", `${fecha} 00:00`);
    url.searchParams.set("before", `${fecha} 23:59`);
    url.searchParams.set("sorting_order", "asc");
    url.searchParams.set("page", String(page));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TimelinesAI messages -> ${res.status}: ${body}`);
    }
    const json = await res.json();
    mensajes.push(...(json.data?.messages || []));
    hasMore = !!json.data?.has_more_pages;
    page += 1;
  }
  return mensajes;
}

router.get("/extraer-fotos", async (req, res) => {
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send("No autorizado");
  }

  const chatId = req.query.chat_id || "57693202"; // "Los Miguelines" por defecto
  const fecha = req.query.fecha || hoyISO();

  try {
    const mensajes = await obtenerMensajesDelDia(chatId, fecha);
    const fotos = mensajes.filter(
      (m) =>
        m.has_attachment &&
        m.attachment_filename &&
        EXTENSIONES_IMAGEN.test(m.attachment_filename)
    );

    if (fotos.length === 0) {
      return res
        .status(404)
        .send(`No se encontraron fotos el ${fecha} en el chat ${chatId}.`);
    }

    const zip = new AdmZip();
    let descargadas = 0;
    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      try {
        const descarga = await fetch(foto.attachment_url);
        if (!descarga.ok) continue; // si una falla, sigue con las demás
        const buffer = Buffer.from(await descarga.arrayBuffer());
        const nombre = `${String(i + 1).padStart(2, "0")}_${foto.attachment_filename}`;
        zip.addFile(nombre, buffer);
        descargadas++;
      } catch (err) {
        console.error(`[extraer-fotos] No se pudo descargar ${foto.attachment_filename}:`, err.message);
      }
    }

    if (descargadas === 0) {
      return res.status(500).send("Se encontraron fotos pero ninguna se pudo descargar.");
    }

    const zipBuffer = zip.toBuffer();
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="fotos_${fecha}.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error("[extraer-fotos] Error:", err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

module.exports = router;
