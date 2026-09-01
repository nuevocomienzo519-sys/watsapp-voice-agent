const FACEBOOK_APP_ID =
  process.env.FACEBOOK_APP_ID || "1068574982377434";

const FACEBOOK_CONFIG_ID =
  process.env.FACEBOOK_CONFIG_ID || "1048508727955206";

const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_REDIRECT_URI ||
  "https://watsapp-voice-agent.onrender.com/conectar-whatsapp";
```js
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");
const crypto = require("crypto");

const {
  downloadAttachment,
  sendVoiceMessage,
  sendTextMessage,
  enviarMensajePlantilla,
} = require("./lib/whatsappCloudClient");

const { transcribeAudio } = require("./lib/stt");
const { generateReply } = require("./lib/llm");
const { synthesizeSpeech } = require("./lib/tts");
const { convertToOggOpus } = require("./lib/audioConvert");
const {
  parseWhatsappCloudPayload,
  isAudioAttachment,
} = require("./lib/whatsappCloudPayload");

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
const { actualizarNombreContacto } = require("./lib/hubspot");


// ============================================================
// CONFIGURACIÓN META / FACEBOOK
// ============================================================

const FACEBOOK_APP_ID =
  process.env.FACEBOOK_APP_ID || "1068574982377434";

// NUEVA CONFIGURACIÓN DE FACEBOOK LOGIN FOR BUSINESS
const FACEBOOK_CONFIG_ID =
  process.env.FACEBOOK_CONFIG_ID || "1048508727955206";

// IMPORTANTE:
// Este URI debe ser EXACTAMENTE el mismo en:
// 1. FB.login()
// 2. Intercambio del code por token
// 3. Meta Developers > OAuth Redirect URIs
const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_REDIRECT_URI ||
  "https://watsapp-voice-agent.onrender.com/conectar-whatsapp";


// ============================================================
// PLANTILLAS
// ============================================================

const PLANTILLA_SEGUIMIENTO =
  process.env.PLANTILLA_SEGUIMIENTO || "seguimiento_contacto";

const PLANTILLA_IDIOMA =
  process.env.PLANTILLA_IDIOMA || "es_MX";

const PLANTILLA_SIN_PARAMETROS =
  process.env.PLANTILLA_SIN_PARAMETROS === "1";


// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(compression());

app.use(
  express.json({
    limit: "20mb",

    // Guardamos el body original para validar
    // x-hub-signature-256 enviado por Meta.
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);


// ============================================================
// VALIDACIÓN FIRMA WHATSAPP
// ============================================================

function firmaWhatsappValida(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    console.warn(
      "[webhook] WHATSAPP_APP_SECRET no configurado. Se omite validación."
    );
    return true;
  }

  const firmaRecibida = req.get("x-hub-signature-256");

  if (!firmaRecibida || !req.rawBody) {
    return false;
  }

  const firmaEsperada =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.rawBody)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(firmaRecibida),
      Buffer.from(firmaEsperada)
    );
  } catch {
    return false;
  }
}


// ============================================================
// CERRAR EXPORTACIÓN
// ============================================================

async function cerrarExportacion(chatId, pendiente) {
  const {
    contactoId,
    nombreCliente,
    telefono,
    resumenConversacion,
  } = pendiente;

  if (contactoId && nombreCliente) {
    try {
      await actualizarNombreContacto(contactoId, nombreCliente);
    } catch (err) {
      console.error(
        "[exportacion] No se pudo actualizar el nombre:",
        err.message
      );
    }
  }

  if (contactoId && telefono) {
    await actualizarTelefonoContacto(contactoId, telefono);
  }

  let avisoEnvio;

  try {
    const primerNombre = String(nombreCliente)
      .trim()
      .split(/\s+/)[0];

    const linea =
      resumenConversacion ||
      "Quedamos pendientes de tu interés en una de nuestras casas.";

    await enviarMensajePlantilla(
      telefono.replace(/^\+/, ""),
      PLANTILLA_SEGUIMIENTO,
      PLANTILLA_IDIOMA,
      PLANTILLA_SIN_PARAMETROS
        ? []
        : [primerNombre, linea.slice(0, 250)]
    );

    avisoEnvio =
      `📤 Mensaje de seguimiento enviado a ${telefono}.`;
  } catch (err) {
    console.error(
      "[exportacion] Falló el envío de la plantilla:",
      err.message
    );

    avisoEnvio =
      `⚠️ Guardé todo en HubSpot, pero no salió el mensaje automático ` +
      `(${err.message}). Escríbele tú a ${telefono}.`;
  }

  exportacion.cerrar(chatId);

  await sendTextMessage(
    chatId,
    exportacion.terminado(
      nombreCliente,
      telefono,
      avisoEnvio
    )
  );
}


// ============================================================
// ROUTERS
// ============================================================

const extraerFotosRouter = require("./routes/extraerFotos");
const openaiProxyRouter = require("./routes/openaiProxy");
const registrarNumeroRouter = require("./routes/registrarNumero");
const panelConversacionesRouter = require("./routes/panelConversaciones");
const ajustesNumeroRouter = require("./routes/ajustesNumero");
const conversaciones = require("./lib/conversaciones");

app.use(extraerFotosRouter);
app.use(openaiProxyRouter);
app.use(registrarNumeroRouter);
app.use(panelConversacionesRouter);
app.use(ajustesNumeroRouter);

// Asistente privado
app.use(require("./routes/asistente"));


// ============================================================
// ASESORES
// ============================================================

const ASESORES = {
  miguel_mondragon: {
    nombre: "Miguel Mondragon",
    iniciales: "MM",
  },

  irle: {
    nombre: "Irly Lopez",
    iniciales: "IL",
  },

  jessica: {
    nombre: "Jessica García",
    iniciales: "JG",
  },

  alejandro: {
    nombre: "Alejandro Santibañez",
    iniciales: "AS",
  },

  noemi: {
    nombre: "Noemí Lopez",
    iniciales: "NL",
  },

  raquel: {
    nombre: "Raquel Rey",
    iniciales: "RR",
  },
};

const ASESOR_DEFAULT = "miguel_mondragon";

function resolverAsesor(query) {
  const slug = ASESORES[query?.asesor]
    ? query.asesor
    : ASESOR_DEFAULT;

  return {
    slug,
    ...ASESORES[slug],
  };
}


// ============================================================
// GALERÍA - MODELO
// ============================================================

app.get(
  "/galeria/modelo/:proyectoId/:modeloId",
  (req, res) => {
    try {
      const manifestPath = path.join(
        __dirname,
        "public-galeria",
        "manifest.json"
      );

      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      );

      const proyecto = manifest.proyectos.find(
        (p) => p.id === req.params.proyectoId
      );

      const modelo =
        proyecto &&
        proyecto.modelos.find(
          (m) => m.id === req.params.modeloId
        );

      if (!proyecto || !modelo) {
        return res.redirect("/galeria/");
      }

      const asesor = resolverAsesor(req.query);

      const baseUrl =
        `${req.protocol}://${req.get("host")}`;

      const imagenAbsoluta =
        `${baseUrl}/galeria/${modelo.portada}`;

      const precio =
        modelo.precioFormato ||
        "Consultar precio";

      const titulo =
        `${modelo.nombre} — ${precio} | ${asesor.nombre}`;

      const descripcion =
        `${proyecto.nombre}, Franco, Silao · Gto. ` +
        `${modelo.totalFotos} fotos disponibles.`;

      const urlPagina =
        `${baseUrl}/galeria/modelo/` +
        `${proyecto.id}/${modelo.id}` +
        `?asesor=${asesor.slug}`;

      const destinoGaleria =
        `/galeria/?asesor=${asesor.slug}` +
        `#${proyecto.id}/${modelo.id}`;

      const escapar = (s) =>
        String(s).replace(/"/g, "&quot;");

      res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />

<title>${escapar(titulo)}</title>

<meta name="description"
      content="${escapar(descripcion)}" />

<meta property="og:type"
      content="website" />

<meta property="og:site_name"
      content="${escapar(asesor.nombre)}" />

<meta property="og:title"
      content="${escapar(titulo)}" />

<meta property="og:description"
      content="${escapar(descripcion)}" />

<meta property="og:image"
      content="${escapar(imagenAbsoluta)}" />

<meta property="og:image:secure_url"
      content="${escapar(imagenAbsoluta)}" />

<meta property="og:url"
      content="${escapar(urlPagina)}" />

<meta name="twitter:card"
      content="summary_large_image" />

<meta name="twitter:title"
      content="${escapar(titulo)}" />

<meta name="twitter:image"
      content="${escapar(imagenAbsoluta)}" />

</head>

<body>

<p>
Abriendo
<a href="${escapar(destinoGaleria)}">
${escapar(titulo)}
</a>…
</p>

<script>
location.replace(${JSON.stringify(destinoGaleria)});
</script>

</body>
</html>`);
    } catch (err) {
      console.error(
        "Error en /galeria/modelo:",
        err
      );

      res.redirect("/galeria/");
    }
  }
);


// ============================================================
// GALERÍA - FOTO
// ============================================================

app.get(
  "/galeria/foto/:proyectoId/:modeloId/:tab/:index",
  (req, res) => {
    try {
      const manifestPath = path.join(
        __dirname,
        "public-galeria",
        "manifest.json"
      );

      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      );

      const proyecto = manifest.proyectos.find(
        (p) => p.id === req.params.proyectoId
      );

      const modelo =
        proyecto &&
        proyecto.modelos.find(
          (m) => m.id === req.params.modeloId
        );

      const tab =
        req.params.tab === "fotosAdicionales"
          ? "fotosAdicionales"
          : "fotos";

      const indice =
        parseInt(req.params.index, 10);

      const foto =
        modelo &&
        Array.isArray(modelo[tab])
          ? modelo[tab][indice]
          : null;

      if (!proyecto || !modelo || !foto) {
        return res.redirect("/galeria/");
      }

      const asesor = resolverAsesor(req.query);

      const baseUrl =
        `${req.protocol}://${req.get("host")}`;

      const imagenAbsoluta =
        `${baseUrl}/galeria/${foto}`;

      const precio =
        modelo.precioFormato ||
        "Consultar precio";

      const titulo =
        `${modelo.nombre} — ${precio} | ${asesor.nombre}`;

      const descripcion =
        `${proyecto.nombre}, Franco, Silao · Gto.`;

      const urlPagina =
        `${baseUrl}/galeria/foto/` +
        `${proyecto.id}/${modelo.id}/${tab}/${indice}` +
        `?asesor=${asesor.slug}`;

      const destinoGaleria =
        `/galeria/?asesor=${asesor.slug}` +
        `#${proyecto.id}/${modelo.id}/f/${tab}/${indice}`;

      const escapar = (s) =>
        String(s).replace(/"/g, "&quot;");

      res.send(`<!DOCTYPE html>
<html lang="es">
<head>

<meta charset="UTF-8" />

<meta name="viewport"
      content="width=device-width, initial-scale=1" />

<title>${escapar(titulo)}</title>

<meta name="description"
      content="${escapar(descripcion)}" />

<meta property="og:type"
      content="website" />

<meta property="og:site_name"
      content="${escapar(asesor.nombre)}" />

<meta property="og:title"
      content="${escapar(titulo)}" />

<meta property="og:description"
      content="${escapar(descripcion)}" />

<meta property="og:image"
      content="${escapar(imagenAbsoluta)}" />

<meta property="og:image:secure_url"
      content="${escapar(imagenAbsoluta)}" />

<meta property="og:url"
      content="${escapar(urlPagina)}" />

<meta name="twitter:card"
      content="summary_large_image" />

<meta name="twitter:title"
      content="${escapar(titulo)}" />

<meta name="twitter:image"
      content="${escapar(imagenAbsoluta)}" />

</head>

<body>

<p>
Abriendo
<a href="${escapar(destinoGaleria)}">
${escapar(titulo)}
</a>…
</p>

<script>
location.replace(${JSON.stringify(destinoGaleria)});
</script>

</body>
</html>`);
    } catch (err) {
      console.error(
        "Error en /galeria/foto:",
        err
      );

      res.redirect("/galeria/");
    }
  }
);


// ============================================================
// ASESORES JSON
// ============================================================

app.get("/galeria/asesores.json", (req, res) => {
  res.json({
    asesores: ASESORES,
    default: ASESOR_DEFAULT,
  });
});


// ============================================================
// ARCHIVOS DE GALERÍA
// ============================================================

app.use(
  "/galeria",
  express.static(
    path.join(__dirname, "public-galeria"),
    {
      maxAge: 0,

      setHeaders: (res, filePath) => {
        if (
          filePath.includes(
            `${path.sep}fotos${path.sep}`
          )
        ) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=604800"
          );
        }
      },
    }
  )
);


// ============================================================
// CONTROL DE MENSAJES DUPLICADOS
// ============================================================

const processedMessageIds = new Set();


// ============================================================
// CHATS SILENCIADOS
// ============================================================

const CHATS_SILENCIADOS =
  new Set([57693202]);

const PALABRA_ACTIVACION =
  "@asistentewaba";


// ============================================================
// HISTORIAL
// ============================================================

const conversationHistory =
  new Map();

const MAX_HISTORY_MESSAGES = 20;

function getHistory(chatId) {
  return (
    conversationHistory.get(chatId) ||
    []
  );
}

async function getHistoryPersistente(chatId) {
  if (conversaciones.habilitado()) {
    const desdeBD =
      await conversaciones.obtenerHistorial(chatId);

    if (desdeBD.length) {
      return desdeBD;
    }
  }

  return getHistory(chatId);
}

function appendHistory(
  chatId,
  userText,
  replyText
) {
  const historial =
    getHistory(chatId);

  historial.push({
    role: "user",
    content: userText,
  });

  historial.push({
    role: "assistant",
    content: replyText,
  });

  while (
    historial.length >
    MAX_HISTORY_MESSAGES
  ) {
    historial.shift();
  }

  conversationHistory.set(
    chatId,
    historial
  );
}


// ============================================================
// WEBHOOK VERIFICACIÓN META
// ============================================================

app.get(
  "/webhooks/whatsapp-cloud",
  (req, res) => {
    const modo =
      req.query["hub.mode"];

    const token =
      req.query["hub.verify_token"];

    const challenge =
      req.query["hub.challenge"];

    if (
      modo === "subscribe" &&
      token ===
        process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return res
        .status(200)
        .send(challenge);
    }

    return res.sendStatus(403);
  }
);


// ============================================================
// WEBHOOK WHATSAPP
// ============================================================

app.post(
  "/webhooks/whatsapp-cloud",
  async (req, res) => {

    if (!firmaWhatsappValida(req)) {
      return res
        .status(401)
        .send("Firma inválida");
    }

    res
      .status(200)
      .send("OK");

    try {

      console.log(
        "Payload recibido de WhatsApp Cloud API:",
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      const {
        messageId,
        chatId,
        direction,
        phone,
        senderName,
        attachment,
        text,
      } =
        parseWhatsappCloudPayload(
          req.body
        );

      if (
        !messageId ||
        processedMessageIds.has(messageId)
      ) {
        return;
      }

      processedMessageIds.add(
        messageId
      );

      if (
        direction !== "incoming" ||
        !chatId
      ) {
        return;
      }

      const audioAdjunto =
        isAudioAttachment(
          attachment
        );


      // ======================================================
      // EXPORTACIÓN PENDIENTE
      // ======================================================

      const pendienteExport =
        exportacion.leer(chatId);

      if (pendienteExport) {

        const respuesta =
          (text || "").trim();

        if (
          exportacion.esCancelacion(
            respuesta
          )
        ) {

          exportacion.cerrar(
            chatId
          );

          await sendTextMessage(
            chatId,
            exportacion.cancelado()
          );

          return;
        }

        if (!respuesta) {

          await sendTextMessage(
            chatId,
            exportacion.recordatorioBloqueo(
              pendienteExport
            )
          );

          return;
        }

        try {

          if (
            pendienteExport.paso ===
            exportacion.PASO_NOMBRE
          ) {

            let nombre = null;

            if (
              exportacion.esConfirmacion(
                respuesta
              ) &&
              pendienteExport.nombreDetectado
            ) {
              nombre =
                pendienteExport.nombreDetectado;

            } else if (
              exportacion.nombreValido(
                respuesta
              )
            ) {
              nombre =
                respuesta;
            }

            if (!nombre) {

              await sendTextMessage(
                chatId,
                exportacion.nombreRechazado(
                  pendienteExport
                )
              );

              return;
            }

            const actualizado =
              exportacion.actualizar(
                chatId,
                {
                  nombreCliente:
                    nombre,

                  paso:
                    exportacion.PASO_TELEFONO,
                }
              );

            await sendTextMessage(
              chatId,
              exportacion.preguntaTelefono(
                actualizado
              )
            );

            return;
          }

          if (
            pendienteExport.paso ===
            exportacion.PASO_TELEFONO
          ) {

            const tel =
              exportacion.telefonoValido(
                respuesta
              );

            if (!tel) {

              await sendTextMessage(
                chatId,
                exportacion.telefonoRechazado(
                  pendienteExport
                )
              );

              return;
            }

            await cerrarExportacion(
              chatId,
              {
                ...pendienteExport,
                telefono: tel,
              }
            );

            return;
          }

        } catch (err) {

          console.error(
            "[exportacion] Error:",
            err
          );

          await sendTextMessage(
            chatId,
            `❌ Algo falló: ${err.message}\n\n` +
            `Inténtalo otra vez o escribe CANCELAR.`
          );

          return;
        }

        return;
      }


      // ======================================================
      // CHATS SILENCIADOS
      // ======================================================

      const chatSilenciado =
        CHATS_SILENCIADOS.has(
          Number(chatId)
        );

      let textoLimpio = text;

      if (chatSilenciado) {

        if (audioAdjunto) {

          console.log(
            `Chat ${chatId} silenciado: ` +
            `se ignora nota de voz.`
          );

          return;
        }

        const tieneActivacion =
          !!text &&
          text
            .toLowerCase()
            .includes(
              PALABRA_ACTIVACION
                .toLowerCase()
            );

        if (!tieneActivacion) {

          console.log(
            `Chat ${chatId} silenciado, ` +
            `mensaje ignorado.`
          );

          return;
        }

        textoLimpio =
          text
            .replace(
              new RegExp(
                PALABRA_ACTIVACION,
                "ig"
              ),
              ""
            )
            .trim();

        if (!textoLimpio) {
          textoLimpio =
            "Hola, ¿en qué puedo ayudarte?";
        }
      }


      // ======================================================
      // CHAT EXPORTADO
      // ======================================================

      const esChatExportado =
        attachment?.filename &&
        /\.(zip|txt)$/i.test(
          attachment.filename
        );

      if (esChatExportado) {

        try {

          const archivo =
            await downloadAttachment(
              attachment.url
            );

          const {
            contacto,
            negocio,
            datos,
          } =
            await procesarChatExportado(
              archivo,
              attachment.filename,
              textoLimpio,
              chatId
            );

          console.log(
            `[chat-exportado] Creado -> ` +
            `contacto ${contacto.id}, ` +
            `negocio ${negocio.id}`
          );

          const ficha =
            `📦 Archivo: ${datos.filenameOriginal}\n\n` +
            `✅ Cliente: ${datos.nombreCliente || "sin detectar"}\n` +
            (
              datos.proyecto
                ? `📁 Proyecto: ${datos.proyecto}\n`
                : `⚠️ Proyecto: no detectado\n`
            ) +
            (
              datos.asesorLabel
                ? `🧑‍💼 Asesor: ${datos.asesorLabel}\n`
                : ""
            ) +
            `📍 Etapa: Base de datos\n\n` +
            `📎 ${datos.resumenAdjuntos}\n\n` +
            `💬 Resumen: ${datos.resumenConversacion || "no se pudo generar."}`;

          const nombreOk =
            exportacion.nombreValido(
              datos.nombreCliente
            );

          const telefonoOk =
            exportacion.telefonoValido(
              datos.telefono
            );

          if (
            nombreOk &&
            telefonoOk
          ) {

            if (
              !exportacion.yaSaludo(
                chatId
              )
            ) {

              await sendTextMessage(
                chatId,
                exportacion.saludoDePresentacion()
              );

              exportacion.marcarSaludado(
                chatId
              );
            }

            await sendTextMessage(
              chatId,
              ficha
            );

            await cerrarExportacion(
              chatId,
              {
                contactoId:
                  contacto.id,

                nombreCliente:
                  datos.nombreCliente,

                telefono:
                  telefonoOk,

                resumenConversacion:
                  datos.resumenConversacion,
              }
            );

            return;
          }

          const abierta =
            exportacion.abrir(
              chatId,
              {
                contactoId:
                  contacto.id,

                negocioId:
                  negocio.id,

                filenameOriginal:
                  datos.filenameOriginal,

                nombreDetectado:
                  nombreOk
                    ? datos.nombreCliente
                    : null,

                nombreCliente:
                  nombreOk
                    ? datos.nombreCliente
                    : null,

                telefono:
                  telefonoOk ||
                  null,

                resumenConversacion:
                  datos.resumenConversacion,

                paso:
                  nombreOk
                    ? exportacion.PASO_TELEFONO
                    : exportacion.PASO_NOMBRE,
              }
            );

          if (
            !exportacion.yaSaludo(
              chatId
            )
          ) {

            await sendTextMessage(
              chatId,
              exportacion.saludoDePresentacion()
            );

            exportacion.marcarSaludado(
              chatId
            );
          }

          await sendTextMessage(
            chatId,
            ficha
          );

          await sendTextMessage(
            chatId,
            abierta.paso ===
              exportacion.PASO_NOMBRE
              ? exportacion.preguntaNombre(
                  abierta
                )
              : exportacion.preguntaTelefono(
                  abierta
                )
          );

        } catch (err) {

          console.error(
            "[chat-exportado] Error:",
            err
          );

          await sendTextMessage(
            chatId,
            `❌ No pude procesar el chat exportado: ${err.message}`
          );
        }

        return;
      }


      // ======================================================
      // CONFIRMACIÓN DE TELÉFONO
      // ======================================================

      const pendiente =
        leerPendiente(chatId);

      if (
        pendiente &&
        textoLimpio
      ) {

        try {

          const posibleCorreccion =
            extraerTelefono(
              textoLimpio
            );

          const telefonoFinal =
            posibleCorreccion ||
            pendiente.telefono;

          if (
            posibleCorreccion &&
            posibleCorreccion !==
              pendiente.telefono
          ) {

            await actualizarTelefonoContacto(
              pendiente.contactoId,
              posibleCorreccion
            );
          }

          await enviarTarjetaContacto(
            chatId,
            pendiente.nombreCliente,
            telefonoFinal
          );

          await sendTextMessage(
            chatId,
            `📇 Tarjeta enviada con ${telefonoFinal}.`
          );

        } catch (err) {

          console.error(
            "[chat-exportado] Error:",
            err
          );

          await sendTextMessage(
            chatId,
            `❌ No pude confirmar/enviar la tarjeta: ${err.message}`
          );

        } finally {

          borrarPendiente(
            chatId
          );
        }

        return;
      }


      // ======================================================
      // TEXTO / AUDIO
      // ======================================================

      if (
        !audioAdjunto &&
        !textoLimpio
      ) {
        return;
      }

      const inputMode =
        audioAdjunto
          ? "audio"
          : "text";

      let userText;

      if (
        inputMode === "audio"
      ) {

        const audioIn =
          await downloadAttachment(
            attachment.url
          );

        userText =
          await transcribeAudio(
            audioIn,
            attachment.filename ||
              "nota.ogg"
          );

        console.log(
          "Transcripción:",
          userText
        );

      } else {

        userText =
          textoLimpio;

        console.log(
          "Texto recibido:",
          userText
        );
      }


      // ======================================================
      // IA
      // ======================================================

      const {
        formato,
        texto: replyText,
        resumen,
      } =
        await generateReply(
          userText,
          inputMode,
          {
            chatId,
            phone,
            senderName,
          },
          await getHistoryPersistente(
            chatId
          )
        );

      console.log(
        `Respuesta generada [formato: ${formato}]:`,
        replyText
      );

      appendHistory(
        chatId,
        userText,
        replyText
      );

      await conversaciones.guardarTurno({
        chatId,
        telefono: phone,
        nombre: senderName,
        textoCliente: userText,
        textoAgente: replyText,
      });


      // ======================================================
      // RESPUESTA
      // ======================================================

      if (
        formato === "voz" ||
        formato === "voz_y_texto"
      ) {

        const audioMp3 =
          await synthesizeSpeech(
            replyText
          );

        const audioOgg =
          await convertToOggOpus(
            audioMp3
          );

        await sendVoiceMessage(
          chatId,
          audioOgg,
          "respuesta.ogg"
        );

        console.log(
          `Respuesta de voz enviada al chat ${chatId}`
        );

        if (
          formato === "voz_y_texto" &&
          resumen
        ) {

          await sendTextMessage(
            chatId,
            resumen
          );

          console.log(
            "Resumen de texto enviado."
          );
        }

      } else {

        await sendTextMessage(
          chatId,
          replyText
        );

        console.log(
          `Respuesta de texto enviada al chat ${chatId}`
        );
      }

    } catch (err) {

      console.error(
        "Error procesando el mensaje:",
        err
      );
    }
  }
);


// ============================================================
```js
// ============================================================
// WHATSAPP EMBEDDED SIGNUP
// FACEBOOK LOGIN FOR BUSINESS
// ============================================================

const FACEBOOK_APP_ID =
  process.env.FACEBOOK_APP_ID || "1068574982377434";

const FACEBOOK_CONFIG_ID =
  process.env.FACEBOOK_CONFIG_ID || "1048508727955206";

const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_REDIRECT_URI ||
  "https://watsapp-voice-agent.onrender.com/conectar-whatsapp";


// ============================================================
// INTERCAMBIO CODE -> ACCESS TOKEN
// ============================================================

app.post(
  "/conectar-whatsapp",
  async (req, res) => {

    try {

      const code =
        String(req.body?.code || "").trim();

      if (!code) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Falta el código de autorización.",
          });
      }


      console.log(
        "=========================================="
      );

      console.log(
        "[WHATSAPP SIGNUP] Iniciando intercambio"
      );

      console.log(
        "[WHATSAPP SIGNUP] App ID:",
        FACEBOOK_APP_ID
      );

      console.log(
        "[WHATSAPP SIGNUP] Config ID:",
        FACEBOOK_CONFIG_ID
      );

      console.log(
        "[WHATSAPP SIGNUP] Redirect URI:",
        FACEBOOK_REDIRECT_URI
      );


      // ======================================================
      // 1. INTERCAMBIAR CODE POR TOKEN
      // ======================================================

      const parametros = new URLSearchParams();

      parametros.append(
        "client_id",
        FACEBOOK_APP_ID
      );

      parametros.append(
        "client_secret",
        process.env.META_APP_SECRET
      );

      parametros.append(
        "redirect_uri",
        FACEBOOK_REDIRECT_URI
      );

      parametros.append(
        "code",
        code
      );


      const tokenResponse =
        await fetch(
          "https://graph.facebook.com/v22.0/oauth/access_token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",
            },

            body:
              parametros.toString(),
          }
        );


      const tokenData =
        await tokenResponse.json();


      console.log(
        "[WHATSAPP SIGNUP] Respuesta token:",
        JSON.stringify(
          tokenData,
          null,
          2
        )
      );


      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {

        return res
          .status(400)
          .json({
            ok: false,

            error:
              "No se pudo obtener el token.",

            detalle:
              tokenData,

            diagnostico: {
              app_id:
                FACEBOOK_APP_ID,

              config_id:
                FACEBOOK_CONFIG_ID,

              redirect_uri:
                FACEBOOK_REDIRECT_URI,

              mensaje:
                "El redirect_uri utilizado para intercambiar el código debe ser exactamente el mismo utilizado durante la autorización de Facebook.",
            },
          });
      }


      const accessToken =
        tokenData.access_token;


      console.log(
        "[WHATSAPP SIGNUP] Token obtenido correctamente."
      );


      // ======================================================
      // 2. CONSULTAR INFORMACIÓN DEL TOKEN
      // ======================================================

      let debugToken = null;

      try {

        const debugResponse =
          await fetch(
            "https://graph.facebook.com/debug_token?" +
            new URLSearchParams({
              input_token:
                accessToken,

              access_token:
                accessToken,
            })
          );

        debugToken =
          await debugResponse.json();

      } catch (err) {

        console.warn(
          "[WHATSAPP SIGNUP] No se pudo depurar el token:",
          err.message
        );
      }


      // ======================================================
      // 3. OBTENER NEGOCIOS DEL USUARIO
      // ======================================================

      let negocios = null;

      try {

        const negociosResponse =
          await fetch(
            "https://graph.facebook.com/v22.0/me/businesses?" +
            new URLSearchParams({
              access_token:
                accessToken,
            })
          );

        negocios =
          await negociosResponse.json();

      } catch (err) {

        console.warn(
          "[WHATSAPP SIGNUP] No se pudieron obtener negocios:",
          err.message
        );
      }


      // ======================================================
      // 4. RESPUESTA
      // ======================================================

      return res.json({

        ok: true,

        mensaje:
          "Autorización de WhatsApp obtenida correctamente.",

        config_id:
          FACEBOOK_CONFIG_ID,

        redirect_uri:
          FACEBOOK_REDIRECT_URI,

        token_type:
          tokenData.token_type || null,

        expires_in:
          tokenData.expires_in || null,

        debug_token:
          debugToken,

        negocios:
          negocios,

      });


    } catch (error) {

      console.error(
        "[WHATSAPP SIGNUP] Error interno:",
        error
      );

      return res
        .status(500)
        .json({

          ok: false,

          error:
            "Error interno.",

          detalle:
            error.message,

        });
    }
  }
);


// ============================================================
// PÁGINA DE CONEXIÓN WHATSAPP
// ============================================================

app.get(
  "/conectar-whatsapp",
  (_req, res) => {

    res.send(`<!DOCTYPE html>

<html lang="es">

<head>

<meta charset="utf-8" />

<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
/>

<title>
Conectar WhatsApp - Nuevo Comienzo
</title>

<style>

body {
  font-family: Arial, sans-serif;
  max-width: 520px;
  margin: 60px auto;
  padding: 20px;
  text-align: center;
}

button {
  background: #25D366;
  color: white;
  border: none;
  padding: 15px 30px;
  font-size: 17px;
  border-radius: 8px;
  cursor: pointer;
}

button:hover {
  background: #1ebe5b;
}

button:disabled {
  opacity: .6;
  cursor: not-allowed;
}

#resultado {
  margin-top: 25px;
  text-align: left;
  white-space: pre-wrap;
  background: #f4f4f4;
  padding: 15px;
  border-radius: 8px;
  font-size: 13px;
  word-break: break-word;
}

.error {
  color: #d32f2f;
}

.ok {
  color: #188038;
}

</style>

</head>

<body>

<h2>
Conectar número de WhatsApp
</h2>

<p>
Da clic al botón y sigue el flujo de Meta.
</p>

<p>
Cuando aparezca la opción correspondiente,
selecciona conectar tu cuenta existente de
WhatsApp Business.
</p>

<button
  id="btnConectar"
  onclick="launchWhatsAppSignup()"
>
Conectar WhatsApp
</button>

<div id="resultado">
Esperando...
</div>


<script>

// ==========================================================
// FACEBOOK SDK
// ==========================================================

window.fbAsyncInit = function () {

  try {

    FB.init({

      appId:
        '${FACEBOOK_APP_ID}',

      cookie:
        true,

      xfbml:
        true,

      version:
        'v22.0',

    });

    console.log(
      "[FB] SDK inicializado correctamente."
    );

  } catch (err) {

    console.error(
      "[FB] Error:",
      err
    );

    document.getElementById(
      "resultado"
    ).innerHTML =
      '<p class="error">' +
      '⚠️ Error al inicializar Facebook SDK.' +
      '</p>';

  }

};


// ==========================================================
// CARGAR FACEBOOK SDK
// ==========================================================

(function (
  d,
  s,
  id
) {

  var js;

  var fjs =
    d.getElementsByTagName(s)[0];

  if (
    d.getElementById(id)
  ) {

    return;

  }

  js =
    d.createElement(s);

  js.id =
    id;

  js.src =
    "https://connect.facebook.net/es_LA/sdk.js";

  js.async =
    true;

  js.defer =
    true;

  js.onerror =
    function () {

      document.getElementById(
        "resultado"
      ).innerHTML =
        '<p class="error">' +
        '⚠️ No se pudo cargar Facebook SDK.' +
        '</p>';

    };

  fjs.parentNode.insertBefore(
    js,
    fjs
  );

})(
  document,
  "script",
  "facebook-jssdk"
);


```js
// ==========================================================
// INICIAR WHATSAPP EMBEDDED SIGNUP
// ==========================================================
function launchWhatsAppSignup() { const resultado = document.getElementById("resultado"); const boton = document.getElementById("btnConectar"); // ======================================================== // VERIFICAR FACEBOOK SDK // ======================================================== if (typeof FB === "undefined") { resultado.innerHTML = '<p class="error">' + '⚠️ Facebook SDK todavía no está disponible. ' + 'Espera unos segundos e intenta nuevamente.' + '</p>'; return; } boton.disabled = true; resultado.textContent = "Abriendo Facebook..."; console.log( "[WHATSAPP SIGNUP] Iniciando FB.login" ); // ======================================================== // FACEBOOK LOGIN // ======================================================== FB.login( function (response) { console.log( "[WHATSAPP SIGNUP] Respuesta completa:", JSON.stringify( response, null, 2 ) ); // ==================================================== // VERIFICAR RESPUESTA // ==================================================== if ( !response || !response.authResponse ) { boton.disabled = false; resultado.innerHTML = '<p class="error">' + '⚠️ Meta no completó la autorización.' + '</p>'; console.log( "[WHATSAPP SIGNUP] Sin authResponse." ); return; } const authResponse = response.authResponse; console.log( "[WHATSAPP SIGNUP] authResponse:", JSON.stringify( authResponse, null, 2 ) ); // ==================================================== // OBTENER CODE // ==================================================== const code = authResponse.code; console.log( "[WHATSAPP SIGNUP] Código recibido:", code ? "SI" : "NO" ); // ==================================================== // VALIDAR CODE // ==================================================== if (!code) { boton.disabled = false; resultado.innerHTML = '<p class="error">' + '⚠️ Meta no devolvió el código de autorización.' + '</p>'; return; } resultado.textContent = "Código recibido. Enviándolo al servidor..."; // ==================================================== // ENVIAR CODE AL SERVIDOR // ==================================================== fetch( "/conectar-whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) } ) // ==================================================== // RESPUESTA DEL SERVIDOR // ==================================================== .then( async function (r) { const data = await r.json(); console.log( "[WHATSAPP SIGNUP] Respuesta servidor:", JSON.stringify( data, null, 2 ) ); if (!r.ok) { throw new Error( JSON.stringify( data, null, 2 ) ); } return data; } ) // ==================================================== // ÉXITO // ==================================================== .then( function (data) { boton.disabled = false; resultado.innerHTML = '<p class="ok">' + '✅ WhatsApp autorizado correctamente.' + '</p>' + '<pre>' + JSON.stringify( data, null, 2 ) + '</pre>'; } ) // ==================================================== // ERROR // ==================================================== .catch( function (err) { boton.disabled = false; console.error( "[WHATSAPP SIGNUP] Error:", err ); resultado.innerHTML = '<p class="error">' + '⚠️ Error al conectar con el servidor:' + '</p>' + '<pre>' + err.message + '</pre>'; } ); }, // ====================================================== // CONFIGURACIÓN FACEBOOK LOGIN FOR BUSINESS // ====================================================== { config_id: '${FACEBOOK_CONFIG_ID}', response_type: "code", override_default_response_type: true, extras: { sessionInfoVersion: 3, featureType: "whatsapp_business_app_onboarding" } } ); }

// ============================================================
// DIAGNÓSTICO TOKEN
// ============================================================

app.get(
  "/diagnostico-token",
  async (req, res) => {

    if (
      req.query.secret !==
      process.env.WEBHOOK_SECRET
    ) {

      return res
        .status(403)
        .json({
          error:
            "no autorizado",
        });
    }

    const tokenAInspeccionar =
      (
        process.env.WHATSAPP_CLOUD_TOKEN ||
        ""
      ).trim();

    const tokenParaConsultar =
      (
        process.env.META_TOKEN ||
        tokenAInspeccionar
      ).trim();

    if (!tokenAInspeccionar) {

      return res
        .status(500)
        .json({
          error:
            "WHATSAPP_CLOUD_TOKEN no está definido.",
        });
    }

    try {

      const url =
        `https://graph.facebook.com/debug_token?` +
        `input_token=${encodeURIComponent(
          tokenAInspeccionar
        )}` +
        `&access_token=${encodeURIComponent(
          tokenParaConsultar
        )}`;

      const r =
        await fetch(url);

      const data =
        await r.json();

      const info =
        data.data || {};

      res
        .status(r.status)
        .json({

          variable_inspeccionada:
            "WHATSAPP_CLOUD_TOKEN",

          longitud_del_token:
            tokenAInspeccionar.length,

          es_valido:
            info.is_valid ?? null,

          tipo:
            info.type ?? null,

          app_id:
            info.app_id ?? null,

          permisos:
            info.scopes ?? null,

          expira:
            info.expires_at
              ? new Date(
                  info.expires_at * 1000
                ).toISOString()
              : info.expires_at === 0
                ? "nunca"
                : null,

          error_de_meta:
            data.error ||
            info.error ||
            null,

        });

    } catch (err) {

      res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (_req, res) =>
    res.send("ok")
);


// ============================================================
// SERVIDOR
// ============================================================

const port =
  process.env.PORT || 3000;

app.listen(
  port,
  () => {

    console.log(
      `Servidor escuchando en puerto ${port}`
    );

    console.log(
      "=========================================="
    );

    console.log(
      "META / FACEBOOK CONFIG"
    );

    console.log(
      "FACEBOOK_APP_ID:",
      FACEBOOK_APP_ID
    );

    console.log(
      "FACEBOOK_CONFIG_ID:",
      FACEBOOK_CONFIG_ID
    );

    console.log(
      "FACEBOOK_REDIRECT_URI:",
      FACEBOOK_REDIRECT_URI
    );

    console.log(
      "=========================================="
    );

    console.log(
      "URL webhook WhatsApp:"
    );

    console.log(
      "https://watsapp-voice-agent.onrender.com/webhooks/whatsapp-cloud"
    );

    conversaciones.inicializar();
  }
);
```
