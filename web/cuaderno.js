// Cuaderno de hipótesis de V en la web: mismo formato que el de Python
// (v/notebook.py), guardado en el propio navegador.

export const STATES = ['propuesta', 'en_prueba', 'apoyada', 'refutada', 'descartada'];
export const EVIDENCE_KINDS = ['a_favor', 'en_contra', 'neutral'];
const STATE_LABELS = { propuesta: 'Propuesta', en_prueba: 'En prueba', apoyada: 'Apoyada', refutada: 'Refutada', descartada: 'Descartada' };

const now = () => new Date().toISOString().slice(0, 19);
const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

export class NotebookError extends Error {}

// `storage` es { load(): objeto | null, save(objeto) }: localStorage en la página, memoria en las pruebas.
export class Notebook {
  constructor(storage) {
    this.storage = storage;
    const data = storage.load() || {};
    this.counter = Number(data.counter) || 0;
    this.items = Array.isArray(data.hypotheses) ? data.hypotheses : [];
  }

  save() {
    this.storage.save({ counter: this.counter, hypotheses: this.items });
  }

  all() { return this.items; }

  get(id) {
    let key = String(id).trim().toUpperCase();
    if (!key.startsWith('H')) key = `H${key}`;
    const h = this.items.find((x) => x.id === key);
    if (!h) throw new NotebookError(`No existe la hipótesis ${id}.`);
    return h;
  }

  add(title, statement, author, confidence = 50, tags = []) {
    this.counter += 1;
    const h = {
      id: `H${this.counter}`, title: String(title).trim(), statement: String(statement).trim(), author,
      state: 'propuesta', confidence: clamp(confidence), tags, evidence: [], tests: [], notes: [],
      created: now(), updated: now(),
    };
    this.items.push(h);
    this.save();
    return h;
  }

  addEvidence(id, kind, description, source, author) {
    if (!EVIDENCE_KINDS.includes(kind)) throw new NotebookError(`Tipo de evidencia inválido: ${kind}. Usa ${EVIDENCE_KINDS.join(', ')}.`);
    const h = this.get(id);
    h.evidence.push({ kind, description: String(description).trim(), source: String(source || '').trim(), author, at: now() });
    return this.touch(h);
  }

  addTest(id, description, prediction, author) {
    const h = this.get(id);
    h.tests.push({ description: String(description).trim(), prediction: String(prediction).trim(), result: '', author, at: now() });
    if (h.state === 'propuesta') h.state = 'en_prueba';
    return this.touch(h);
  }

  recordResult(id, index, result) {
    const h = this.get(id);
    if (!(index >= 1 && index <= h.tests.length)) throw new NotebookError(`${h.id} no tiene la prueba P${index}.`);
    h.tests[index - 1].result = String(result).trim();
    return this.touch(h);
  }

  updateState(id, state, confidence, note) {
    if (state && !STATES.includes(state)) throw new NotebookError(`Estado inválido: ${state}. Usa ${STATES.join(', ')}.`);
    const h = this.get(id);
    if (state) h.state = state;
    if (confidence !== undefined && confidence !== null) h.confidence = clamp(confidence);
    if (note) h.notes.push(String(note).trim());
    return this.touch(h);
  }

  touch(h) {
    h.updated = now();
    this.save();
    return h;
  }

  static brief(h) {
    const pro = h.evidence.filter((e) => e.kind === 'a_favor').length;
    const con = h.evidence.filter((e) => e.kind === 'en_contra').length;
    return `${h.id} [${STATE_LABELS[h.state] || h.state}, ${h.confidence}%] ${h.title} — de ${h.author}; evidencias +${pro}/-${con}, pruebas ${h.tests.length}`;
  }

  static detail(h) {
    const lines = [Notebook.brief(h), `Enunciado: ${h.statement}`];
    if (h.tags?.length) lines.push(`Etiquetas: ${h.tags.join(', ')}`);
    h.evidence.forEach((e, i) => lines.push(`  E${i + 1} ${e.kind}: ${e.description}${e.source ? ` (fuente: ${e.source})` : ''} — ${e.author}`));
    h.tests.forEach((t, i) => lines.push(`  P${i + 1} ${t.description}. Predicción: ${t.prediction}${t.result ? ` → resultado: ${t.result}` : ' → pendiente'}`));
    h.notes.slice(-5).forEach((n) => lines.push(`  Nota: ${n}`));
    return lines.join('\n');
  }

  toMarkdown() {
    const lines = ['# Cuaderno de hipótesis de V', ''];
    if (!this.items.length) lines.push('_Todavía no hay hipótesis._');
    for (const h of this.items) {
      lines.push(
        `## ${h.id} · ${h.title}`,
        `**Estado:** ${STATE_LABELS[h.state] || h.state} · **Confianza:** ${h.confidence}% · **Autor:** ${h.author} · **Actualizada:** ${h.updated}`,
        '', `> ${h.statement}`, '',
      );
      if (h.evidence.length) {
        lines.push('**Evidencias**');
        for (const e of h.evidence) {
          const icon = { a_favor: '➕', en_contra: '➖' }[e.kind] || '•';
          lines.push(`- ${icon} ${e.description}${e.source ? ` _(fuente: ${e.source})_` : ''} — ${e.author}`);
        }
        lines.push('');
      }
      if (h.tests.length) {
        lines.push('**Pruebas**');
        h.tests.forEach((t, i) => lines.push(`${i + 1}. ${t.description} — _Predicción:_ ${t.prediction}${t.result ? ` — **Resultado:** ${t.result}` : ''}`));
        lines.push('');
      }
      if (h.notes.length) {
        lines.push('**Notas**', ...h.notes.map((n) => `- ${n}`), '');
      }
    }
    return lines.join('\n');
  }
}
