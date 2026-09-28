// Cliente mínimo de la API de Gemini para usar V directamente desde el navegador.
// La clave va en una cabecera y solo viaja a Google.

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const TTS_MODEL = 'gemini-3.8-flash-tts';
export const TTS_VOICES = {
  Charon: 'Charon · informativa y serena',
  Iapetus: 'Iapetus · clara',
  Algieba: 'Algieba · suave',
  Orus: 'Orus · firme',
  Sadaltager: 'Sadaltager · erudita',
};
const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function post(url, apiKey, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GeminiError('No pude conectar con Gemini. Revisa tu conexión a internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw toError(res.status, data?.error?.message || '');
  return data;
}

function toError(status, message) {
  if (status === 429) return new GeminiError('Se agotó la cuota gratuita de Gemini por ahora. Espera un minuto y vuelve a intentarlo.', status);
  if (status === 401 || status === 403 || (status === 400 && /api key|api_key/i.test(message))) {
    return new GeminiError('Tu clave de Gemini no es válida. Revísala en Ajustes.', status);
  }
  if (status === 404) return new GeminiError(`Ese modelo no existe o no está disponible: ${message}`, status);
  if (status >= 500) return new GeminiError('Gemini no está disponible ahora mismo. Inténtalo en un momento.', status);
  return new GeminiError(`Gemini rechazó la petición: ${message || status}`, status);
}

// Una llamada de conversación. `contents` son turnos de Gemini ({role, parts}) y
// `tools` son {name, description, parameters}. Devuelve el turno del modelo tal
// cual (con sus firmas de pensamiento) para reenviarlo en el siguiente paso.
export async function generate({ apiKey, model = DEFAULT_MODEL, system, contents, tools = [], fetchImpl = fetch }) {
  const body = { systemInstruction: { parts: [{ text: system }] }, contents };
  if (tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })),
    }];
  }
  const data = await post(`${API}/models/${encodeURIComponent(model)}:generateContent`, apiKey, body, fetchImpl);
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.length) {
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason;
    return { role: 'model', parts: [{ text: `[serio] No puedo responder a eso${reason ? ` (${reason})` : ''}.` }] };
  }
  return { role: 'model', parts: candidate.content.parts };
}

// Voz de Gemini: devuelve un Blob de audio listo para reproducir.
export async function speak({ apiKey, text, voice = 'Charon', model = TTS_MODEL, fetchImpl = fetch }) {
  const body = {
    model,
    input: [{
      type: 'user_input',
      content: [{
        type: 'text',
        text,
        annotations: [{ type: 'speech_metadata', style: 'elegante, clara y serena, con un toque de ironía amable' }],
      }],
    }],
    response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
    generation_config: { speech_config: [{ voice }] },
  };
  const data = await post(`${API}/interactions`, apiKey, body, fetchImpl);
  const audio = findAudio(data);
  if (!audio) throw new GeminiError('Gemini no devolvió audio.');
  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  const isWav = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF';
  return isWav ? new Blob([bytes], { type: 'audio/wav' }) : new Blob([wavHeader(bytes.length, 24000), bytes], { type: 'audio/wav' });
}

function findAudio(data) {
  if (data?.output_audio?.data) return data.output_audio;
  let found = null;
  for (const step of data?.steps || []) {
    for (const item of step?.content || []) {
      if (item?.type === 'audio' && item.data) found = item;
    }
  }
  return found;
}

// Cabecera WAV para PCM de 16 bits mono, por si llega audio sin cabecera.
function wavHeader(length, rate) {
  const v = new DataView(new ArrayBuffer(44));
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + length, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, length, true);
  return v.buffer;
}
