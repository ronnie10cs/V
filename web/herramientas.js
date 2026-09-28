// Herramientas de V en la web: sentidos (cámara, manos, pantalla compartida),
// cuaderno de hipótesis, calculadora y enlaces.

import { evaluate, format } from './calculo.js';
import { EVIDENCE_KINDS, Notebook, STATES } from './cuaderno.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const HID = { type: 'string', description: "Id de la hipótesis, p. ej. 'H3'." };

const GESTURES = {
  Thumb_Up: 'pulgar arriba 👍', Thumb_Down: 'pulgar abajo 👎', Open_Palm: 'palma abierta ✋',
  Closed_Fist: 'puño cerrado ✊', Pointing_Up: 'índice arriba ☝️', Victory: 'victoria ✌️',
  ILoveYou: 'te quiero 🤟', None: 'sin gesto reconocido',
};

// senses: { cameraFrame() -> dataURL|null, hands() -> {on, latest, history}, screenFrame() -> dataURL|null }
export function senseTools(senses) {
  return [
    {
      name: 'ver_camara',
      description: 'Toma una foto con la cámara del dispositivo y te la muestra. Úsala cuando te pidan mirar algo, a alguien o un experimento.',
      parameters: obj(),
      run: () => {
        const frame = senses.cameraFrame();
        if (!frame) throw new Error('La cámara está apagada. Pide que la enciendan con el botón de la cámara.');
        return { text: 'Imagen actual de la cámara.', images: [frame] };
      },
    },
    {
      name: 'ver_manos',
      description: 'Lee el seguimiento de manos en tiempo real: gesto, dedos extendidos, posición, velocidad y gestos recientes.',
      parameters: obj(),
      run: () => {
        const h = senses.hands();
        if (!h.on) throw new Error('El seguimiento de manos está apagado. Se activa con el botón de la mano.');
        const hands = h.latest?.hands || [];
        const lines = hands.length ? [] : ['Ahora mismo no veo ninguna mano.'];
        for (const hand of hands) {
          lines.push(`Mano ${hand.handedness}: ${GESTURES[hand.gesture] || hand.gesture}, ${hand.fingers} dedos extendidos, `
            + `posición x=${hand.x}, y=${hand.y} (0-1, origen arriba a la izquierda), velocidad ${hand.speed}.`);
        }
        if (h.history?.length) lines.push(`Gestos recientes: ${JSON.stringify(h.history.slice(-12))}`);
        return lines.join('\n');
      },
    },
    {
      name: 'ver_pantalla',
      description: 'Mira la pantalla, ventana o pestaña que te han compartido y te la muestra.',
      parameters: obj(),
      run: () => {
        const frame = senses.screenFrame();
        if (!frame) throw new Error('No hay ninguna pantalla compartida. Pide que la compartan con el botón de la pantalla (solo en ordenador).');
        return { text: 'Captura de la pantalla compartida.', images: [frame] };
      },
    },
  ];
}

export function notebookTools(notebook, onChange = () => {}) {
  const author = (args, ctx) => String(args.autor || ctx.speaker);
  const changed = (result) => { onChange(); return result; };
  return [
    {
      name: 'cuaderno_registrar',
      description: 'Registra una hipótesis nueva en el cuaderno de investigación. Formúlala de modo que sea falsable.',
      parameters: obj({
        titulo: { type: 'string', description: 'Título breve.' },
        enunciado: { type: 'string', description: 'Hipótesis precisa y falsable.' },
        autor: { type: 'string', description: 'Quién la propone (por defecto, quien habla).' },
        confianza: { type: 'integer', description: 'Credibilidad inicial 0-100.' },
        etiquetas: { type: 'array', items: { type: 'string' } },
      }, ['titulo', 'enunciado']),
      run: (a, ctx) => {
        const h = notebook.add(a.titulo || '', a.enunciado || '', author(a, ctx), a.confianza ?? 50, (a.etiquetas || []).map(String));
        return changed(`Registrada ${h.id}: ${h.title}`);
      },
    },
    {
      name: 'cuaderno_evidencia',
      description: 'Añade una evidencia a favor, en contra o neutral a una hipótesis.',
      parameters: obj({
        id: HID,
        tipo: { type: 'string', enum: EVIDENCE_KINDS },
        descripcion: { type: 'string' },
        fuente: { type: 'string', description: 'Estudio, dato, observación o experimento.' },
        autor: { type: 'string' },
      }, ['id', 'tipo', 'descripcion']),
      run: (a, ctx) => {
        const h = notebook.addEvidence(a.id, a.tipo || 'neutral', a.descripcion || '', a.fuente || '', author(a, ctx));
        return changed(`Evidencia añadida a ${h.id}. ${Notebook.brief(h)}`);
      },
    },
    {
      name: 'cuaderno_prueba',
      description: 'Propone una prueba o experimento con una predicción concreta que pueda salir mal si la hipótesis es falsa.',
      parameters: obj({ id: HID, descripcion: { type: 'string' }, prediccion: { type: 'string' }, autor: { type: 'string' } },
        ['id', 'descripcion', 'prediccion']),
      run: (a, ctx) => {
        const h = notebook.addTest(a.id, a.descripcion || '', a.prediccion || '', author(a, ctx));
        return changed(`Prueba P${h.tests.length} propuesta para ${h.id}.`);
      },
    },
    {
      name: 'cuaderno_resultado',
      description: 'Anota el resultado observado de una prueba (P1, P2…) de una hipótesis.',
      parameters: obj({ id: HID, prueba: { type: 'integer', description: 'Número de la prueba.' }, resultado: { type: 'string' } },
        ['id', 'prueba', 'resultado']),
      run: (a) => {
        const h = notebook.recordResult(a.id, Number(a.prueba), a.resultado || '');
        return changed(`Resultado anotado en ${h.id} P${a.prueba}.`);
      },
    },
    {
      name: 'cuaderno_estado',
      description: 'Cambia el estado o la confianza de una hipótesis y deja una nota del porqué.',
      parameters: obj({ id: HID, estado: { type: 'string', enum: STATES }, confianza: { type: 'integer' }, nota: { type: 'string' } }, ['id']),
      run: (a) => {
        const h = notebook.updateState(a.id, a.estado || null, a.confianza, a.nota || '');
        return changed(`Actualizada. ${Notebook.brief(h)}`);
      },
    },
    {
      name: 'cuaderno_listar',
      description: 'Lista las hipótesis del cuaderno, opcionalmente filtradas por estado.',
      parameters: obj({ estado: { type: 'string', enum: STATES } }),
      run: (a) => {
        const items = notebook.all().filter((h) => !a.estado || h.state === a.estado);
        if (!items.length) return a.estado ? `No hay hipótesis en estado ${a.estado}.` : 'El cuaderno está vacío.';
        return items.map(Notebook.brief).join('\n');
      },
    },
    {
      name: 'cuaderno_ver',
      description: 'Muestra una hipótesis con todas sus evidencias, pruebas y notas.',
      parameters: obj({ id: HID }, ['id']),
      run: (a) => Notebook.detail(notebook.get(a.id)),
    },
  ];
}

export const calcTool = {
  name: 'calcular',
  description: 'Calculadora exacta para cuentas y estadística. Admite + - * / ^ %, funciones (sqrt, log, sin, exp, '
    + 'factorial, comb…) y media([..]), mediana, desv, varianza, correlacion([x],[y]). Úsala en vez de calcular de cabeza.',
  parameters: obj({ expresion: { type: 'string', description: "p. ej. 'media([3, 5, 8])'" } }, ['expresion']),
  run: (a) => {
    const expr = String(a.expresion || '');
    return `${expr} = ${format(evaluate(expr))}`;
  },
};

export function linkTool(show) {
  return {
    name: 'mostrar_enlace',
    description: 'Muestra en el chat un enlace a una web para que la persona lo abra con un toque.',
    parameters: obj({ titulo: { type: 'string' }, url: { type: 'string' } }, ['url']),
    run: (a) => {
      let url;
      try { url = new URL(/^https?:\/\//i.test(a.url) ? a.url : `https://${a.url}`); } catch { throw new Error('Esa dirección no es válida.'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo puedo mostrar enlaces web (http o https).');
      show(a.titulo || url.hostname, url.href);
      return `Enlace mostrado en el chat: ${url.href}`;
    },
  };
}
