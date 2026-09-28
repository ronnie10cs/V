import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CalcError, evaluate, format } from '../../web/calculo.js';

test('cuentas y precedencia', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('2^10'), 1024);
  assert.equal(evaluate('-2 ** 2'), -4);
  assert.equal(evaluate('(1 + 2) * 3'), 9);
  assert.equal(evaluate('7 // 2 + 7 % 2'), 4);
  assert.equal(evaluate('3 > 2'), true);
});

test('funciones y estadística', () => {
  assert.equal(evaluate('media([2, 4, 9])'), 5);
  assert.equal(evaluate('mediana([5, 1, 3, 2])'), 2.5);
  assert.equal(format(evaluate('sqrt(2)')), '1.41421356237');
  assert.equal(evaluate('round(pi, 2)'), 3.14);
  assert.equal(evaluate('comb(5, 2)'), 10);
  assert.equal(evaluate('max([3, 9, 1])'), 9);
  assert.equal(format(evaluate('desv([2, 4, 4, 4, 5, 5, 7, 9])')), '2.1380899353');
  assert.equal(evaluate('correlacion([1, 2, 3], [2, 4, 6])'), 1);
});

test('rechaza lo que no es matemática', () => {
  for (const bad of ['alert(1)', 'constructor', 'constructor(1)', 'toString()', '__proto__', 'x.y', '2 +', '9^99999', 'factorial(500)', '[1,2', '"hola"', 'window']) {
    assert.throws(() => evaluate(bad), CalcError, bad);
  }
});
