// routes/panelConversaciones.js
//
// Panel web para ver las conversaciones del agente desde cualquier
// dispositivo, sin necesidad del celular donde vive el WhatsApp.
//
// Permite ver los chats Y responder mensajes de texto directo por la
// Cloud API (no solo lectura).
//
// Variable de entorno necesaria en Render:
//   PANEL_CLAVE  -> contraseña compartida del equipo
//
// Acceso:  https://watsapp-voice-agent.onrender.com/conversaciones

const express = require("express");
const router = express.Router();
const conversaciones = require("../lib/conversaciones");
const { sendTextMessage, sendImageMessage, enviarMensajePlantilla } = require("../lib/whatsappCloudClient");

const PLANTILLA_SEGUIMIENTO = process.env.PLANTILLA_SEGUIMIENTO || "seguimiento_contacto";
const PLANTILLA_IDIOMA = process.env.PLANTILLA_IDIOMA || "es_MX";
const PLANTILLA_SIN_PARAMETROS = process.env.PLANTILLA_SIN_PARAMETROS === "1";
const { generarSugerencia } = require("../lib/llm");

function claveValida(req) {
  const esperada = process.env.PANEL_CLAVE;
  if (!esperada) return false;
  const recibida = req.query.clave || req.headers["x-panel-clave"] || req.body?.clave;
  return recibida === esperada;
}

// --- API: lista de chats ---------------------------------------------------
router.get("/api/conversaciones", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  try {
    const chats = await conversaciones.listarChats(50);
    res.json({ ok: true, chats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: detalle de un chat ----------------------------------------------
router.get("/api/conversaciones/:chatId", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  try {
    const mensajes = await conversaciones.obtenerConversacion(req.params.chatId);
    res.json({ ok: true, mensajes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: responder un mensaje ---------------------------------------------
// Manda un mensaje de texto libre por la Cloud API al número (chatId) y lo
// guarda en el historial como turno del "assistant", para que se vea en el
// panel igual que si hubiera respondido el bot.
router.post("/api/conversaciones/:chatId/responder", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  const chatId = req.params.chatId;
  const texto = String(req.body?.texto || "").trim();
  if (!texto) return res.status(400).json({ ok: false, error: "Falta el texto del mensaje." });

  try {
    await sendTextMessage(chatId, texto);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  try {
    await conversaciones.guardarTurno({
      chatId,
      telefono: chatId,
      nombre: null,
      textoCliente: null,
      textoAgente: texto,
    });
  } catch (err) {
    console.error("[panel] Se envió el mensaje pero no se pudo guardar en el historial:", err.message);
  }

  res.json({ ok: true });
});

// --- API: enviar una foto de la galería --------------------------------
// Manda una imagen (por URL pública de la galería) al chat, sin que nadie
// tenga que descargarla ni volverla a subir a mano.
router.post("/api/conversaciones/:chatId/enviar-foto", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  const chatId = req.params.chatId;
  const url = String(req.body?.url || "").trim();
  if (!url) return res.status(400).json({ ok: false, error: "Falta la URL de la foto." });

  try {
    await sendImageMessage(chatId, url);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  try {
    await conversaciones.guardarMensajeSaliente({
      chatId,
      telefono: chatId,
      texto: null,
      adjuntoTipo: "image/jpeg",
      adjuntoMediaId: url,
      adjuntoNombre: "foto-galeria.jpg",
    });
  } catch (err) {
    console.error("[panel] No se pudo guardar la foto enviada en el historial:", err.message);
  }

  res.json({ ok: true });
});

// --- API: sugerencia de respuesta con IA ------------------------------------
// Lee el historial real del chat y le pide a Claude una propuesta de
// respuesta. Solo devuelve texto — nunca lo manda. El asesor decide.
router.post("/api/conversaciones/:chatId/sugerencia", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  try {
    const mensajes = await conversaciones.obtenerConversacion(req.params.chatId);
    const history = mensajes
      .filter((m) => m.texto)
      .map((m) => ({ role: m.rol === "assistant" ? "assistant" : "user", content: m.texto }));
    const sugerencia = await generarSugerencia(history);
    res.json({ ok: true, sugerencia });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
// --- API: agregar contacto nuevo y mandar plantilla de seguimiento ---------
router.post("/api/contactos/nuevo", async (req, res) => {
  if (!claveValida(req)) return res.status(403).json({ error: "Clave incorrecta" });
  let telefono = String(req.body?.telefono || "").trim().replace(/\D/g, "");
  const nombre = String(req.body?.nombre || "").trim() || null;

  if (telefono.length === 10) telefono = "52" + telefono;
  if (telefono.length !== 12) {
    return res.status(400).json({ ok: false, error: "Teléfono inválido. Usa 10 dígitos (ej. 4721234567)." });
  }

  try {
    await enviarMensajePlantilla(
      telefono,
      PLANTILLA_SEGUIMIENTO,
      PLANTILLA_IDIOMA,
      PLANTILLA_SIN_PARAMETROS
        ? []
        : [nombre || "hola", "Quedamos pendientes de tu interés en Diamante o Santuario."]
    );
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  try {
    await conversaciones.guardarMensajeSaliente({
      chatId: telefono,
      telefono,
      texto: `📤 Mensaje de seguimiento enviado${nombre ? " a " + nombre : ""}.`,
    });
  } catch (err) {
    console.error("[panel] No se pudo guardar el contacto nuevo en el historial:", err.message);
  }

  res.json({ ok: true, chatId: telefono });
});

// --- Página HTML -----------------------------------------------------------
// --- Página HTML -----------------------------------------------------------
router.get("/conversaciones", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conversaciones · Nuevo Comienzo</title>
<style>
  :root { --verde:#128C7E; --verdeClaro:#DCF8C6; --gris:#f0f2f5; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--gris); color:#111; }
  header { background:var(--verde); color:#fff; padding:14px 16px; font-weight:600;
           position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:10px; }
  header button { background:rgba(255,255,255,.2); border:0; color:#fff; border-radius:6px;
                  padding:6px 10px; font-size:14px; cursor:pointer; }
  .wrap { max-width:820px; margin:0 auto; padding:12px; padding-bottom:90px; }
  .login { background:#fff; border-radius:10px; padding:20px; margin-top:40px; }
  .login input { width:100%; padding:12px; font-size:16px; border:1px solid #ddd;
                 border-radius:8px; margin:10px 0; }
  .login button { width:100%; padding:12px; font-size:16px; background:var(--verde);
                  color:#fff; border:0; border-radius:8px; cursor:pointer; }
  .chat-item { background:#fff; border-radius:10px; padding:12px 14px; margin-bottom:8px;
               cursor:pointer; border:1px solid #e6e6e6; }
  .chat-item:active { background:#fafafa; }
  .chat-nombre { font-weight:600; font-size:15px; }
  .chat-prev { color:#667; font-size:14px; margin-top:4px; overflow:hidden;
               text-overflow:ellipsis; white-space:nowrap; }
  .chat-fecha { color:#99a; font-size:12px; margin-top:4px; }
  .msg { max-width:80%; padding:9px 12px; border-radius:10px; margin-bottom:8px;
         font-size:15px; line-height:1.4; white-space:pre-wrap; word-wrap:break-word; }
  .msg.user { background:#fff; margin-right:auto; }
  .msg.assistant { background:var(--verdeClaro); margin-left:auto; }
  .msg .hora { display:block; font-size:11px; color:#8a8; margin-top:4px; text-align:right; }
  .vacio { text-align:center; color:#889; padding:40px 20px; line-height:1.5; }
  .cargando { text-align:center; color:#889; padding:30px; }
  .responder { position:fixed; bottom:0; left:0; right:0; background:#fff;
               border-top:1px solid #e6e6e6; padding:10px; display:none; gap:8px; }
  .responder.activo { display:flex; }
  .responder-wrap { max-width:820px; margin:0 auto; display:flex; gap:8px; width:100%; }
  .responder textarea { flex:1; resize:none; border:1px solid #ddd; border-radius:20px;
                         padding:10px 14px; font-size:15px; font-family:inherit; max-height:100px; }
  .responder button { background:var(--verde); color:#fff; border:0; border-radius:50%;
                       width:44px; height:44px; flex-shrink:0; font-size:18px; cursor:pointer; }
  .responder button:disabled { opacity:.5; }
  .aviso { text-align:center; font-size:13px; padding:6px; }
  .aviso.ok { color:#128C7E; }
  .aviso.error { color:#c00; }
  .sugerencia { position:fixed; left:0; right:0; bottom:64px; background:#fffaf0;
                border-top:1px solid #f0dfb0; display:none; }
  .sugerencia.activo { display:block; }
  .sugerencia-wrap { max-width:820px; margin:0 auto; padding:10px 12px; }
  .sugerencia-cabecera { display:flex; justify-content:space-between; align-items:center;
                          font-size:13px; font-weight:600; color:#a67c00; }
  .sugerencia-cabecera button { background:#a67c00; color:#fff; border:0; border-radius:6px;
                                 padding:5px 10px; font-size:12px; cursor:pointer; }
  .sugerencia-cabecera button:disabled { opacity:.5; }
  .sugerencia-texto { font-size:14px; color:#333; margin-top:6px; white-space:pre-wrap;
                       max-height:120px; overflow-y:auto; }
  .sugerencia-acciones { margin-top:6px; }
  .sugerencia-acciones button { background:var(--verde); color:#fff; border:0; border-radius:6px;
                                 padding:6px 12px; font-size:13px; cursor:pointer; }
  .fotos-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:50; }
  .fotos-modal.activo { display:flex; align-items:flex-end; justify-content:center; }
  .fotos-modal-inner { background:#fff; width:100%; max-width:820px; max-height:80vh;
                        border-radius:14px 14px 0 0; display:flex; flex-direction:column; overflow:hidden; }
  .fotos-modal-header { display:flex; justify-content:space-between; align-items:center;
                         padding:14px 16px; border-bottom:1px solid #eee; font-weight:600; }
  .fotos-modal-header button { background:none; border:0; font-size:18px; cursor:pointer; color:#666; }
  .fotos-lista { overflow-y:auto; padding:12px 16px 24px; }
  .fotos-proyecto-titulo { font-weight:700; font-size:15px; margin:14px 0 6px; color:#1F4E78; }
  .fotos-modelo-titulo { font-weight:600; font-size:13px; margin:10px 0 6px; color:#555; }
  .fotos-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:6px; }
  .fotos-grid img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; cursor:pointer;
                     border:2px solid transparent; }
  .fotos-grid img:active { border-color:var(--verde); opacity:.8; }
</style>
</head>
<body>
<header>
  <button id="volver" style="display:none">←</button>
  <span id="titulo">Conversaciones</span>
  <a href="/galeria/" target="_blank" id="linkCatalogo" style="margin-left:auto;color:#fff;text-decoration:none;font-size:13px;background:rgba(255,255,255,.2);padding:6px 10px;border-radius:6px">📁 Catálogo</a>
  <button id="btnNuevoContacto" style="margin-left:8px;background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer">➕ Contacto</button>
  <button id="btnFotos" style="display:none">📷 Fotos</button>
</header>
<div class="wrap" id="app">
  <div class="login" id="login">
    <div style="font-weight:600;margin-bottom:6px">Acceso del equipo</div>
    <input type="password" id="clave" placeholder="Contraseña" autocomplete="current-password">
    <button id="entrar">Entrar</button>
    <div id="errorLogin" style="color:#c00;font-size:14px;margin-top:8px"></div>
  </div>
  <div id="contenido"></div>
</div>
<div class="sugerencia" id="sugerencia">
  <div class="sugerencia-wrap">
    <div class="sugerencia-cabecera">
      <span>💡 Sugerencia con IA</span>
      <button id="btnGenerarSugerencia">Generar</button>
    </div>
    <div id="sugerenciaTexto" class="sugerencia-texto"></div>
    <div id="sugerenciaAcciones" class="sugerencia-acciones" style="display:none">
      <button id="btnUsarSugerencia">Usar esta respuesta</button>
    </div>
  </div>
</div>
<div class="fotos-modal" id="nuevoContactoModal">
  <div class="fotos-modal-inner">
    <div class="fotos-modal-header">
      <span>Agregar contacto nuevo</span>
      <button id="cerrarNuevoContacto">✕</button>
    </div>
    <div style="padding:16px">
      <div style="margin-bottom:10px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Teléfono (10 dígitos)</label>
        <input type="tel" id="inputTelefonoNuevo" placeholder="4721234567" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Nombre (opcional)</label>
        <input type="text" id="inputNombreNuevo" placeholder="Nombre del cliente" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <button id="btnEnviarNuevoContacto" style="width:100%;padding:12px;background:var(--verde);color:#fff;border:0;border-radius:8px;font-size:15px;cursor:pointer">Enviar plantilla de seguimiento</button>
      <div id="avisoNuevoContacto" style="text-align:center;font-size:13px;margin-top:8px"></div>
    </div>
  </div>
</div>
<div class="fotos-modal" id="nuevoContactoModal">
  <div class="fotos-modal-inner">
    <div class="fotos-modal-header">
      <span>Agregar contacto nuevo</span>
      <button id="cerrarNuevoContacto">✕</button>
    </div>
    <div style="padding:16px">
      <div style="margin-bottom:10px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Teléfono (10 dígitos)</label>
        <input type="tel" id="inputTelefonoNuevo" placeholder="4721234567" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Nombre (opcional)</label>
        <input type="text" id="inputNombreNuevo" placeholder="Nombre del cliente" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <button id="btnEnviarNuevoContacto" style="width:100%;padding:12px;background:var(--verde);color:#fff;border:0;border-radius:8px;font-size:15px;cursor:pointer">Enviar plantilla de seguimiento</button>
      <div id="avisoNuevoContacto" style="text-align:center;font-size:13px;margin-top:8px"></div>
    </div>
  </div>
</div>
<div class="fotos-modal" id="fotosModal">
  <div class="fotos-modal-inner">
    <div class="fotos-modal-header">
      <span>Enviar foto de la galería</span>
      <button id="cerrarFotos">✕</button>
    </div>
    <div id="fotosLista" class="fotos-lista"><div class="cargando">Cargando…</div></div>
  </div>
</div>
<div class="responder" id="responder">
  <div class="responder-wrap">
    <textarea id="textoResponder" rows="1" placeholder="Escribe una respuesta…"></textarea>
    <button id="btnEnviar">➤</button>
  </div>
</div>

<script>
(function(){
  var clave = sessionStorage.getItem("panelClave") || "";
  var login = document.getElementById("login");
  var contenido = document.getElementById("contenido");
  var titulo = document.getElementById("titulo");
  var btnVolver = document.getElementById("volver");
  var barraResponder = document.getElementById("responder");
  var textoResponder = document.getElementById("textoResponder");
  var btnEnviar = document.getElementById("btnEnviar");
  var cajaSugerencia = document.getElementById("sugerencia");
  var btnGenerarSugerencia = document.getElementById("btnGenerarSugerencia");
  var sugerenciaTexto = document.getElementById("sugerenciaTexto");
  var sugerenciaAcciones = document.getElementById("sugerenciaAcciones");
  var btnUsarSugerencia = document.getElementById("btnUsarSugerencia");
  var btnFotos = document.getElementById("btnFotos");
  var fotosModal = document.getElementById("fotosModal");
  var fotosLista = document.getElementById("fotosLista");
  var cerrarFotosBtn = document.getElementById("cerrarFotos");
  var manifestCache = null;
  var chatActualId = null;

  function fecha(iso){
    var d = new Date(iso), hoy = new Date();
    var mismaFecha = d.toDateString() === hoy.toDateString();
    return mismaFecha
      ? d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})
      : d.toLocaleDateString("es-MX",{day:"2-digit",month:"short"}) + " " +
        d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  }
  function esc(t){ var e=document.createElement("div"); e.textContent=t||""; return e.innerHTML; }

  async function pedir(url, opciones){
    var sep = url.indexOf("?")>-1?"&":"?";
    var r = await fetch(url + sep + "clave=" + encodeURIComponent(clave), opciones);
    if (r.status === 403) throw new Error("403");
    return r.json();
  }

  async function verLista(){
    chatActualId = null;
    barraResponder.classList.remove("activo");
    cajaSugerencia.classList.remove("activo");
    sugerenciaTexto.textContent = "";
    sugerenciaAcciones.style.display = "none";
    btnVolver.style.display = "none";
    btnFotos.style.display = "none";
    titulo.textContent = "Conversaciones";
    contenido.innerHTML = '<div class="cargando">Cargando…</div>';
    try {
      var d = await pedir("/api/conversaciones");
      if (!d.chats || !d.chats.length) {
        contenido.innerHTML = '<div class="vacio">Todavía no hay conversaciones guardadas.<br>' +
          'Aparecerán aquí en cuanto un cliente escriba al número.</div>';
        return;
      }
      contenido.innerHTML = d.chats.map(function(c){
        var quien = c.nombre || c.telefono || c.chat_id;
        var prefijo = c.rol === "assistant" ? "Tú: " : "";
        return '<div class="chat-item" data-id="'+esc(c.chat_id)+'" data-nom="'+esc(quien)+'">' +
               '<div class="chat-nombre">'+esc(quien)+'</div>' +
               '<div class="chat-prev">'+esc(prefijo + (c.texto||""))+'</div>' +
               '<div class="chat-fecha">'+fecha(c.creado_en)+'</div></div>';
      }).join("");
      Array.prototype.forEach.call(contenido.querySelectorAll(".chat-item"), function(el){
        el.onclick = function(){ verChat(el.getAttribute("data-id"), el.getAttribute("data-nom")); };
      });
    } catch(e){ manejarError(e); }
  }

  async function verChat(id, nombre){
    chatActualId = id;
    btnVolver.style.display = "block";
    titulo.textContent = nombre || "Conversación";
    contenido.innerHTML = '<div class="cargando">Cargando…</div>';
    barraResponder.classList.add("activo");
    cajaSugerencia.classList.add("activo");
    sugerenciaTexto.textContent = "";
    sugerenciaAcciones.style.display = "none";
    btnFotos.style.display = "inline-block";
    try {
      var d = await pedir("/api/conversaciones/" + encodeURIComponent(id));
      contenido.innerHTML = (d.mensajes||[]).map(function(m){
        return '<div class="msg '+(m.rol==="assistant"?"assistant":"user")+'">' +
               esc(m.texto) + '<span class="hora">'+fecha(m.creado_en)+'</span></div>';
      }).join("") || '<div class="vacio">Sin mensajes.</div>';
      window.scrollTo(0, document.body.scrollHeight);
      textoResponder.focus();
      generarSugerenciaIA();
    } catch(e){ manejarError(e); }
  }

  async function enviarRespuesta(){
    var texto = textoResponder.value.trim();
    if (!texto || !chatActualId) return;
    btnEnviar.disabled = true;
    try {
      var r = await fetch("/api/conversaciones/" + encodeURIComponent(chatActualId) + "/responder?clave=" + encodeURIComponent(clave), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: texto })
      });
      var d = await r.json();
      if (r.status === 403) { manejarError(new Error("403")); return; }
      if (!d.ok) {
        alert("No se pudo enviar: " + (d.error || "error desconocido"));
        return;
      }
      textoResponder.value = "";
      var idActual = chatActualId, nombreActual = titulo.textContent;
      await verChat(idActual, nombreActual);
    } catch (e) {
      alert("No se pudo enviar: " + e.message);
    } finally {
      btnEnviar.disabled = false;
    }
  }

  async function generarSugerenciaIA(){
    if (!chatActualId) return;
    btnGenerarSugerencia.disabled = true;
    sugerenciaTexto.textContent = "Pensando…";
    sugerenciaAcciones.style.display = "none";
    try {
      var r = await fetch("/api/conversaciones/" + encodeURIComponent(chatActualId) + "/sugerencia?clave=" + encodeURIComponent(clave), {
        method: "POST"
      });
      var d = await r.json();
      if (r.status === 403) { manejarError(new Error("403")); return; }
      if (!d.ok) {
        sugerenciaTexto.textContent = "No se pudo generar: " + (d.error || "error desconocido");
        return;
      }
      sugerenciaTexto.textContent = d.sugerencia || "(sin respuesta)";
      sugerenciaAcciones.style.display = "block";
    } catch (e) {
      sugerenciaTexto.textContent = "No se pudo generar: " + e.message;
    } finally {
      btnGenerarSugerencia.disabled = false;
    }
  }

  function usarSugerencia(){
    textoResponder.value = sugerenciaTexto.textContent;
    textoResponder.focus();
  }
<div class="fotos-modal" id="nuevoContactoModal">
  <div class="fotos-modal-inner">
    <div class="fotos-modal-header">
      <span>Agregar contacto nuevo</span>
      <button id="cerrarNuevoContacto">✕</button>
    </div>
    <div style="padding:16px">
      <div style="margin-bottom:10px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Teléfono (10 dígitos)</label>
        <input type="tel" id="inputTelefonoNuevo" placeholder="4721234567" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:13px;color:#555;display:block;margin-bottom:4px">Nombre (opcional)</label>
        <input type="text" id="inputNombreNuevo" placeholder="Nombre del cliente" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
      </div>
      <button id="btnEnviarNuevoContacto" style="width:100%;padding:12px;background:var(--verde);color:#fff;border:0;border-radius:8px;font-size:15px;cursor:pointer">Enviar plantilla de seguimiento</button>
      <div id="avisoNuevoContacto" style="text-align:center;font-size:13px;margin-top:8px"></div>
    </div>
  </div>
</div>
var btnNuevoContacto = document.getElementById("btnNuevoContacto");
var nuevoContactoModal = document.getElementById("nuevoContactoModal");
var cerrarNuevoContactoBtn = document.getElementById("cerrarNuevoContacto");
var inputTelefonoNuevo = document.getElementById("inputTelefonoNuevo");
var inputNombreNuevo = document.getElementById("inputNombreNuevo");
var btnEnviarNuevoContacto = document.getElementById("btnEnviarNuevoContacto");
var avisoNuevoContacto = document.getElementById("avisoNuevoContacto");

btnNuevoContacto.onclick = function(){
  nuevoContactoModal.classList.add("activo");
  avisoNuevoContacto.textContent = "";
  inputTelefonoNuevo.value = "";
  inputNombreNuevo.value = "";
};
cerrarNuevoContactoBtn.onclick = function(){ nuevoContactoModal.classList.remove("activo"); };

btnEnviarNuevoContacto.onclick = async function(){
  var tel = inputTelefonoNuevo.value.replace(/\D/g,"");
  var nombre = inputNombreNuevo.value.trim();
  if (tel.length !== 10) {
    avisoNuevoContacto.className = "aviso error";
    avisoNuevoContacto.textContent = "Teléfono inválido. Usa 10 dígitos (ej. 4721234567).";
    return;
  }
  btnEnviarNuevoContacto.disabled = true;
  avisoNuevoContacto.className = "aviso";
  avisoNuevoContacto.textContent = "Enviando…";
  try {
    var r = await fetch("/api/contactos/nuevo?clave=" + encodeURIComponent(clave), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono: tel, nombre: nombre })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || "Error desconocido");
    avisoNuevoContacto.className = "aviso ok";
    avisoNuevoContacto.textContent = "✅ Mensaje enviado.";
    setTimeout(function(){
      nuevoContactoModal.classList.remove("activo");
      verLista();
    }, 900);
  } catch (e) {
    avisoNuevoContacto.className = "aviso error";
    avisoNuevoContacto.textContent = "❌ " + e.message;
  } finally {
    btnEnviarNuevoContacto.disabled = false;
  }
};

async function abrirFotos(){
  async function abrirFotos(){
    fotosModal.classList.add("activo");
    if (manifestCache) { pintarFotos(manifestCache); return; }
    fotosLista.innerHTML = '<div class="cargando">Cargando…</div>';
    try {
      var r = await fetch("/galeria/manifest.json");
      manifestCache = await r.json();
      pintarFotos(manifestCache);
    } catch (e) {
      fotosLista.innerHTML = '<div class="vacio">No se pudo cargar la galería.</div>';
    }
  }

  function pintarFotos(manifest){
    var html = "";
    (manifest.proyectos || []).forEach(function(proy){
      html += '<div class="fotos-proyecto-titulo">' + esc(proy.nombre) + '</div>';
      (proy.modelos || []).forEach(function(modelo){
        var fotos = (modelo.fotos || []).slice(0, 6);
        if (!fotos.length) return;
        html += '<div class="fotos-modelo-titulo">' + esc(modelo.nombre) +
                (modelo.preventa ? ' (Preventa)' : '') + '</div>';
        html += '<div class="fotos-grid">';
        fotos.forEach(function(foto){
          var url = location.origin + "/galeria/" + (foto.url || foto);
          html += '<img src="' + esc(url) + '" data-url="' + esc(url) + '">';
        });
        html += '</div>';
      });
    });
    fotosLista.innerHTML = html || '<div class="vacio">No hay fotos en la galería.</div>';
    Array.prototype.forEach.call(fotosLista.querySelectorAll("img"), function(img){
      img.onclick = function(){ enviarFotoGaleria(img.getAttribute("data-url")); };
    });
  }

  async function enviarFotoGaleria(url){
    if (!chatActualId || !url) return;
    try {
      var r = await fetch("/api/conversaciones/" + encodeURIComponent(chatActualId) + "/enviar-foto?clave=" + encodeURIComponent(clave), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url })
      });
      var d = await r.json();
      if (r.status === 403) { manejarError(new Error("403")); return; }
      if (!d.ok) { alert("No se pudo enviar la foto: " + (d.error || "error desconocido")); return; }
      fotosModal.classList.remove("activo");
      var idActual = chatActualId, nombreActual = titulo.textContent;
      await verChat(idActual, nombreActual);
    } catch (e) {
      alert("No se pudo enviar la foto: " + e.message);
    }
  }

  function manejarError(e){
    if (String(e.message) === "403") {
      sessionStorage.removeItem("panelClave");
      clave = "";
      login.style.display = "block";
      contenido.innerHTML = "";
      barraResponder.classList.remove("activo");
      document.getElementById("errorLogin").textContent = "Contraseña incorrecta.";
    } else {
      contenido.innerHTML = '<div class="vacio">No se pudo cargar. Intenta de nuevo.</div>';
    }
  }

  btnVolver.onclick = verLista;
  btnEnviar.onclick = enviarRespuesta;
  btnGenerarSugerencia.onclick = generarSugerenciaIA;
  btnUsarSugerencia.onclick = usarSugerencia;
  btnFotos.onclick = abrirFotos;
  cerrarFotosBtn.onclick = function(){ fotosModal.classList.remove("activo"); };
  textoResponder.addEventListener("keydown", function(ev){
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviarRespuesta(); }
  });
  document.getElementById("entrar").onclick = function(){
    clave = document.getElementById("clave").value.trim();
    if (!clave) return;
    sessionStorage.setItem("panelClave", clave);
    login.style.display = "none";
    document.getElementById("errorLogin").textContent = "";
    verLista();
  };
  document.getElementById("clave").addEventListener("keydown", function(ev){
    if (ev.key === "Enter") document.getElementById("entrar").click();
  });

  if (clave) { login.style.display = "none"; verLista(); }
})();
</script>
</body>
</html>`);
});

module.exports = router;
