const fetch = require("node-fetch");
const FormData = require("form-data");

/**
 * Transcribe un audio (Buffer) a texto usando Whisper de OpenAI.
 * @param {Buffer} audioBuffer
 * @param {string} filename - nombre con extension correcta (ej. "nota.ogg")
 * @returns {Promise<string>} texto transcrito
 */
async function transcribeAudio(audioBuffer, filename = "nota.ogg") {
  const form = new FormData();
  form.append("file", audioBuffer, { filename });
  form.append("model", "whisper-1");
  form.append("language", "es");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fallo en transcripción (Whisper): ${res.status} - ${body}`);
  }

  const data = await res.json();
  return data.text;
}

module.exports = { transcribeAudio };
