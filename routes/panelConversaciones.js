// routes/panelConversaciones.js
//
// Panel web para ver las conversaciones del agente desde cualquier
// dispositivo, sin necesidad del celular donde vive el WhatsApp.
//
// Es de SOLO LECTURA: muestra los chats, no permite responder.
//
// Variable de entorno necesaria en Render:
//   PANEL_CLAVE  -> contraseña compartida del equipo
//
// Acceso:  https://watsapp-voice-agent.onrender.com/conversaciones

const express = require("express");
const router = express.Router();
const conversaciones = require("../lib/conversaciones");

function claveValida(req) {
  const esperada = process.env.PANEL_CLAVE;
  if (!esperada) return false;
  const recibida = req.query.clave || req.headers["x-panel-clave"];
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
  .wrap { max-width:820px; margin:0 auto; padding:12px; }
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
</style>
</head>
<body>
<header>
  <button id="volver" style="display:none">←</button>
  <span id="titulo">Conversaciones</span>
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

<script>
(function(){
  var clave = sessionStorage.getItem("panelClave") || "";
  var login = document.getElementById("login");
  var contenido = document.getElementById("contenido");
  var titulo = document.getElementById("titulo");
  var btnVolver = document.getElementById("volver");

  function fecha(iso){
    var d = new Date(iso), hoy = new Date();
    var mismaFecha = d.toDateString() === hoy.toDateString();
    return mismaFecha
      ? d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})
      : d.toLocaleDateString("es-MX",{day:"2-digit",month:"short"}) + " " +
        d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  }
  function esc(t){ var e=document.createElement("div"); e.textContent=t||""; return e.innerHTML; }

  async function pedir(url){
    var r = await fetch(url + (url.indexOf("?")>-1?"&":"?") + "clave=" + encodeURIComponent(clave));
    if (r.status === 403) throw new Error("403");
    return r.json();
  }

  async function verLista(){
    btnVolver.style.display = "none";
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
        var prefijo = c.rol === "assistant" ? "Asistente: " : "";
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
    btnVolver.style.display = "block";
    titulo.textContent = nombre || "Conversación";
    contenido.innerHTML = '<div class="cargando">Cargando…</div>';
    try {
      var d = await pedir("/api/conversaciones/" + encodeURIComponent(id));
      contenido.innerHTML = (d.mensajes||[]).map(function(m){
        return '<div class="msg '+(m.rol==="assistant"?"assistant":"user")+'">' +
               esc(m.texto) + '<span class="hora">'+fecha(m.creado_en)+'</span></div>';
      }).join("") || '<div class="vacio">Sin mensajes.</div>';
      window.scrollTo(0, document.body.scrollHeight);
    } catch(e){ manejarError(e); }
  }

  function manejarError(e){
    if (String(e.message) === "403") {
      sessionStorage.removeItem("panelClave");
      clave = "";
      login.style.display = "block";
      contenido.innerHTML = "";
      document.getElementById("errorLogin").textContent = "Contraseña incorrecta.";
    } else {
      contenido.innerHTML = '<div class="vacio">No se pudo cargar. Intenta de nuevo.</div>';
    }
  }

  btnVolver.onclick = verLista;
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
