// Calculadora exacta y segura para V en la web (equivalente a `calcular` en Python).
// Analiza la expresión a mano: nunca usa eval().

export class CalcError extends Error {}

const mean = (xs) => nums(xs).reduce((a, b) => a + b, 0) / need(xs, 1).length;
const variance = (xs) => {
  const m = mean(need(xs, 2));
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};
const pvariance = (xs) => {
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
};
const median = (xs) => {
  const s = [...nums(need(xs, 1))].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mode = (xs) => {
  const counts = new Map();
  for (const x of need(xs, 1)) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};
const correlation = (xs, ys) => {
  if (!Array.isArray(ys) || xs.length !== ys.length) throw new CalcError('correlacion necesita dos listas del mismo tamaño.');
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxy / Math.sqrt(sxx * syy);
};
const factorial = (n) => {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('factorial necesita un entero no negativo.');
  if (n > 170) throw new CalcError('factorial demasiado grande (máximo 170).');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
const comb = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
};

function nums(xs) {
  if (!Array.isArray(xs) || xs.some((x) => typeof x !== 'number')) throw new CalcError('Se esperaba una lista de números, p. ej. [1, 2, 3].');
  return xs;
}
function need(xs, n) {
  if (nums(xs).length < n) throw new CalcError(`Se necesitan al menos ${n} datos.`);
  return xs;
}

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, log10: Math.log10, log2: Math.log2,
  log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)),
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, hypot: Math.hypot,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, pow: Math.pow,
  round: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n,
  degrees: (x) => (x * 180) / Math.PI, radians: (x) => (x * Math.PI) / 180,
  min: (...a) => Math.min(...(Array.isArray(a[0]) ? a[0] : a)),
  max: (...a) => Math.max(...(Array.isArray(a[0]) ? a[0] : a)),
  sum: (xs) => nums(xs).reduce((a, b) => a + b, 0), len: (xs) => nums(xs).length,
  factorial, comb, perm: (n, k) => factorial(n) / factorial(n - k),
  media: mean, mean, mediana: median, median, moda: mode, mode,
  desv: (xs) => Math.sqrt(variance(xs)), stdev: (xs) => Math.sqrt(variance(xs)),
  pstdev: (xs) => Math.sqrt(pvariance(xs)), varianza: variance, variance,
  correlacion: correlation, correlation,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity };

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-zÁÉÍÓÚáéíóúñ_][\wÁÉÍÓÚáéíóúñ]*)|(\*\*|\/\/|<=|>=|==|!=|[-+*/%^(),[\]<>]))/y;
  let pos = 0;
  while (src.slice(pos).trim() !== '') {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new CalcError(`No entiendo «${src.slice(pos).trim().slice(0, 12)}».`);
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'name', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

export function evaluate(src) {
  if (String(src).length > 500) throw new CalcError('Expresión demasiado larga.');
  const tokens = tokenize(String(src));
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
  const expect = (op) => {
    if (!isOp(op)) throw new CalcError(`Falta «${op}».`);
    i++;
  };

  const expr = () => compare();
  const compare = () => {
    const left = add();
    if (isOp('<', '<=', '>', '>=', '==', '!=')) {
      const op = tokens[i++].v;
      const right = add();
      return { '<': left < right, '<=': left <= right, '>': left > right, '>=': left >= right, '==': left === right, '!=': left !== right }[op];
    }
    return left;
  };
  const add = () => {
    let v = mul();
    while (isOp('+', '-')) v = tokens[i++].v === '+' ? v + mul() : v - mul();
    return v;
  };
  const mul = () => {
    let v = unary();
    while (isOp('*', '/', '%', '//')) {
      const op = tokens[i++].v;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : op === '%' ? v % r : Math.floor(v / r);
    }
    return v;
  };
  const unary = () => {
    if (isOp('-')) { i++; return -unary(); }
    if (isOp('+')) { i++; return unary(); }
    return power();
  };
  const power = () => {
    const base = atom();
    if (isOp('^', '**')) {
      i++;
      const exp = unary();
      if (Math.abs(exp) > 1000) throw new CalcError('Exponente demasiado grande.');
      return base ** exp;
    }
    return base;
  };
  const atom = () => {
    const tok = peek();
    if (!tok) throw new CalcError('La expresión está incompleta.');
    if (tok.t === 'num') { i++; return tok.v; }
    if (isOp('(')) { i++; const v = expr(); expect(')'); return v; }
    if (isOp('[')) {
      i++;
      const items = [];
      if (!isOp(']')) {
        items.push(expr());
        while (isOp(',')) { i++; items.push(expr()); }
      }
      expect(']');
      return items;
    }
    if (tok.t === 'name') {
      i++;
      const name = tok.v.toLowerCase();
      if (isOp('(')) {
        i++;
        const fn = Object.hasOwn(FUNCS, name) ? FUNCS[name] : null;
        if (!fn) throw new CalcError(`Función desconocida: ${tok.v}.`);
        const args = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) { i++; args.push(expr()); }
        }
        expect(')');
        return fn(...args);
      }
      if (Object.hasOwn(CONSTS, name)) return CONSTS[name];
      throw new CalcError(`Nombre desconocido: ${tok.v}.`);
    }
    throw new CalcError(`No esperaba «${tok.v}».`);
  };

  const value = expr();
  if (i < tokens.length) throw new CalcError(`Sobra «${tokens[i].v}».`);
  return value;
}

export function format(value) {
  if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'verdadero' : 'falso';
  if (typeof value !== 'number') return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}
