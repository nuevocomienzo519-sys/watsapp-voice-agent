/**
 * lib/tts.js
 * Texto a voz usando la API de OpenAI (reemplaza a ElevenLabs).
 *
 * Requiere únicamente OPENAI_API_KEY en las variables de entorno.
 * Ya no se usan ELEVENLABS_API_KEY ni ELEVENLABS_VOICE_ID.
 */

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

// Voces disponibles: alloy, echo, fable, onyx, nova, shimmer
const VOICE = process.env.OPENAI_TTS_VOICE || "alloy";
const MODEL = process.env.OPENAI_TTS_MODEL || "tts-1";

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
