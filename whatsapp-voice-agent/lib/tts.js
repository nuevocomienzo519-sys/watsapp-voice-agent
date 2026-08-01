const fetch = require("node-fetch");

/**
 * Convierte texto a audio (mp3) usando ElevenLabs.
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function synthesizeSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fallo en TTS (ElevenLabs): ${res.status} - ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

module.exports = { synthesizeSpeech };
