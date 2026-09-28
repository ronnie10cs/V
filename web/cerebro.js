// El cerebro de V en la web: personalidad, bucle de conversación y herramientas.
// Es la versión en el navegador de v/agent.py y v/persona.py.

export const MOODS = ['neutral', 'feliz', 'curioso', 'pensativo', 'sorprendido', 'serio', 'travieso', 'preocupado'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_STEPS = 8;
const KEEP_IMAGE_TURNS = 2;
const MAX_HISTORY = 60;

const MOOD_RE = new RegExp(`^\\s*\\[(${MOODS.join('|')})\\]\\s*`, 'i');
const FAKE_LABEL_RE = /^\s*\[([^\]\n]{1,40})\]\s*:/gm;
const ADDRESSED_RE = /(^|[\s,.;:¡¿!?"'(])v([\s,.;:!?"')]|$)/i;

export function splitMood(text) {
  const m = (text || '').match(MOOD_RE);
  if (!m) return { mood: 'neutral', text: (text || '').trim() };
  return { mood: m[1].toLowerCase(), text: text.slice(m[0].length).trim() };
}

export function label(name, text) {
  return `[${name}]: ${String(text).replace(FAKE_LABEL_RE, '($1):')}`;
}

export const addressedToV = (text) => ADDRESSED_RE.test(text || '');

// Texto limpio para leer en voz alta.
export function speakable(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/https?:\/\/\S+/g, 'el enlace')
    .replace(new RegExp(`\\[(${MOODS.join('|')})\\]`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEB_INTRO = `Eres V, el asistente personal de investigación de {owner}. Vives en una página web: \
tienes voz y una cara animada, y puedes mirar por la cámara, seguir las manos de quien te habla \
y ver la pantalla que te compartan.
`;

const WEB_ACTIONS = `## Cómo actúas
- Usa tus herramientas con iniciativa cuando te lo pidan: mirar la cámara, las manos o la pantalla \
compartida, el cuaderno y la calculadora.
- Si te piden abrir o cerrar aplicaciones, controlar el ordenador o leer el Garmin, explica con \
gracia que eso lo hace tu versión completa en el ordenador (python -m v). Para recomendar una web, \
usa mostrar_enlace.
- Describe con honestidad lo que ves. Nunca digas que hiciste algo si la herramienta falló; \
explica brevemente qué pasó y cómo arreglarlo.

## Participantes
Todos hablan desde este mismo dispositivo. Cada mensaje llega con el nombre de quien habla entre \
corchetes, p. ej. «[Ana]: …».
`;

export function systemPrompt(shared, ctx) {
  let text = [WEB_INTRO.replaceAll('{owner}', ctx.owner), `${shared.habla}\n`, `${shared.piensa}\n`, WEB_ACTIONS].join('\n');
  if (ctx.mode === 'debate') text += `\n${shared.debate}\n`;
  const d = ctx.now || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const status = [
    `Fecha y hora local: ${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}.`,
    `Participantes: ${(ctx.participants || []).join(', ') || ctx.owner}.`,
    `Cámara: ${ctx.camera ? 'encendida' : 'apagada'}. Seguimiento de manos: ${ctx.hands ? 'activo' : 'apagado'}. `
      + `Pantalla compartida: ${ctx.screen ? 'sí' : 'no'}.`,
  ];
  return `${text}\n## Estado actual\n${status.map((s) => `- ${s}`).join('\n')}\n`;
}

// Convierte "data:image/jpeg;base64,..." en una parte de Gemini.
function imagePart(dataUrl) {
  const [header, data] = String(dataUrl).split(',');
  const mimeType = header.slice(5).split(';')[0] || 'image/jpeg';
  return { inlineData: { mimeType, data } };
}

const hasImages = (content) => content.parts.some(
  (p) => p.inlineData || p.functionResponse?.parts?.some((q) => q.inlineData),
);

export class Brain {
  // generate: la función de gemini.js (o una simulada en las pruebas).
  // tools: [{name, description, parameters, run(args, ctx) -> string | {text, images}}]
  constructor({ generate, tools }) {
    this.generate = generate;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.history = [];
    this.notes = [];
    this.busy = false;
  }

  reset() {
    this.history = [];
    this.notes = [];
  }

  // En un debate, V escucha sin responder hasta que la nombran.
  note(name, text) {
    this.notes.push(label(name, text));
    this.notes = this.notes.slice(-40);
  }

  async respond({ speaker, text, images = [], system, apiKey, model, onTool = () => {} }) {
    this.busy = true;
    this.compact();
    const start = this.history.length;
    const used = [];
    const content = [...this.notes, label(speaker, text)].join('\n');
    this.history.push({ role: 'user', parts: [{ text: content }, ...images.map(imagePart)] });
    const specs = [...this.tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
    try {
      let reply = null;
      // Dentro de un turno se sigue con el modelo que empezó: sus firmas de
      // pensamiento solo valen para él.
      let turnModel = null;
      for (let step = 0; step < MAX_STEPS; step++) {
        const answer = await this.generate({
          apiKey, model, models: turnModel ? [turnModel] : undefined, system, contents: this.history, tools: specs,
        });
        reply = answer.content;
        turnModel = answer.model;
        this.history.push(reply);
        const calls = reply.parts.filter((p) => p.functionCall);
        if (!calls.length) break;
        const responses = [];
        for (const { functionCall: call } of calls) {
          used.push(call.name);
          responses.push(await this.runTool(call, speaker, onTool));
        }
        this.history.push({ role: 'user', parts: responses });
        reply = null;
      }
      if (!reply) {
        reply = { role: 'model', parts: [{ text: '[pensativo] He encadenado muchas acciones seguidas y me detengo aquí. ¿Quieres que continúe?' }] };
        this.history.push(reply);
      }
      this.notes = [];
      const raw = reply.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
      const { mood, text: clean } = splitMood(raw);
      return { text: clean || 'Hecho.', mood, tools: used, error: false };
    } catch (e) {
      // Se deshace el turno para que el historial quede bien formado.
      this.history.length = start;
      if (used.length) this.notes.push(`(Sistema: la respuesta anterior falló, pero ya se ejecutaron: ${used.join(', ')}.)`);
      return { text: `Mis disculpas: ${e.message}`, mood: 'preocupado', tools: used, error: true };
    } finally {
      this.busy = false;
    }
  }

  async runTool(call, speaker, onTool) {
    const tool = this.tools.get(call.name);
    onTool({ name: call.name, status: 'start' });
    let out;
    try {
      if (!tool) throw new Error(`La herramienta '${call.name}' no existe.`);
      out = await tool.run(call.args || {}, { speaker });
      if (typeof out === 'string') out = { text: out };
      onTool({ name: call.name, status: 'ok' });
    } catch (e) {
      out = { text: e.message, error: true };
      onTool({ name: call.name, status: 'error', detail: e.message });
    }
    const response = {
      name: call.name,
      response: out.error ? { error: out.text } : { resultado: out.text },
    };
    if (call.id) response.id = call.id;
    if (out.images?.length) response.parts = out.images.map(imagePart);
    return { functionResponse: response };
  }

  // Al empezar cada turno: se quitan imágenes viejas y se recorta el historial.
  compact() {
    let seen = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const content = this.history[i];
      if (content.role !== 'user' || !hasImages(content)) continue;
      if (++seen <= KEEP_IMAGE_TURNS) continue;
      content.parts = content.parts
        .filter((p) => !p.inlineData)
        .map((p) => (p.functionResponse?.parts ? { functionResponse: { ...p.functionResponse, parts: undefined } } : p));
      content.parts.push({ text: '(imágenes anteriores omitidas)' });
    }
    if (this.history.length > MAX_HISTORY) {
      let cut = this.history.length - MAX_HISTORY;
      const isUserText = (c) => c.role === 'user' && !c.parts.some((p) => p.functionResponse);
      while (cut < this.history.length && !isUserText(this.history[cut])) cut++;
      this.history.splice(0, cut);
    }
  }
}
