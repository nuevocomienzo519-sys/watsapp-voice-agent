const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
/**
 * Convierte un buffer de audio (wav, generado por OpenAI TTS) a ogg/opus
 * mono 16kHz, que es el formato que WhatsApp necesita para mostrar el
 * audio como "nota de voz" (con forma de onda) en vez de un archivo
 * adjunto normal.
 *
 * Usa archivos temporales porque fluent-ffmpeg/ffmpeg trabajan mejor así
 * que con streams en memoria para este tipo de conversión.
 *
 * @param {Buffer} inputBuffer - audio de entrada (wav)
 * @returns {Promise<Buffer>} audio en formato ogg/opus
 */
async function convertToOggOpus(inputBuffer) {
  const tmpId = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `${tmpId}-in.wav`);
  const outputPath = path.join(os.tmpdir(), `${tmpId}-out.ogg`);
  await fs.writeFile(inputPath, inputBuffer);
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec("libopus")
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate("64k")
        .format("ogg")
        .on("error", reject)
        .on("end", resolve)
        .save(outputPath);
    });
    return await fs.readFile(outputPath);
  } finally {
    // Limpieza best-effort; no truena el flujo si algo ya no existe.
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
module.exports = { convertToOggOpus };
