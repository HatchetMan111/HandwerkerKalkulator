import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFormula, FormulaError, calculate } from '../app/assets/engine.js';

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

const pack = {
  id: 'test', name: 'Test', eingaben: [], faktoren: [], preise: { mwst: 19 },
  ressourcen: [
    { id: 'mat', label: 'Material', art: 'material', einheit: 'l', formel: 'flaeche / ergiebigkeit', preisProEinheit: 10 },
    { id: 'tr', label: 'Transport', art: 'transport', einheit: 'Fahrten', volumenFormel: 'volumen', gewichtFormel: 'gewicht', volumenProFahrt: 8, gewichtProFahrt: 12, preisProFahrt: 100 },
    { id: 'c', label: 'Mulde', art: 'container', einheit: 'Mulden', volumenFormel: 'volumen', volumenProContainer: 10, preisProContainer: 300 },
    { id: 'p', label: 'Paletten', art: 'palette', einheit: 'Paletten', stueckFormel: 'stueck', stueckProPalette: 200, preisProPalette: 50 },
    { id: 's', label: 'Säcke', art: 'sack', einheit: 'Säcke', gewichtFormel: 'kg', kgProSack: 25, preisProSack: 5 },
    { id: 'h', label: 'Stunden', art: 'stunden', einheit: 'h', formel: 'stunden', preisProEinheit: 40 },
    { id: 'f', label: 'Pauschale', art: 'pauschal', einheit: 'Pauschale', preisProEinheit: 20 },
  ],
};

test('Transport nimmt das Maximum aus Volumen und Gewicht', () => {
  const r = calculate(pack, { eingaben: { volumen: 20, gewicht: 30, kg: 60, stueck: 450, stunden: 1.1 }, faktoren: { ergiebigkeit: 10, flaeche: 50 }, preise: {} });
  const tr = r.positionen.find((p) => p.id === 'tr');
  assert.equal(tr.menge, 3);
});

test('Container, Palette, Sack und Stunden runden auf', () => {
  const r = calculate(pack, { eingaben: { volumen: 21, gewicht: 1, kg: 51, stueck: 401, stunden: 1.1 }, faktoren: { ergiebigkeit: 10, flaeche: 50 }, preise: {} });
  assert.equal(r.positionen.find((p) => p.id === 'c').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 'p').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 's').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 'h').menge, 1.25);
});

test('Mindestpreis, Marge und MwSt', () => {
  const minPack = { ...pack, preise: { mwst: 19, mindestpreis: 500 } };
  const r = calculate(minPack, { eingaben: { volumen: 0, gewicht: 0, kg: 0, stueck: 0, stunden: 0 }, faktoren: { ergiebigkeit: 10, flaeche: 0 }, preise: { marge: 10 } });
  assert.equal(r.summen.netto, 500);
  assert.equal(r.summen.mwst, 95);
  assert.equal(r.summen.gesamt, 595);
});

test('Division durch null in der Formel wird abgefangen', () => {
  assert.throws(() => calculate(pack, { eingaben: { volumen: 0, gewicht: 0, kg: 0, stueck: 0, stunden: 0 }, faktoren: { ergiebigkeit: 0, flaeche: 10 }, preise: {} }), /null/);
});
