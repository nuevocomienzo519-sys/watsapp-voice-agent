// routes/asistente.js
//
// Marcador de posición. server.js hace require de este archivo, y si no
// existe el servicio entero no arranca (que es justo lo que estaba pasando).
//
// El asistente privado real todavía no está subido al repo. Mientras tanto
// este router no hace nada más que responder algo claro en /asistente, y
// sobre todo deja que el servidor levante y la galería se vea.

const express = require("express");
const router = express.Router();

router.get("/asistente", (req, res) => {
  res
    .status(503)
    .type("html")
    .send(
      "<!doctype html><meta charset=utf-8>" +
        "<div style=\"font-family:system-ui;padding:40px;max-width:520px;margin:auto\">" +
        "<h2>Asistente no disponible</h2>" +
        "<p>Esta sección todavía no está publicada.</p>" +
        "<p><a href=\"/galeria/\">Ir a la galería</a></p></div>"
    );
});

module.exports = router;
