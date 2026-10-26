export class FormulaError extends Error {
  constructor(message, position = 0) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

const FUNCTIONS = {
  ceil: Math.ceil, floor: Math.floor, round: Math.round,
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt,
  pi: () => Math.PI,
};

function tokenize(input) {
  const src = String(input).replace(/(\d),(\d)/g, '$1.$2');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new FormulaError(`Ungültige Zahl: ${raw}`, i);
      tokens.push({ type: 'number', value: Number(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(ch)) { tokens.push({ type: ch }); i += 1; continue; }
    throw new FormulaError(`Unerwartetes Zeichen: ${ch}`, i);
  }
  return tokens;
}

export function evaluateFormula(expr, scope = {}) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (type) => {
    if (!peek() || peek().type !== type) throw new FormulaError(`Erwartet: ${type}`, pos);
    return tokens[pos++];
  };

  function parseExpression() {
    let value = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = tokens[pos++].type;
      const right = parseUnary();
      if (op === '/' && right === 0) throw new FormulaError('Division durch null ist nicht erlaubt.', pos);
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseUnary() {
    if (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      const value = parseUnary();
      return op === '-' ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new FormulaError('Formel ist unvollständig.', pos);
    if (token.type === 'number') { pos += 1; return token.value; }
    if (token.type === '(') { pos += 1; const value = parseExpression(); take(')'); return value; }
    if (token.type === 'ident') {
      pos += 1;
      const name = token.value;
      if (peek() && peek().type === '(') {
        const fn = FUNCTIONS[name];
        if (!fn) throw new FormulaError(`Unbekannte Funktion: ${name}`, pos);
        pos += 1;
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpression());
          while (peek() && peek().type === ',') { pos += 1; args.push(parseExpression()); }
        }
        take(')');
        return fn(...args);
      }
      if (!(name in scope)) throw new FormulaError(`Unbekannte Variable: ${name}`, pos);
      return scope[name];
    }
    throw new FormulaError(`Unerwartetes Zeichen: ${token.type}`, pos);
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new FormulaError('Unerwarteter Rest in der Formel.', pos);
  if (!Number.isFinite(result)) throw new FormulaError('Ergebnis ist keine gültige Zahl.', pos);
  return result;
}
