// routes/chatExportado.js
// Entrada A: recibe el ZIP desde el Google Apps Script (carpeta de Drive) y lo procesa.
// (La entrada B — directo desde WhatsApp — vive en server-integration-snippet.js)

const express = require('express');
const { procesarChatExportado } = require('../lib/chatExportadoCore');

const router = express.Router();
const CHAT_EXPORT_SECRET = process.env.CHAT_EXPORT_SECRET;

router.post('/webhook/chat-exportado', async (req, res) => {
  try {
    if (CHAT_EXPORT_SECRET && req.headers['x-chat-export-secret'] !== CHAT_EXPORT_SECRET) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { filename, zipBase64 } = req.body;
    if (!zipBase64) return res.status(400).json({ error: 'Falta zipBase64 en el body' });

    const buffer = Buffer.from(zipBase64, 'base64');
    const { contacto, negocio, datos } = await procesarChatExportado(buffer, filename);

    console.log(
      `[chat-exportado/drive] ${filename} -> contacto ${contacto.id}, negocio ${negocio.id}, proyecto=${datos.proyecto}, asesor=${datos.asesorLabel}`
    );
    res.json({ ok: true, contactoId: contacto.id, negocioId: negocio.id, datos });
  } catch (err) {
    console.error('[chat-exportado/drive] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
