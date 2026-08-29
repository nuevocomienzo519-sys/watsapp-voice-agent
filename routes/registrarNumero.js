// routes/registrarNumero.js
//
// Endpoint temporal para dar de alta (registrar) el número de WhatsApp en la
// Cloud API de Meta. Se usa cuando Meta responde:
//   "La cuenta no existe en la API de la nube. Usa /register API"
//
// Variables de entorno que usa (ya deberían existir en Render):
//   WHATSAPP_CLOUD_TOKEN o META_TOKEN  -> token de la app de Meta
//   WHATSAPP_PHONE_NUMBER_ID           -> Phone Number ID del número
//   REGISTRO_SECRET                    -> palabra secreta que tú inventes
//
// Uso desde el navegador:
//   https://watsapp-voice-agent.onrender.com/registrar-numero?secret=TU_SECRETO&pin=123456
//
// Para revisar el estado sin registrar nada:
//   https://watsapp-voice-agent.onrender.com/estado-numero?secret=TU_SECRETO
//
// IMPORTANTE: cuando el número quede registrado, borra este archivo y su
// línea en server.js. Es una herramienta de una sola vez.

const express = require("express");
const router = express.Router();

const GRAPH_VERSION = "v21.0";

function obtenerToken() {
  return (
    (process.env.WHATSAPP_CLOUD_TOKEN || process.env.META_TOKEN || "").trim()
  );
}

function obtenerPhoneNumberId() {
  return (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
}

function validarSecreto(req, res) {
  if (!process.env.REGISTRO_SECRET) {
    res.status(500).json({
      ok: false,
      error:
        "Falta la variable de entorno REGISTRO_SECRET en Render. Créala con cualquier palabra secreta.",
    });
    return false;
  }
  if (req.query.secret !== process.env.REGISTRO_SECRET) {
    res.status(403).json({ ok: false, error: "Secreto incorrecto." });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /estado-numero  -> revisa qué ve Meta del número, sin cambiar nada
// ---------------------------------------------------------------------------
router.get("/estado-numero", async (req, res) => {
  if (!validarSecreto(req, res)) return;

  const token = obtenerToken();
  const phoneNumberId = obtenerPhoneNumberId();

  const faltantes = [];
  if (!token) faltantes.push("WHATSAPP_CLOUD_TOKEN (o META_TOKEN)");
  if (!phoneNumberId) faltantes.push("WHATSAPP_PHONE_NUMBER_ID");
  if (faltantes.length) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno en Render",
      faltantes,
    });
  }

  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}` +
      `?fields=id,display_phone_number,verified_name,code_verification_status,` +
      `quality_rating,platform_type,throughput,name_status`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        paso: "consultar estado del número",
        respuesta_de_meta: data,
      });
    }

    return res.json({
      ok: true,
      phone_number_id: phoneNumberId,
      datos: data,
      nota:
        "Si 'platform_type' dice CLOUD_API, el número ya está registrado. " +
        "Si no aparece o marca error, hay que llamar /registrar-numero.",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /registrar-numero  -> hace el POST /register a la Cloud API
// ---------------------------------------------------------------------------
router.get("/registrar-numero", async (req, res) => {
  if (!validarSecreto(req, res)) return;

  const { pin } = req.query;
  if (!pin || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({
      ok: false,
      error:
        "El PIN debe ser exactamente 6 dígitos numéricos. Ejemplo: ?pin=482913",
    });
  }

  const token = obtenerToken();
  const phoneNumberId = obtenerPhoneNumberId();

  const faltantes = [];
  if (!token) faltantes.push("WHATSAPP_CLOUD_TOKEN (o META_TOKEN)");
  if (!phoneNumberId) faltantes.push("WHATSAPP_PHONE_NUMBER_ID");
  if (faltantes.length) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno en Render",
      faltantes,
    });
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          pin: String(pin),
        }),
      }
    );

    const data = await r.json();

    if (!r.ok) {
      const codigo = data?.error?.code;
      let pista = null;

      if (codigo === 190) {
        pista =
          "Token inválido o caducado. Genera uno nuevo desde el usuario del sistema en Meta Business y actualiza WHATSAPP_CLOUD_TOKEN en Render.";
      } else if (codigo === 133005) {
        pista =
          "El PIN no coincide con el de la verificación en dos pasos. Desactívala y reactívala en WhatsApp Manager con un PIN nuevo, y vuelve a intentar con ese mismo PIN.";
      } else if (codigo === 133016 || codigo === 131000) {
        pista =
          "Meta está limitando los intentos (rate limit). Espera 24 horas antes de volver a intentar.";
      } else if (codigo === 100) {
        pista =
          "Revisa que WHATSAPP_PHONE_NUMBER_ID sea el correcto y que el usuario del sistema tenga asignada la WABA con acceso total.";
      }

      return res.status(r.status).json({
        ok: false,
        paso: "POST /register",
        respuesta_de_meta: data,
        pista,
      });
    }

    return res.json({
      ok: true,
      mensaje: "Número registrado correctamente en la Cloud API.",
      respuesta_de_meta: data,
      siguientes_pasos: [
        "1. En Meta for Developers > tu app > WhatsApp > Configuración, pon el webhook: https://watsapp-voice-agent.onrender.com/webhooks/whatsapp-cloud",
        "2. Como token de verificación usa el valor de WHATSAPP_VERIFY_TOKEN que tienes en Render.",
        "3. Suscribe el campo 'messages'.",
        "4. Manda un WhatsApp de prueba al número y revisa los logs de Render.",
        "5. Borra routes/registrarNumero.js y su línea en server.js.",
      ],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
