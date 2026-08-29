// routes/ajustesNumero.js
//
// Herramientas de diagnóstico y configuración del número de WhatsApp.
//
// Resuelve el error 138000 ("Calling API not enabled") que impide enviar
// plantillas después de re-registrar el número en la Cloud API.
//
// Variables de entorno (ya existen en Render):
//   WHATSAPP_CLOUD_TOKEN o META_TOKEN
//   WHATSAPP_PHONE_NUMBER_ID
//   REGISTRO_SECRET
//
// Rutas:
//   GET /ver-ajustes?secret=...        -> muestra la configuración actual
//   GET /habilitar-llamadas?secret=... -> activa la Calling API
//   GET /ver-plantillas?secret=...     -> lista las plantillas y su estado

const express = require("express");
const router = express.Router();

const GRAPH_VERSION = "v21.0";

function token() {
  return (process.env.WHATSAPP_CLOUD_TOKEN || process.env.META_TOKEN || "").trim();
}
function phoneId() {
  return (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
}
function guard(req, res) {
  if (!process.env.REGISTRO_SECRET) {
    res.status(500).json({ ok: false, error: "Falta REGISTRO_SECRET en Render." });
    return false;
  }
  if (req.query.secret !== process.env.REGISTRO_SECRET) {
    res.status(403).json({ ok: false, error: "Secreto incorrecto." });
    return false;
  }
  if (!token() || !phoneId()) {
    res.status(500).json({
      ok: false,
      error: "Faltan WHATSAPP_CLOUD_TOKEN o WHATSAPP_PHONE_NUMBER_ID en Render.",
    });
    return false;
  }
  return true;
}

// --- Ver la configuración actual del número -------------------------------
router.get("/ver-ajustes", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId()}/settings`,
      { headers: { Authorization: `Bearer ${token()}` } }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({
      ok: r.ok,
      phone_number_id: phoneId(),
      ajustes: data,
      nota: "Revisa 'calling.status'. Si dice DISABLED, llama /habilitar-llamadas.",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Habilitar la Calling API ---------------------------------------------
router.get("/habilitar-llamadas", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId()}/settings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          calling: {
            status: "ENABLED",
            call_icon_visibility: "DEFAULT",
            callback_permission_status: "ENABLED",
          },
        }),
      }
    );
    const data = await r.json();

    if (!r.ok) {
      const codigo = data?.error?.code;
      let pista = null;
      if (codigo === 190) {
        pista = "Token inválido o caducado. Regenera WHATSAPP_CLOUD_TOKEN en Render.";
      } else if (codigo === 100) {
        pista =
          "Puede que esta cuenta no tenga disponible la función de llamadas. " +
          "Prueba activarla manualmente en WhatsApp Manager, en la ficha del número.";
      }
      return res.status(r.status).json({
        ok: false,
        paso: "POST /settings (calling)",
        respuesta_de_meta: data,
        pista,
      });
    }

    return res.json({
      ok: true,
      mensaje: "Llamadas habilitadas. Vuelve a probar el envío de la plantilla.",
      respuesta_de_meta: data,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Listar plantillas y su estado ----------------------------------------
router.get("/ver-plantillas", async (req, res) => {
  if (!guard(req, res)) return;

  const wabaId = (req.query.waba || process.env.WHATSAPP_WABA_ID || "").trim();
  if (!wabaId) {
    return res.status(400).json({
      ok: false,
      error:
        "Falta el WABA ID. Pásalo como &waba=XXXX o crea la variable WHATSAPP_WABA_ID en Render.",
    });
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates` +
        `?fields=name,status,language,category,components&limit=50`,
      { headers: { Authorization: `Bearer ${token()}` } }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, respuesta_de_meta: data });
    }

    const resumen = (data.data || []).map((t) => ({
      nombre: t.name,
      estado: t.status,
      idioma: t.language,
      categoria: t.category,
      tiene_botones: (t.components || []).some((c) => c.type === "BUTTONS"),
    }));

    return res.json({
      ok: true,
      total: resumen.length,
      plantillas: resumen,
      nota: "El agente busca 'seguimiento_contacto' en es_MX con estado APPROVED.",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
