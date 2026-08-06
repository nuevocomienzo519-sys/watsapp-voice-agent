/**
 * lib/tts.js
 * Texto a voz usando la API de OpenAI (reemplaza a ElevenLabs).
 *
 * Requiere únicamente OPENAI_API_KEY en las variables de entorno.
 * Ya no se usan ELEVENLABS_API_KEY ni ELEVENLABS_VOICE_ID.
 */
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
// Voces disponibles: alloy, echo, fable, onyx, nova, shimmer
// nova y shimmer suenan más cálidas/naturales; alloy es más neutra.
const VOICE = process.env.OPENAI_TTS_VOICE || "nova";
// tts-1-hd tiene mejor calidad y fluidez que tts-1 (mismo uso, algo más lento/caro).
const MODEL = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
// Velocidad de habla: 0.25 a 4.0 (1.0 = normal). Un poco más lento suele
// sonar más natural y menos "apurado".
const SPEED = process.env.OPENAI_TTS_SPEED ? parseFloat(process.env.OPENAI_TTS_SPEED) : 0.95;

/**
 * Convierte texto a audio (mp3) usando OpenAI.
 * @param {string} text - Texto a sintetizar.
 * @returns {Promise<Buffer>} - Buffer de audio en formato mp3.
 */
async function synthesizeSpeech(text) {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("synthesizeSpeech: se requiere texto no vacío.");
  }
  const response = await fetch(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      response_format: "mp3",
      speed: SPEED,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenAI TTS falló (${response.status}): ${errorBody || response.statusText}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
module.exports = { synthesizeSpeech };
