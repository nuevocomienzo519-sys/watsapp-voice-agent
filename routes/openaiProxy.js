
// routes/openaiProxy.js
// Proxy para el generador de imagen/video (generador_openai.html) de
// marketing Diamante/Santuario. Evita el bloqueo de CORS al llamar a la
// API de OpenAI directo desde el navegador.
//
// Reusa OPENAI_API_KEY (ya configurada para Whisper/TTS) y WEBHOOK_SECRET
// (ya configurado para el webhook de TimelinesAI) como llave de acceso,
// para que nadie más pueda gastar tu crédito de OpenAI llamando a estas
// rutas si llegara a encontrar la URL.
//
// Uso desde generador_openai.html:
//   URL de proxy:    https://TU-DOMINIO
//   Secreto:          el mismo WEBHOOK_SECRET que ya usas

const express = require("express");

const router = express.Router();
const OPENAI_BASE = "https://api.openai.com";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function autorizado(req) {
  const secret = req.query.secret || req.headers["x-proxy-secret"];
  return secret === process.env.WEBHOOK_SECRET;
}

// Generar imagen
router.post("/api/images", async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ error: { message: "No autorizado" } });

  try {
    const r = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: "Error contactando a OpenAI: " + err.message } });
  }
});

// Crear trabajo de video (Sora)
router.post("/api/videos", async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ error: { message: "No autorizado" } });

  try {
    const r = await fetch(`${OPENAI_BASE}/v1/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: "Error contactando a OpenAI: " + err.message } });
  }
});

// Consultar estado del video
router.get("/api/videos/:id", async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ error: { message: "No autorizado" } });

  try {
    const r = await fetch(`${OPENAI_BASE}/v1/videos/${req.params.id}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: "Error contactando a OpenAI: " + err.message } });
  }
});

// Descargar el mp4 final
router.get("/api/videos/:id/content", async (req, res) => {
  if (!autorizado(req)) return res.status(401).send("No autorizado");

  try {
    const r = await fetch(`${OPENAI_BASE}/v1/videos/${req.params.id}/content`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });
    if (!r.ok) {
      const errBody = await r.text();
      return res.status(r.status).send(errBody);
    }
    res.setHeader("Content-Type", "video/mp4");
    const arrayBuffer = await r.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).json({ error: { message: "Error contactando a OpenAI: " + err.message } });
  }
});

module.exports = router;
