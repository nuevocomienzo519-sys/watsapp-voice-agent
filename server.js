require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");
const { downloadAttachment, sendVoiceMessage, sendTextMessage } = require("./lib/whatsappCloudClient");
const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const { parseWhatsappCloudPayload, isAudioAttachment } = require("./lib/whatsappCloudPayload");
const {
  procesarChatExportado,
  actualizarTelefonoContacto,
  enviarTarjetaContacto,
} = require("./lib/chatExportadoCore");
const { extraerTelefono } = require("./lib/parseChatExport");
const {
  guardarPendiente,
  leerPendiente,
  borrarPendiente,
} = require("./lib/confirmacionesPendientes");
const exportacion = require("./lib/exportacionPendiente");
const { enviarMensajePlantilla } = require("./lib/whatsappCloudClient");
const { actualizarNombreContacto } = require("./lib/hubspot");

// Plantilla aprobada en Meta para retomar el contacto con el cliente.
const PLANTILLA_SEGUIMIENTO = process.env.PLANTILLA_SEGUIMIENTO || "seguimiento_contacto";
const PLANTILLA_IDIOMA = process.env.PLANTILLA_IDIOMA || "es_MX";

/**
 * Cierra una exportación: guarda nombre y teléfono en HubSpot, le manda al
 * cliente el mensaje de seguimiento por plantilla, y desbloquea el chat.
 * Si el envío de la plantilla falla, la exportación se cierra igual (los
 * datos ya quedaron en el CRM) y se avisa para mandarlo a mano.
 */
async function cerrarExportacion(chatId, pendiente) {
  const { contactoId, nombreCliente, telefono, resumenConversacion } = pendiente;

  if (contactoId && nombreCliente) {
    try {
      await actualizarNombreContacto(contactoId, nombreCliente);
    } catch (err) {
      console.error("[exportacion] No se pudo actualizar el nombre:", err.message);
    }
  }
  if (contactoId && telefono) {
    await actualizarTelefonoContacto(contactoId, telefono);
  }

  let avisoEnvio;
  try {
    const primerNombre = String(nombreCliente).trim().split(/\s+/)[0];
    const linea =
      resumenConversacion ||
      "Quedamos pendientes de tu interés en una de nuestras casas.";
    await enviarMensajePlantilla(
      telefono.replace(/^\+/, ""),
      PLANTILLA_SEGUIMIENTO,
      PLANTILLA_IDIOMA,
      [primerNombre, linea.slice(0, 250)]
    );
    avisoEnvio = `📤 Mensaje de seguimiento enviado a ${telefono}.`;
  } catch (err) {
    console.error("[exportacion] Falló el envío de la plantilla:", err.message);
    avisoEnvio =
      `⚠️ Guardé todo en HubSpot, pero no salió el mensaje automático ` +
      `(${err.message}). Escríbele tú a ${telefono}.`;
  }

  exportacion.cerrar(chatId);
  await sendTextMessage(
    chatId,
    exportacion.terminado(nombreCliente, telefono, avisoEnvio)
  );
}
const extraerFotosRouter = require("./routes/extraerFotos");
const openaiProxyRouter = require("./routes/openaiProxy");
const registrarNumeroRouter = require("./routes/registrarNumero");
const panelConversacionesRouter = require("./routes/panelConversaciones");
const ajustesNumeroRouter = require("./routes/ajustesNumero");
const conversaciones = require("./lib/conversaciones");

const app = express();
app.use(compression());
const crypto = require("crypto");

app.use(
  express.json({
    limit: "20mb",
    // Guarda el body crudo (antes de parsear JSON) para poder verificar
    // la firma que manda Meta en cada webhook — así confirmamos que el
    // mensaje realmente viene de Meta y no de alguien más pegándole a
    // esta URL pública.
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

function firmaWhatsappValida(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // sin app secret configurado, no se valida (no recomendado en producción)
  const firmaRecibida = req.get("x-hub-signature-256");
  if (!firmaRecibida || !req.rawBody) return false;
  const firmaEsperada =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(firmaRecibida), Buffer.from(firmaEsperada));
  } catch {
    return false; // longitudes distintas u otro error de formato
  }
}
app.use(extraerFotosRouter);
app.use(openaiProxyRouter);
app.use(registrarNumeroRouter);
app.use(panelConversacionesRouter);
app.use(ajustesNumeroRouter);
// Asistente privado del director, en /asistente (protegido con contraseña).
app.use(require("./routes/asistente"));

// Mismos identificadores ("slugs") que ya usa la propiedad "Asesor" en
// HubSpot (ver lib/hubspot.js) — así el link ?asesor=irle, por ejemplo, es
// consistente con el resto del sistema en vez de inventar otro criterio.
const ASESORES = {
  miguel_mondragon: { nombre: "Miguel Mondragon", iniciales: "MM" },
  irle: { nombre: "Irly Lopez", iniciales: "IL" },
  jessica: { nombre: "Jessica García", iniciales: "JG" },
  alejandro: { nombre: "Alejandro Santibañez", iniciales: "AS" },
  noemi: { nombre: "Noemí Lopez", iniciales: "NL" },
  raquel: { nombre: "Raquel Rey", iniciales: "RR" },
};
const ASESOR_DEFAULT = "miguel_mondragon";

function resolverAsesor(query) {
  const slug = ASESORES[query?.asesor] ? query.asesor : ASESOR_DEFAULT;
  return { slug, ...ASESORES[slug] };
}

// Página individual por modelo (server-rendered) con etiquetas Open Graph
// (og:image, og:title, og:description). Se usa como URL para "Compartir
// modelo" en la galería: a diferencia de la página principal (que carga
// las fotos con JavaScript, invisible para el rastreador de Facebook),
// esta ruta manda el HTML con la foto de portada ya incluida en el <head>,
// así que Facebook/WhatsApp SÍ pueden mostrar la imagen en la vista previa
// del link (posts, Messenger, anuncios de tipo "un solo link"). Un humano
// que abre el link es redirigido al instante a la galería normal.
app.get("/galeria/modelo/:proyectoId/:modeloId", (req, res) => {
  try {
    const manifestPath = path.join(__dirname, "public-galeria", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const proyecto = manifest.proyectos.find((p) => p.id === req.params.proyectoId);
    const modelo = proyecto && proyecto.modelos.find((m) => m.id === req.params.modeloId);

    if (!proyecto || !modelo) {
      return res.redirect("/galeria/");
    }

    const asesor = resolverAsesor(req.query);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imagenAbsoluta = `${baseUrl}/galeria/${modelo.portada}`;
    const precio = modelo.precioFormato || "Consultar precio";
    const titulo = `${modelo.nombre} — ${precio} | ${asesor.nombre}`;
    const descripcion = `${proyecto.nombre}, Franco, Silao · Gto. ${modelo.totalFotos} fotos disponibles.`;
    const urlPagina = `${baseUrl}/galeria/modelo/${proyecto.id}/${modelo.id}?asesor=${asesor.slug}`;
    const destinoGaleria = `/galeria/?asesor=${asesor.slug}#${proyecto.id}/${modelo.id}`;

    const escapar = (s) => String(s).replace(/"/g, "&quot;");

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descripcion)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapar(asesor.nombre)}" />
<meta property="og:title" content="${escapar(titulo)}" />
<meta property="og:description" content="${escapar(descripcion)}" />
<meta property="og:image" content="${escapar(imagenAbsoluta)}" />
<meta property="og:image:secure_url" content="${escapar(imagenAbsoluta)}" />
<meta property="og:url" content="${escapar(urlPagina)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapar(titulo)}" />
<meta name="twitter:image" content="${escapar(imagenAbsoluta)}" />
</head>
<body>
<p>Abriendo <a href="${escapar(destinoGaleria)}">${escapar(titulo)}</a>…</p>
<script>location.replace(${JSON.stringify(destinoGaleria)});</script>
</body>
</html>`);
  } catch (err) {
    console.error("Error en /galeria/modelo/:proyectoId/:modeloId:", err);
    res.redirect("/galeria/");
  }
});

// Página individual por FOTO (server-rendered) con etiquetas Open Graph.
// Se usa como respaldo cuando "Compartir seleccionadas" (dentro del visor
// de una propiedad) no puede adjuntar las fotos como archivo real —por
// ejemplo en computadora/WhatsApp Web, donde el navegador no soporta
// compartir archivos—: en vez de mandar el link directo a la imagen (que
// WhatsApp muestra como texto plano, sin vista previa), se manda este
// link, que trae la foto exacta en el <head> vía og:image, así que
// WhatsApp SÍ la muestra como una tarjeta con miniatura de foto.
app.get("/galeria/foto/:proyectoId/:modeloId/:tab/:index", (req, res) => {
  try {
    const manifestPath = path.join(__dirname, "public-galeria", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const proyecto = manifest.proyectos.find((p) => p.id === req.params.proyectoId);
    const modelo = proyecto && proyecto.modelos.find((m) => m.id === req.params.modeloId);
    const tab = req.params.tab === "fotosAdicionales" ? "fotosAdicionales" : "fotos";
    const indice = parseInt(req.params.index, 10);
    const foto = modelo && Array.isArray(modelo[tab]) ? modelo[tab][indice] : null;

    if (!proyecto || !modelo || !foto) {
      return res.redirect("/galeria/");
    }

    const asesor = resolverAsesor(req.query);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imagenAbsoluta = `${baseUrl}/galeria/${foto}`;
    const precio = modelo.precioFormato || "Consultar precio";
    const titulo = `${modelo.nombre} — ${precio} | ${asesor.nombre}`;
    const descripcion = `${proyecto.nombre}, Franco, Silao · Gto.`;
    const urlPagina = `${baseUrl}/galeria/foto/${proyecto.id}/${modelo.id}/${tab}/${indice}?asesor=${asesor.slug}`;
    const destinoGaleria = `/galeria/?asesor=${asesor.slug}#${proyecto.id}/${modelo.id}/f/${tab}/${indice}`;

    const escapar = (s) => String(s).replace(/"/g, "&quot;");

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descripcion)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapar(asesor.nombre)}" />
<meta property="og:title" content="${escapar(titulo)}" />
<meta property="og:description" content="${escapar(descripcion)}" />
<meta property="og:image" content="${escapar(imagenAbsoluta)}" />
<meta property="og:image:secure_url" content="${escapar(imagenAbsoluta)}" />
<meta property="og:url" content="${escapar(urlPagina)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapar(titulo)}" />
<meta name="twitter:image" content="${escapar(imagenAbsoluta)}" />
</head>
<body>
<p>Abriendo <a href="${escapar(destinoGaleria)}">${escapar(titulo)}</a>…</p>
<script>location.replace(${JSON.stringify(destinoGaleria)});</script>
</body>
</html>`);
  } catch (err) {
    console.error("Error en /galeria/foto/:proyectoId/:modeloId/:tab/:index:", err);
    res.redirect("/galeria/");
  }
});

app.get("/galeria/asesores.json", (req, res) => {
  res.json({ asesores: ASESORES, default: ASESOR_DEFAULT });
});

// Galería web pública de fotos (Diamante y Santuario), para compartir por
// WhatsApp. Sirve todo lo que hay en public-galeria/ (index.html, style.css,
// app.js, manifest.json y la carpeta fotos/) en https://TU-DOMINIO/galeria/
// Para regenerar manifest.json después de agregar/quitar fotos, correr:
//   node scripts/generarManifest.js
app.use(
  "/galeria",
  express.static(path.join(__dirname, "public-galeria"), {
    // Por defecto SIN caché larga — así cualquier cambio a app.js,
    // index.html, style.css o videos.json se ve de inmediato la próxima
    // vez que alguien del equipo abra la galería, sin que se quede
    // "pegada" una versión vieja por varios días. El navegador igual
    // valida con el servidor (ETag) y en general no baja el archivo de
    // nuevo si no cambió, así que no es lento — solo evita que quede
    // atorado cuando SÍ cambió.
    maxAge: 0,
    setHeaders: (res, filePath) => {
      // La caché larga de 7 días aplica SOLO a las fotos reales dentro de
      // fotos/ (esas prácticamente nunca cambian una vez subidas) — ahí sí
      // vale la pena evitar re-descargarlas en cada visita.
      if (filePath.includes(`${path.sep}fotos${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=604800"); // 7 días
      }
    },
  })
);

// Evita procesar el mismo mensaje dos veces si Meta reintenta el webhook.
const processedMessageIds = new Set();

// ⚠️ AVISO: este filtro identificaba el grupo "Los Miguelines" por su
// chat_id de TimelinesAI (57693202) — un concepto que existía porque
// TimelinesAI sincronizaba tu WhatsApp Web completo, grupos incluidos. La
// API oficial de WhatsApp Cloud (Meta) NO funciona así: es exclusiva para
// conversaciones directas con clientes en el número de negocio, y por lo
// general NO recibe ni permite mensajes de grupos. Es decir, es probable
// que este filtro ya no tenga ningún chat que silenciar — no se quitó el
// código por si acaso, pero probablemente ya no aplica. Si necesitas que
// el equipo interactúe con el bot para pruebas, habrá que pensar otro
// mecanismo (ej. un chat 1-a-1 dedicado a pruebas).
const CHATS_SILENCIADOS = new Set([57693202]);
const PALABRA_ACTIVACION = "@asistentewaba";

// Historial de conversación por chat, para que Claude recuerde el
// contexto entre mensajes. Se guarda en memoria del proceso: se
// reinicia si el servicio se reinicia o redespliega en Render.
const conversationHistory = new Map();
const MAX_HISTORY_MESSAGES = 20; // ~10 turnos (usuario + asistente)

function getHistory(chatId) {
  return conversationHistory.get(chatId) || [];
}

// Historial que sobrevive a los reinicios de Render: intenta Postgres y,
// si no está configurado o falla, cae al historial en memoria de siempre.
async function getHistoryPersistente(chatId) {
  if (conversaciones.habilitado()) {
    const desdeBD = await conversaciones.obtenerHistorial(chatId);
    if (desdeBD.length) return desdeBD;
  }
  return getHistory(chatId);
}

function appendHistory(chatId, userText, replyText) {
  const historial = getHistory(chatId);
  historial.push({ role: "user", content: userText });
  historial.push({ role: "assistant", content: replyText });
  while (historial.length > MAX_HISTORY_MESSAGES) historial.shift();
  conversationHistory.set(chatId, historial);
}

// Meta llama a esta ruta UNA VEZ, al activar el webhook desde el panel de
// Meta for Developers (WhatsApp > Configuración > Webhook), para
// confirmar que el servidor es tuyo. Debe responder EXACTAMENTE el valor
// de "hub.challenge" si el "hub.verify_token" coincide con el que tú
// definiste en Meta y en la variable de entorno WHATSAPP_VERIFY_TOKEN.
app.get("/webhooks/whatsapp-cloud", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhooks/whatsapp-cloud", async (req, res) => {
  if (!firmaWhatsappValida(req)) {
    return res.status(401).send("Firma inválida");
  }

  // Responde rápido a Meta para que no reintente por timeout; el
  // procesamiento real sigue después, de forma asíncrona.
  res.status(200).send("OK");

  try {
    // Log completo del payload. Déjalo activo las primeras semanas: si
    // algo del mapeo de abajo no aplica, aquí está la fuente de verdad
    // para corregirlo en lib/whatsappCloudPayload.js.
    console.log("Payload recibido de WhatsApp Cloud API:", JSON.stringify(req.body, null, 2));

    const { messageId, chatId, direction, phone, senderName, attachment, text } =
      parseWhatsappCloudPayload(req.body);

    if (!messageId || processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);

    if (direction !== "incoming" || !chatId) {
      return; // webhooks de status (✓✓ entregado/leído) u otros eventos sin mensaje
    }

    const audioAdjunto = isAudioAttachment(attachment);

    // ------------------------------------------------------------------
    // CANDADO DE EXPORTACIÓN PENDIENTE
    // Va ANTES que todo: si este chat dejó una exportación a medias, el
    // agente no hace ninguna otra cosa aquí — ni responde preguntas, ni
    // transcribe notas de voz, ni acepta otro zip — hasta que se complete
    // o se cancele.
    // ------------------------------------------------------------------
    const pendienteExport = exportacion.leer(chatId);
    if (pendienteExport) {
      const respuesta = (text || "").trim();

      if (exportacion.esCancelacion(respuesta)) {
        exportacion.cerrar(chatId);
        await sendTextMessage(
          chatId,
          exportacion.cancelado()
        );
        return;
      }

      // Nota de voz o adjunto durante el cuestionario: no se procesa nada.
      if (!respuesta) {
        await sendTextMessage(chatId, exportacion.recordatorioBloqueo(pendienteExport));
        return;
      }

      try {
        if (pendienteExport.paso === exportacion.PASO_NOMBRE) {
          let nombre = null;
          if (exportacion.esConfirmacion(respuesta) && pendienteExport.nombreDetectado) {
            nombre = pendienteExport.nombreDetectado;
          } else if (exportacion.nombreValido(respuesta)) {
            nombre = respuesta;
          }

          if (!nombre) {
            await sendTextMessage(
              chatId,
              exportacion.nombreRechazado(pendienteExport)
            );
            return;
          }

          const actualizado = exportacion.actualizar(chatId, {
            nombreCliente: nombre,
            paso: exportacion.PASO_TELEFONO,
          });
          await sendTextMessage(chatId, exportacion.preguntaTelefono(actualizado));
          return;
        }

        if (pendienteExport.paso === exportacion.PASO_TELEFONO) {
          const tel = exportacion.telefonoValido(respuesta);
          if (!tel) {
            await sendTextMessage(
              chatId,
              exportacion.telefonoRechazado(pendienteExport)
            );
            return;
          }
          await cerrarExportacion(chatId, { ...pendienteExport, telefono: tel });
          return;
        }
      } catch (err) {
        console.error("[exportacion] Error en el cuestionario:", err);
        await sendTextMessage(
          chatId,
          `❌ Algo falló: ${err.message}\n\nInténtalo otra vez o escribe CANCELAR.`
        );
        return;
      }
      return;
    }

    // --- FILTRO DE CHATS SILENCIADOS ---
    // Va ANTES de descargar adjuntos, transcribir audio, o procesar chat
    // exportado: nada de eso debe llamar a la API de WhatsApp si el chat
    // está silenciado y no trae la palabra de activación.
    // Number(chatId) por seguridad: si chatId llega como string desde
    // parseWhatsappCloudPayload, Set.has() con un number no lo detecta.
    const chatSilenciado = CHATS_SILENCIADOS.has(Number(chatId));
    let textoLimpio = text;

    if (chatSilenciado) {
      if (audioAdjunto) {
        // No transcribimos: no hay forma de saber si trae la palabra de
        // activación sin gastar la llamada de descarga/transcripción, así
        // que en chats silenciados las notas de voz se ignoran siempre.
        console.log(`Chat ${chatId} silenciado: se ignora nota de voz sin transcribir (
