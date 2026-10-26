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

const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

function resourceLine(resource, scope) {
  const preis = Number(resource.preisProEinheit ?? resource.preisProFahrt ?? resource.preisProContainer ?? resource.preisProPalette ?? resource.preisProSack ?? 0);
  if (resource.art === 'material') {
    const roh = evaluateFormula(resource.formel, scope);
    const menge = roundTo(roh, 2);
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${resource.formel} = ${menge} ${resource.einheit}` };
  }
  if (resource.art === 'transport') {
    const volumen = evaluateFormula(resource.volumenFormel, scope);
    const gewicht = resource.gewichtFormel ? evaluateFormula(resource.gewichtFormel, scope) : 0;
    const nachVolumen = resource.volumenProFahrt ? Math.ceil(volumen / resource.volumenProFahrt) : 0;
    const nachGewicht = resource.gewichtProFahrt ? Math.ceil(gewicht / resource.gewichtProFahrt) : 0;
    const menge = Math.max(nachVolumen, nachGewicht, volumen > 0 || gewicht > 0 ? 1 : 0);
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${volumen} m³ / ${gewicht} t → ${menge} Fahrten` };
  }
  if (resource.art === 'container') {
    const volumen = evaluateFormula(resource.volumenFormel, scope);
    const menge = volumen > 0 ? Math.ceil(volumen / resource.volumenProContainer) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${volumen} m³ / ${resource.volumenProContainer} m³ = ${menge} Mulden` };
  }
  if (resource.art === 'palette') {
    const stueck = evaluateFormula(resource.stueckFormel, scope);
    const menge = stueck > 0 ? Math.ceil(stueck / resource.stueckProPalette) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${stueck} Stk / ${resource.stueckProPalette} = ${menge} Paletten` };
  }
  if (resource.art === 'sack') {
    const kg = evaluateFormula(resource.gewichtFormel, scope);
    const menge = kg > 0 ? Math.ceil(kg / resource.kgProSack) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${kg} kg / ${resource.kgProSack} kg = ${menge} Säcke` };
  }
  if (resource.art === 'stunden') {
    const roh = evaluateFormula(resource.formel, scope);
    const menge = roh > 0 ? Math.ceil(roh * 4) / 4 : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${resource.formel} = ${menge} h (auf 0,25 h aufgerundet)` };
  }
  if (resource.art === 'pauschal') {
    return { ...resource, menge: 1, einzelpreis: preis, gesamt: roundTo(preis, 2), herleitung: 'Pauschale' };
  }
  throw new FormulaError(`Unbekannter Ressourcentyp: ${resource.art}`);
}

export function calculate(pack, state = {}) {
  const scope = { ...state.eingaben, ...state.faktoren };
  for (const input of pack.eingaben || []) {
    if (!(input.id in scope)) scope[input.id] = input.standard ?? 0;
  }
  for (const factor of pack.faktoren || []) {
    if (!(factor.id in scope)) scope[factor.id] = factor.standard ?? 0;
  }
  const positionen = (pack.ressourcen || []).map((r) => resourceLine(r, scope));
  const zwischensumme = roundTo(positionen.reduce((sum, p) => sum + p.gesamt, 0), 2);
  const preise = { ...(pack.preise || {}), ...(state.preise || {}) };
  const km = Number(state.eingaben?.anfahrtKm ?? 0);
  const anfahrt = preise.anfahrt ? roundTo(km * Number(preise.anfahrt.preisProKm || 0) * (preise.anfahrt.hinUndZurueck ? 2 : 1), 2) : roundTo(Number(preise.anfahrtPauschal || 0), 2);
  const margeSatz = Number(preise.marge || 0);
  const marge = roundTo((zwischensumme + anfahrt) * margeSatz / 100, 2);
  let netto = roundTo(zwischensumme + anfahrt + marge, 2);
  let mindestpreis = 0;
  if (preise.mindestpreis && netto < preise.mindestpreis) {
    mindestpreis = roundTo(preise.mindestpreis - netto, 2);
    positionen.push({ id: 'mindestpreis', label: 'Mindestpreis', menge: 1, einheit: 'Pauschale', einzelpreis: mindestpreis, gesamt: mindestpreis, herleitung: 'Auf Mindestpreis aufgerundet' });
    netto = roundTo(preise.mindestpreis, 2);
  }
  const mwstSatz = Number(preise.mwst ?? 19);
  const mwst = roundTo(netto * mwstSatz / 100, 2);
  const gesamt = roundTo(netto + mwst, 2);
  return {
    positionen,
    summen: { zwischensumme, anfahrt, marge, mindestpreis, netto, mwst, gesamt, mwstSatz },
    hinweise: [],
  };
}
