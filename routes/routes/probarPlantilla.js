// routes/probarPlantilla.js
//
// Endpoint TEMPORAL para probar el envío de la plantilla de WhatsApp
// (seguimiento_contacto) sin pasar por todo el flujo de "contacto exportado".
//
// BORRAR este archivo (y su línea en server.js) después de confirmar que
// la plantilla llega bien — es solo para pruebas puntuales.
//
// Uso: abre en el navegador (o Postman):
//   https://watsapp-voice-agent.onrender.com/probar-plantilla?telefono=524721652507&clave=TU_PANEL_CLAVE
//
// El teléfono va en formato E.164 SIN "+" (52 + 10 dígitos, ej. 524721652507)

const express = require("express");
const router = express.Router();
const { enviarMensajePlantilla } = require("../lib/whatsappCloudClient");

const PLANTILLA_SEGUIMIENTO =
  process.env.PLANTILLA_SEGUIMIENTO || "seguimiento_contacto";
const PLANTILLA_IDIOMA = process.env.PLANTILLA_IDIOMA || "es_MX";
const PLANTILLA_SIN_PARAMETROS = process.env.PLANTILLA_SIN_PARAMETROS === "1";

router.get("/probar-plantilla", async (req, res) => {
  const claveEsperada = process.env.PANEL_CLAVE;
  const claveRecibida = req.query.clave;

  if (!claveEsperada || claveRecibida !== claveEsperada) {
    return res.status(403).send("Clave incorrecta o no configurada (PANEL_CLAVE).");
  }

  const telefono = String(req.query.telefono || "").trim();
  if (!telefono) {
    return res.status(400).send("Falta el parámetro ?telefono= (formato: 524721652507, sin +).");
  }

  try {
    const resultado = await enviarMensajePlantilla(
      telefono,
      PLANTILLA_SEGUIMIENTO,
      PLANTILLA_IDIOMA,
      PLANTILLA_SIN_PARAMETROS
        ? []
        : ["José", "Este es un mensaje de prueba de la plantilla de seguimiento."]
    );
    res.json({ ok: true, resultado });
  } catch (err) {
    console.error("[probar-plantilla] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
