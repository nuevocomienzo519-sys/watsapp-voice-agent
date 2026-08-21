require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");
const { downloadAttachment, sendVoiceMessage, sendTextMessage } = require("./lib/timelinesClient");
const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const { parseTimelinesPayload, isAudioAttachment } = require("./lib/timelinesPayload");
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
const extraerFotosRouter = require("./routes/extraerFotos");
const openaiProxyRouter = require("./routes/openaiProxy");

const app = express();
app.use(compression());
app.use(express.json({ limit: "20mb" }));
app.use(extraerFotosRouter);
app.use(openaiProxyRouter);

// Mismos identificadores ("slugs") que ya usa la propiedad "Asesor" en
// HubSpot (ver lib/hubspot.js) — así el link ?asesor=irle, por ejemplo, es
// consistente con el resto del sistema en vez de inventar otro criterio.
const ASESORES = {
  miguel_mondragon: { nombre: "Miguel Mondragon", iniciales: "MM" },
  irle: { nombre: "Irly Lopez", iniciales: "IL" },
  jessica: { nombre: "Jessica García", iniciales: "JG" },
  alejandro: { nombre: "Alejandro Santibañez", iniciales: "AS" },
  noemi: { nombre: "Noemí Lopez", iniciales: "NL" },
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

// Evita procesar el mismo mensaje dos veces si TimelinesAI reintenta el webhook.
const processedMessageIds = new Set();

// Chats donde el agente NO debe responder automáticamente, salvo que el
// mensaje incluya la palabra clave de activación. Por ahora solo el grupo
// "Los Miguelines" (chat_id 57693202 en TimelinesAI).
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

function appendHistory(chatId, userText, replyText) {
  const historial = getHistory(chatId);
  historial.push({ role: "user", content: userText });
  historial.push({ role: "assistant", content: replyText });
  while (historial.length > MAX_HISTORY_MESSAGES) historial.shift();
  conversationHistory.set(chatId, historial);
}

app.post("/webhooks/timelines", async (req, res) => {
  // 1. Verificación básica del secreto compartido
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send("No autorizado");
  }

  // Responde rápido a TimelinesAI para que no reintente por timeout;
  // el procesamiento real sigue después, de forma asíncrona.
  res.status(200).send("OK");

  try {
    // Log completo del payload. Déjalo activo las primeras semanas: si
    // algo del mapeo de abajo no aplica a tu cuenta, aquí está la fuente
    // de verdad para corregirlo en lib/timelinesPayload.js.
    console.log("Payload recibido de TimelinesAI:", JSON.stringify(req.body, null, 2));

    const { messageId, chatId, direction, phone, attachment, text } = parseTimelinesPayload(req.body);
    const senderName = req.body?.message?.sender?.full_name || null;

    if (!messageId || processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);

    if (direction !== "incoming" || !chatId) {
      return; // ignoramos mensajes salientes propios, eventos sin chat, etc.
    }

    const audioAdjunto = isAudioAttachment(attachment);

    // --- FILTRO DE CHATS SILENCIADOS ---
    // Va ANTES de descargar adjuntos, transcribir audio, o procesar chat
    // exportado: nada de eso debe llamar a la API de TimelinesAI si el
    // chat está silenciado y no trae la palabra de activación.
    // Number(chatId) por seguridad: si chatId llega como string desde
    // parseTimelinesPayload, Set.has() con un number no lo detecta.
    const chatSilenciado = CHATS_SILENCIADOS.has(Number(chatId));
    let textoLimpio = text;

    if (chatSilenciado) {
      if (audioAdjunto) {
        // No transcribimos: no hay forma de saber si trae la palabra de
        // activación sin gastar la llamada de descarga/transcripción, así
        // que en chats silenciados las notas de voz se ignoran siempre.
        console.log(`Chat ${chatId} silenciado: se ignora nota de voz sin transcribir (no consume API).`);
        return;
      }

      const tieneActivacion =
        !!text && text.toLowerCase().includes(PALABRA_ACTIVACION.toLowerCase());

      if (!tieneActivacion) {
        console.log(`Chat ${chatId} silenciado, mensaje ignorado (sin palabra de activación).`);
        return;
      }

      textoLimpio = text.replace(new RegExp(PALABRA_ACTIVACION, "ig"), "").trim();

      // Si mandaron solo la palabra de activación, sin pregunta, le damos
      // un texto por defecto para que Claude no reciba un mensaje vacío.
      if (!textoLimpio) {
        textoLimpio = "Hola, ¿en qué puedo ayudarte?";
      }
    }
    // --- FIN FILTRO DE CHATS SILENCIADOS ---

    // Detección de "contacto exportado": basta con mandar el archivo
    // .zip/.txt del export de WhatsApp — ya no requiere ninguna palabra
    // clave en el mensaje. Se crea el contacto+negocio en HubSpot (etapa
    // "Base de datos") y se corta aquí, sin pasar por Whisper/Claude. El
    // texto del mensaje (si lo hay) se sigue usando como respaldo para el
    // teléfono manual (ver extraerTelefono en lib/parseChatExport.js).
    const esChatExportado =
      attachment?.filename &&
      /\.(zip|txt)$/i.test(attachment.filename);

    if (esChatExportado) {
      try {
        const archivo = await downloadAttachment(attachment.url);
        const { contacto, negocio, datos } = await procesarChatExportado(
          archivo,
          attachment.filename,
          textoLimpio,
          chatId
        );
        console.log(
          `[chat-exportado] Creado -> contacto ${contacto.id}, negocio ${negocio.id}, proyecto=${datos.proyecto}, asesor=${datos.asesorLabel}, telefono=${datos.telefono}`
        );
        const confirmacion =
          `📦 Archivo: ${datos.filenameOriginal}\n\n` +
          `✅ Cliente: ${datos.nombreCliente}\n` +
          (datos.proyecto
            ? `📁 Proyecto: ${datos.proyecto}\n`
            : `⚠️ Proyecto: no detectado, revisar manualmente\n`) +
          (datos.asesorLabel ? `🧑‍💼 Asesor: ${datos.asesorLabel}\n` : '') +
          `📍 Etapa: Base de datos (no se mueve sola, solo tú la cambias manualmente)\n\n` +
          `📎 ${datos.resumenAdjuntos}\n\n` +
          `💬 Resumen: ${datos.resumenConversacion || 'no se pudo generar.'}\n\n` +
          (datos.telefono
            ? `📱 Teléfono detectado: ${datos.telefono}\n¿Es correcto? Responde "sí" o mándame el número correcto y te confirmo con la tarjeta de contacto.`
            : '⚠️ No se detectó teléfono válido, agrégalo manualmente en HubSpot.');
        await sendTextMessage(chatId, confirmacion);

        if (datos.telefono) {
          guardarPendiente(chatId, {
            contactoId: contacto.id,
            telefono: datos.telefono,
            nombreCliente: datos.nombreCliente,
          });
        }
      } catch (err) {
        console.error("[chat-exportado] Error:", err);
        await sendTextMessage(chatId, `❌ No pude procesar el chat exportado: ${err.message}`);
      }
      return;
    }

    // --- Confirmación/corrección de teléfono pendiente de un chat exportado ---
    const pendiente = leerPendiente(chatId);
    if (pendiente && textoLimpio) {
      try {
        const posibleCorreccion = extraerTelefono(textoLimpio);
        const telefonoFinal = posibleCorreccion || pendiente.telefono;

        if (posibleCorreccion && posibleCorreccion !== pendiente.telefono) {
          await actualizarTelefonoContacto(pendiente.contactoId, posibleCorreccion);
        }
        await enviarTarjetaContacto(chatId, pendiente.nombreCliente, telefonoFinal);
        await sendTextMessage(
          chatId,
          `📇 Tarjeta enviada con ${telefonoFinal}${
            posibleCorreccion && posibleCorreccion !== pendiente.telefono
              ? ' (corregido en HubSpot).'
              : '.'
          }`
        );
      } catch (err) {
        console.error('[chat-exportado] Error en confirmación de teléfono:', err);
        await sendTextMessage(chatId, `❌ No pude confirmar/enviar la tarjeta: ${err.message}`);
      } finally {
        borrarPendiente(chatId);
      }
      return;
    }

    // El mensaje debe ser nota de voz O texto; si no es ninguno de los
    // dos (ej. imagen, ubicación, sticker), lo ignoramos por ahora.
    if (!audioAdjunto && !textoLimpio) {
      return;
    }

    const inputMode = audioAdjunto ? "audio" : "text";
    let userText;

    if (inputMode === "audio") {
      // 2a. Descargar y transcribir la nota de voz del cliente
      // (nunca llega aquí si el chat está silenciado: se filtró arriba)
      const audioIn = await downloadAttachment(attachment.url);
      userText = await transcribeAudio(audioIn, attachment.filename || "nota.ogg");
      console.log("Transcripción:", userText);
    } else {
      // 2b. Mensaje de texto: se usa directo, sin Whisper.
      userText = textoLimpio;
      console.log("Texto recibido:", userText);
    }

    // 3. Generar la respuesta con Claude (decide también el formato de
    // salida, y de paso crea en HubSpot la tarea de seguimiento si detecta
    // una cita agendada o una solicitud de información específica, y
    // actualiza el nombre del contacto si hace falta).
    // Le mandamos el historial de esta conversación para que recuerde
    // el contexto entre mensajes.
    const { formato, texto: replyText, resumen } = await generateReply(
      userText,
      inputMode,
      { chatId, phone, senderName },
      getHistory(chatId)
    );
    console.log(`Respuesta generada [formato: ${formato}]:`, replyText);

    appendHistory(chatId, userText, replyText);

    // 4. Enviar la respuesta en el formato decidido.
    // "voz_y_texto": se manda la respuesta completa en audio Y un texto
    // breve con el resumen (precios/listas), en el mismo turno.
    if (formato === "voz" || formato === "voz_y_texto") {
      const audioMp3 = await synthesizeSpeech(replyText);
      // Convertir a ogg/opus para que WhatsApp lo muestre como nota de
      // voz (con forma de onda) en vez de un archivo adjunto genérico.
      const audioOgg = await convertToOggOpus(audioMp3);
      await sendVoiceMessage(chatId, audioOgg, "respuesta.ogg");
      console.log(`Respuesta de voz enviada al chat ${chatId}`);

      if (formato === "voz_y_texto" && resumen) {
        await sendTextMessage(chatId, resumen);
        console.log(`Resumen de texto enviado al chat ${chatId}`);
      }
    } else {
      await sendTextMessage(chatId, replyText);
      console.log(`Respuesta de texto enviada al chat ${chatId}`);
    }
  } catch (err) {
    console.error("Error procesando el mensaje:", err);
  }
});

// Endpoint temporal para extraer y descargar en .zip las fotos de un día
// específico en un chat/grupo de TimelinesAI. Ver routes/extraerFotos.js
// para el detalle — se usa entrando directo desde el navegador a
// /extraer-fotos?secret=TU_WEBHOOK_SECRET

// Página temporal para conectar el número de WhatsApp a la Cloud API vía
// Embedded Signup, con la opción de coexistencia (mantener la app normal
// de WhatsApp Business funcionando a la par). Solo se usa una vez durante
// la migración; se puede quitar después si se quiere.
app.get("/conectar-whatsapp", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Conectar WhatsApp - Nuevo Comienzo</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center; }
    button { background: #25D366; color: white; border: none; padding: 14px 28px; font-size: 16px; border-radius: 6px; cursor: pointer; }
    button:hover { background: #1ebe5b; }
    #resultado { margin-top: 20px; text-align: left; white-space: pre-wrap; background: #f4f4f4; padding: 12px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Conectar número de WhatsApp</h2>
  <p>Da clic al botón y sigue el flujo. Cuando te pregunte, elige la opción de conectar tu cuenta existente de WhatsApp Business app.</p>
  <button onclick="launchWhatsAppSignup()">Conectar WhatsApp</button>
  <div id="resultado"></div>

  <script>
    window.fbAsyncInit = function () {
      FB.init({
        appId: '1068574982377434',
        cookie: true,
        xfbml: true,
        version: 'v22.0',
      });
    };
    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s);
      js.id = id;
      js.src = 'https://connect.facebook.net/es_LA/sdk.js';
      fjs.parentNode.insertBefore(js, fjs);
    })(document, 'script', 'facebook-jssdk');

    // Captura los datos que WhatsApp manda por postMessage al completar el flujo
    window.addEventListener('message', (event) => {
      if (!event.origin.includes('facebook.com')) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          document.getElementById('resultado').textContent =
            'Datos recibidos de WhatsApp:\\n' + JSON.stringify(data, null, 2);
        }
      } catch (e) {
        // ignorar mensajes que no son JSON
      }
    });

    function launchWhatsAppSignup() {
      FB.login(
        function (response) {
          if (response.status === 'connected' && response.authResponse) {
            const code = response.authResponse.code;
            document.getElementById('resultado').textContent =
              'Código de autorización recibido:\\n' + code +
              '\\n\\nManda captura de esto.';
          } else {
            document.getElementById('resultado').textContent = 'Cancelaste el inicio de sesión o no autorizaste todo.';
          }
        },
        {
          config_id: '3312158045654863',
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            sessionInfoVersion: 3,
            featureType: 'whatsapp_business_app_onboarding',
          },
        }
      );
    }
  </script>
</body>
</html>`);
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
  console.log(
    `URL de webhook a registrar en TimelinesAI: https://TU-DOMINIO/webhooks/timelines?secret=${process.env.WEBHOOK_SECRET}`
  );
});
