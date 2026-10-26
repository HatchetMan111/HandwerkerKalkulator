import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFormula, FormulaError } from '../app/assets/engine.js';

test('Punkt-vor-Strich und Klammern', () => {
  assert.equal(evaluateFormula('2 + 3 * 4'), 14);
  assert.equal(evaluateFormula('(2 + 3) * 4'), 20);
});

test('deutsches Dezimalkomma', () => {
  assert.equal(evaluateFormula('2,5 * 4'), 10);
});

test('Funktionen und Variablen', () => {
  assert.equal(evaluateFormula('ceil(laenge / 2)', { laenge: 5 }), 3);
  assert.equal(evaluateFormula('max(a, b)', { a: 2, b: 7 }), 7);
});

test('Division durch null wird zur deutschen Fehlermeldung', () => {
  assert.throws(() => evaluateFormula('1 / 0'), (err) => err instanceof FormulaError && /null/.test(err.message));
});

test('unbekannte Variable wird gemeldet', () => {
  assert.throws(() => evaluateFormula('x + 1', {}), (err) => err instanceof FormulaError && /unbekannt/i.test(err.message));
});
