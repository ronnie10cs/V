import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Notebook, NotebookError } from '../../web/cuaderno.js';

const memory = () => {
  let data = null;
  return { load: () => (data ? JSON.parse(data) : null), save: (d) => { data = JSON.stringify(d); } };
};

test('ciclo completo y persistencia', () => {
  const storage = memory();
  const nb = new Notebook(storage);
  const h = nb.add('Café y memoria', 'El café mejora el recuerdo', 'Ana', 60);
  assert.equal(h.id, 'H1');
  nb.addEvidence('h1', 'a_favor', 'Estudio con 40 personas', 'Revista X', 'Ana');
  nb.addTest('1', 'Test de dígitos', 'Con café, +1 dígito', 'Ronnie');
  nb.recordResult('H1', 1, 'Sin diferencia');
  nb.updateState('H1', 'refutada', 20, 'No se sostiene');

  const again = new Notebook(storage);
  const h1 = again.get('H1');
  assert.equal(h1.state, 'refutada');
  assert.equal(h1.confidence, 20);
  assert.equal(h1.tests[0].result, 'Sin diferencia');
  assert.match(again.toMarkdown(), /Café y memoria/);
  assert.match(Notebook.detail(h1), /E1 a_favor/);
  assert.equal(again.add('Otra', 'x', 'Ana').id, 'H2');
});

test('errores claros', () => {
  const nb = new Notebook(memory());
  nb.add('t', 's', 'a');
  assert.throws(() => nb.addEvidence('H1', 'quizas', 'x', '', 'a'), NotebookError);
  assert.throws(() => nb.get('H9'), /No existe/);
  assert.throws(() => nb.recordResult('H1', 3, 'x'), /P3/);
});
