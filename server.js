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
// WHATSAPP EMBEDDED SIGNUP
// FACEBOOK LOGIN FOR BUSINESS
//
// NOTA: FACEBOOK_APP_ID, FACEBOOK_CONFIG_ID y FACEBOOK_REDIRECT_URI
// ya están declaradas arriba, en "CONFIGURACIÓN META / FACEBOOK".
// No se vuelven a declarar aquí. (Antes estaban declaradas TRES
// veces en el archivo -al inicio, en la sección de configuración,
// y otra vez aquí- lo que provoca en Node un error de sintaxis
// "Identifier 'FACEBOOK_APP_ID' has already been declared" y
// tumba el servidor por completo antes de arrancar.)
// ============================================================

// El App Secret puede estar guardado en Render bajo cualquiera de
// estos dos nombres (según cuándo se configuró). Se usa el que
// exista, para no depender de que coincidan exactamente.
const META_APP_SECRET =
  process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;

// Recuerda qué "code" de FB.login() ya se intentó intercambiar en
// este proceso, solo para poder avisar en el log si llega repetido
// (un code solo sirve una vez). Se limpia solo si el servicio se
// reinicia; no necesita persistir en base de datos.
const codigosYaProcesados = new Set();

// Oculta cualquier valor que parezca un token/secreto antes de
// mandar una respuesta de Meta al navegador. Es una red de
// seguridad extra: ninguna ruta de abajo manda el access_token
// ni el App Secret al cliente, pero esto evita que un campo
// inesperado en la respuesta de Meta se filtre por accidente.
function ocultarTokens(obj) {
  if (!obj || typeof obj !== "object") return obj;

  const CLAVES_SENSIBLES = [
    "access_token",
    "token",
    "client_secret",
    "app_secret",
    "authorization",
  ];

  if (Array.isArray(obj)) {
    return obj.map(ocultarTokens);
  }

  const limpio = {};
  for (const [key, value] of Object.entries(obj)) {
    if (CLAVES_SENSIBLES.includes(key.toLowerCase())) {
      limpio[key] = "[oculto]";
    } else if (value && typeof value === "object") {
      limpio[key] = ocultarTokens(value);
    } else {
      limpio[key] = value;
    }
  }
  return limpio;
}


// ============================================================
// INTERCAMBIO CODE -> ACCESS TOKEN
// ============================================================

app.post("/conectar-whatsapp", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();

    // Estos dos llegan del listener de postMessage en el navegador
    // (evento WA_EMBEDDED_SIGNUP). Son opcionales porque Meta no
    // siempre los manda, pero cuando llegan son la forma más
    // confiable de saber exactamente qué WABA/número se conectó
    // en ESTA sesión (evita ambigüedad cuando hay varias WABAs en
    // el Business Manager, como ya ha pasado en esta cuenta).
    const wabaIdDesdeCliente = String(req.body?.waba_id || "").trim();
    const phoneNumberIdDesdeCliente = String(
      req.body?.phone_number_id || ""
    ).trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Falta el código de autorización.",
      });
    }

    if (!META_APP_SECRET) {
      console.error(
        "[WHATSAPP SIGNUP] Falta META_APP_SECRET / WHATSAPP_APP_SECRET en las variables de entorno."
      );
      return res.status(500).json({
        ok: false,
        error:
          "El servidor no tiene configurado el App Secret de Meta (META_APP_SECRET).",
      });
    }

    // Detección de code repetido: el "code" de FB.login() solo
    // sirve UNA vez. Si llega repetido (doble clic, reintento del
    // navegador, refresh sin limpiar, etc.) Meta va a rechazarlo
    // con el mismo error de "verification code" aunque la primera
    // vez sí haya funcionado. Esto lo deja bien claro en el log.
    if (codigosYaProcesados.has(code)) {
      console.warn(
        "[WHATSAPP SIGNUP] Este 'code' YA se había recibido antes en este " +
        "proceso del servidor. Un code de FB.login() solo se puede " +
        "intercambiar una vez; si Meta lo rechaza, el problema real es " +
        "que ya se usó (o expiró), no el redirect_uri."
      );
    }
    codigosYaProcesados.add(code);

    console.log("==========================================");
    console.log("[WHATSAPP SIGNUP] Iniciando intercambio");
    console.log("[WHATSAPP SIGNUP] Hora del intento:", new Date().toISOString());
    console.log("[WHATSAPP SIGNUP] App ID:", FACEBOOK_APP_ID);
    console.log("[WHATSAPP SIGNUP] Config ID:", FACEBOOK_CONFIG_ID);
    console.log(
      "[WHATSAPP SIGNUP] Longitud de META_APP_SECRET usado:",
      META_APP_SECRET.length,
      "(fuente:",
      process.env.META_APP_SECRET ? "META_APP_SECRET" : "WHATSAPP_APP_SECRET",
      ")"
    );
    console.log(
      "[WHATSAPP SIGNUP] redirect_uri enviado en el intercambio: NO (intencional)"
    );
    console.log(
      "[WHATSAPP SIGNUP] waba_id (cliente):",
      wabaIdDesdeCliente || "no recibido"
    );
    console.log(
      "[WHATSAPP SIGNUP] phone_number_id (cliente):",
      phoneNumberIdDesdeCliente || "no recibido"
    );

    // ======================================================
    // 1. INTERCAMBIAR CODE POR TOKEN
    // ======================================================

    // IMPORTANTE: aquí NO se manda "redirect_uri".
    // Cuando el "code" viene del SDK de JavaScript vía FB.login()
    // (como en Embedded Signup), Meta lo genera sin un redirect_uri
    // real -no hay redirección de servidor a servidor-, así que
    // mandar redirect_uri en el intercambio provoca el error
    // "Error validating verification code... redirect_uri" con
    // error_subcode 36008. redirect_uri solo aplica al flujo
    // clásico de OAuth por redirección (Login Dialog por URL),
    // no al flujo de FB.login() en el navegador.
    //
    // OJO: Meta reutiliza este MISMO mensaje/subcode 36008 también
    // cuando el code ya se usó, ya expiró (dura muy poco, segundos),
    // o cuando client_secret no es el correcto para este App ID. El
    // texto del error no distingue estas causas.
    const parametros = new URLSearchParams();
    parametros.append("client_id", FACEBOOK_APP_ID);
    parametros.append("client_secret", META_APP_SECRET);
    parametros.append("code", code);

    const tokenResponse = await fetch(
      "https://graph.facebook.com/v22.0/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: parametros.toString(),
      }
    );

    const tokenData = await tokenResponse.json();

    // Nunca se imprime el token completo en logs, solo si llegó o no.
    console.log(
      "[WHATSAPP SIGNUP] Respuesta token recibida. access_token presente:",
      !!tokenData.access_token
    );

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo obtener el token.",
        detalle: ocultarTokens(tokenData),
        diagnostico: {
          app_id: FACEBOOK_APP_ID,
          config_id: FACEBOOK_CONFIG_ID,
          mensaje:
            "El code de FB.login() solo puede usarse una vez y expira " +
            "en segundos. Causas típicas: (1) se intentó usar un code " +
            "ya usado o expirado -recarga la página e intenta de nuevo " +
            "desde cero-, (2) el App Secret (META_APP_SECRET / " +
            "WHATSAPP_APP_SECRET) no coincide con el de esta app en " +
            "Meta Developers, o (3) el dominio " +
            "watsapp-voice-agent.onrender.com no está dado de alta en " +
            "Meta Developers > Facebook Login for Business > " +
            "Configuración del cliente de OAuth (Dominios permitidos " +
            "para el SDK de JavaScript).",
        },
      });
    }

    const accessToken = tokenData.access_token;
    console.log("[WHATSAPP SIGNUP] Token obtenido correctamente.");

    // Token del sistema (larga duración), si está configurado. Se
    // usa para la operación administrativa de suscribir la app a
    // la WABA (paso 5), porque el usuario del sistema normalmente
    // tiene permisos de admin permanentes sobre app + WABA, a
    // diferencia del token corto que entrega el login del navegador.
    const tokenAdmin = (process.env.META_TOKEN || accessToken).trim();

    // ======================================================
    // 2. CONSULTAR INFORMACIÓN DEL TOKEN
    // ======================================================

    let debugToken = null;
    try {
      const debugResponse = await fetch(
        "https://graph.facebook.com/debug_token?" +
          new URLSearchParams({
            input_token: accessToken,
            access_token: accessToken,
          })
      );
      debugToken = await debugResponse.json();
    } catch (err) {
      console.warn(
        "[WHATSAPP SIGNUP] No se pudo depurar el token:",
        err.message
      );
    }

    // ======================================================
    // 3. OBTENER NEGOCIOS (BUSINESS MANAGER) DEL USUARIO
    // ======================================================

    let negocios = null;
    try {
      const negociosResponse = await fetch(
        "https://graph.facebook.com/v22.0/me/businesses?" +
          new URLSearchParams({
            fields: "id,name",
            access_token: accessToken,
          })
      );
      negocios = await negociosResponse.json();
    } catch (err) {
      console.warn(
        "[WHATSAPP SIGNUP] No se pudieron obtener negocios:",
        err.message
      );
    }

    // ======================================================
    // 4. WABA Y NÚMEROS DE TELÉFONO
    //
    // Prioridad 1: waba_id que mandó el navegador (evento
    // WA_EMBEDDED_SIGNUP). Es la fuente más confiable.
    //
    // Prioridad 2 (respaldo): si no llegó del navegador, se
    // recorren los negocios obtenidos en el paso 3 buscando
    // sus WABAs (propias y de cliente). Si se encuentra una
    // sola, se usa esa; si hay varias, se listan todas para
    // que tú elijas manualmente cuál es la correcta.
    // ======================================================

    let wabaId = wabaIdDesdeCliente || null;
    let wabaInfo = null;
    let numeros = null;
    let wabasEncontradas = [];

    if (!wabaId && negocios?.data?.length) {
      for (const negocio of negocios.data) {
        for (const edge of [
          "owned_whatsapp_business_accounts",
          "client_whatsapp_business_accounts",
        ]) {
          try {
            const wabasResponse = await fetch(
              `https://graph.facebook.com/v22.0/${negocio.id}/${edge}?` +
                new URLSearchParams({
                  fields: "id,name",
                  access_token: accessToken,
                })
            );
            const wabasData = await wabasResponse.json();

            if (Array.isArray(wabasData?.data)) {
              for (const w of wabasData.data) {
                wabasEncontradas.push({
                  negocio_id: negocio.id,
                  negocio_nombre: negocio.name,
                  relacion: edge,
                  waba_id: w.id,
                  waba_nombre: w.name,
                });
              }
            }
          } catch (err) {
            console.warn(
              `[WHATSAPP SIGNUP] No se pudo consultar ${edge} del negocio ${negocio.id}:`,
              err.message
            );
          }
        }
      }

      if (wabasEncontradas.length === 1) {
        wabaId = wabasEncontradas[0].waba_id;
      }
    }

    if (wabaId) {
      try {
        const wabaResponse = await fetch(
          `https://graph.facebook.com/v22.0/${wabaId}?` +
            new URLSearchParams({
              fields: "id,name,owner_business_info",
              access_token: accessToken,
            })
        );
        wabaInfo = await wabaResponse.json();
      } catch (err) {
        console.warn(
          "[WHATSAPP SIGNUP] No se pudo obtener info de la WABA:",
          err.message
        );
      }

      try {
        const numerosResponse = await fetch(
          `https://graph.facebook.com/v22.0/${wabaId}/phone_numbers?` +
            new URLSearchParams({
              fields:
                "id,display_phone_number,verified_name,code_verification_status,quality_rating",
              access_token: accessToken,
            })
        );
        numeros = await numerosResponse.json();
      } catch (err) {
        console.warn(
          "[WHATSAPP SIGNUP] No se pudieron obtener los números de la WABA:",
          err.message
        );
      }
    }

    // ======================================================
    // 5. SUSCRIBIR LA APP A LA WABA
    //
    // Paso obligatorio para que los mensajes de ESE número
    // empiecen a llegar al webhook configurado en la app. Sin
    // esto, el número puede quedar "conectado" en Meta pero el
    // agente nunca recibe sus mensajes. Se usa el token del
    // usuario del sistema (META_TOKEN) cuando existe.
    // ======================================================

    let suscripcion = null;

    if (wabaId) {
      try {
        const suscripcionResponse = await fetch(
          `https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              access_token: tokenAdmin,
            }).toString(),
          }
        );
        suscripcion = await suscripcionResponse.json();

        console.log(
          "[WHATSAPP SIGNUP] Suscripción de la app a la WABA:",
          JSON.stringify(suscripcion)
        );
      } catch (err) {
        console.warn(
          "[WHATSAPP SIGNUP] No se pudo suscribir la app a la WABA:",
          err.message
        );
        suscripcion = { error: err.message };
      }
    }

    // ======================================================
    // 6. RESPUESTA
    //
    // Nunca se manda accessToken, client_secret ni tokenAdmin
    // al navegador. Todo lo que viene de Meta pasa además por
    // ocultarTokens() como red de seguridad extra.
    // ======================================================

    return res.json({
      ok: true,
      mensaje: "Autorización de WhatsApp obtenida correctamente.",
      config_id: FACEBOOK_CONFIG_ID,
      redirect_uri: FACEBOOK_REDIRECT_URI,
      token_type: tokenData.token_type || null,
      expires_in: tokenData.expires_in || null,
      debug_token: ocultarTokens(debugToken),
      negocios: ocultarTokens(negocios),
      waba_id: wabaId,
      waba_info: ocultarTokens(wabaInfo),
      numeros_telefono: ocultarTokens(numeros),
      wabas_encontradas: wabasEncontradas.length ? wabasEncontradas : null,
      suscripcion_webhook: ocultarTokens(suscripcion),
      phone_number_id_recibido_del_navegador:
        phoneNumberIdDesdeCliente || null,
    });
  } catch (error) {
    console.error("[WHATSAPP SIGNUP] Error interno:", error);
    return res.status(500).json({
      ok: false,
      error: "Error interno.",
      detalle: error.message,
    });
  }
});


// ============================================================
// PÁGINA DE CONEXIÓN WHATSAPP
// ============================================================

app.get("/conectar-whatsapp", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Conectar WhatsApp - Nuevo Comienzo</title>
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
button:hover { background: #1ebe5b; }
button:disabled { opacity: .6; cursor: not-allowed; }
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
.error { color: #d32f2f; }
.ok { color: #188038; }
</style>
</head>
<body>

<h2>Conectar número de WhatsApp</h2>
<p>Da clic al botón y sigue el flujo de Meta.</p>
<p>
Cuando aparezca la opción correspondiente, selecciona conectar
tu cuenta existente de WhatsApp Business.
</p>

<button id="btnConectar" onclick="launchWhatsAppSignup()">Conectar WhatsApp</button>

<div id="resultado">Esperando...</div>

<script>

// ==========================================================
// DATOS CAPTURADOS DEL EVENTO WA_EMBEDDED_SIGNUP
// (postMessage que manda Meta durante el flujo, antes o junto
// con el callback de FB.login; es la forma oficial de Meta de
// avisar qué waba_id / phone_number_id se conectó)
// ==========================================================
var datosEmbeddedSignup = {
  waba_id: null,
  phone_number_id: null
};

window.addEventListener("message", function (event) {
  if (
    event.origin !== "https://www.facebook.com" &&
    event.origin !== "https://web.facebook.com"
  ) {
    return;
  }

  var data;
  try {
    data = JSON.parse(event.data);
  } catch (e) {
    return; // no era un mensaje de WA_EMBEDDED_SIGNUP, se ignora
  }

  if (data.type !== "WA_EMBEDDED_SIGNUP") return;

  console.log("[WA_EMBEDDED_SIGNUP]", data.event, data.data);

  if (data.event === "FINISH") {
    datosEmbeddedSignup.waba_id = data.data.waba_id || null;
    datosEmbeddedSignup.phone_number_id = data.data.phone_number_id || null;
  } else if (data.event === "FINISH_ONLY_WABA") {
    datosEmbeddedSignup.waba_id = data.data.waba_id || null;
  } else if (data.event === "CANCEL") {
    console.warn(
      "[WA_EMBEDDED_SIGNUP] Cancelado en el paso:",
      data.data.current_step
    );
  } else if (data.event === "ERROR") {
    console.error("[WA_EMBEDDED_SIGNUP] Error:", data.data.error_message);
  }
});

// ==========================================================
// FACEBOOK SDK
// ==========================================================

window.fbAsyncInit = function () {
  try {
    FB.init({
      appId: '${FACEBOOK_APP_ID}',
      cookie: true,
      xfbml: true,
      version: 'v22.0'
    });
    console.log("[FB] SDK inicializado correctamente.");
  } catch (err) {
    console.error("[FB] Error:", err);
    document.getElementById("resultado").innerHTML =
      '<p class="error">⚠️ Error al inicializar Facebook SDK.</p>';
  }
};

// ==========================================================
// CARGAR FACEBOOK SDK
// ==========================================================

(function (d, s, id) {
  var js;
  var fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s);
  js.id = id;
  js.src = "https://connect.facebook.net/es_LA/sdk.js";
  js.async = true;
  js.defer = true;
  js.onerror = function () {
    document.getElementById("resultado").innerHTML =
      '<p class="error">⚠️ No se pudo cargar Facebook SDK.</p>';
  };
  fjs.parentNode.insertBefore(js, fjs);
})(document, "script", "facebook-jssdk");

// ==========================================================
// INICIAR WHATSAPP EMBEDDED SIGNUP
// ==========================================================

function launchWhatsAppSignup() {
  const resultado = document.getElementById("resultado");
  const boton = document.getElementById("btnConectar");

  if (typeof FB === "undefined") {
    resultado.innerHTML =
      '<p class="error">⚠️ Facebook SDK todavía no está disponible. ' +
      'Espera unos segundos e intenta nuevamente.</p>';
    return;
  }

  boton.disabled = true;
  resultado.textContent = "Abriendo Facebook...";
  console.log("[WHATSAPP SIGNUP] Iniciando FB.login");

  FB.login(
    function (response) {
      console.log(
        "[WHATSAPP SIGNUP] Respuesta completa:",
        JSON.stringify(response, null, 2)
      );

      if (!response || !response.authResponse) {
        boton.disabled = false;
        resultado.innerHTML =
          '<p class="error">⚠️ Meta no completó la autorización.</p>';
        console.log("[WHATSAPP SIGNUP] Sin authResponse.");
        return;
      }

      const authResponse = response.authResponse;
      console.log(
        "[WHATSAPP SIGNUP] authResponse:",
        JSON.stringify(authResponse, null, 2)
      );

      const code = authResponse.code;
      console.log("[WHATSAPP SIGNUP] Código recibido:", code ? "SI" : "NO");

      if (!code) {
        boton.disabled = false;
        resultado.innerHTML =
          '<p class="error">⚠️ Meta no devolvió el código de autorización.</p>';
        return;
      }

      resultado.textContent = "Código recibido. Enviándolo al servidor...";

      fetch("/conectar-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code,
          waba_id: datosEmbeddedSignup.waba_id,
          phone_number_id: datosEmbeddedSignup.phone_number_id
        })
      })
        .then(async function (r) {
          const data = await r.json();
          console.log(
            "[WHATSAPP SIGNUP] Respuesta servidor:",
            JSON.stringify(data, null, 2)
          );
          if (!r.ok) {
            throw new Error(JSON.stringify(data, null, 2));
          }
          return data;
        })
        .then(function (data) {
          boton.disabled = false;
          resultado.innerHTML =
            '<p class="ok">✅ WhatsApp autorizado correctamente.</p>' +
            '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        })
        .catch(function (err) {
          boton.disabled = false;
          console.error("[WHATSAPP SIGNUP] Error:", err);
          resultado.innerHTML =
            '<p class="error">⚠️ Error al conectar con el servidor:</p>' +
            '<pre>' + err.message + '</pre>';
        });
    },
    {
      config_id: '${FACEBOOK_CONFIG_ID}',
      response_type: "code",
      override_default_response_type: true,
      extras: {
        sessionInfoVersion: 3,
        featureType: "whatsapp_business_app_onboarding"
      }
    }
  );
}

</script>

</body>
</html>`);
});



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
