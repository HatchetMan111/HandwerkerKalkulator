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

test('Marge greift nur auf Material und Arbeit, Rabatt am Ende', () => {
  const geldPack = {
    id: 'geld', name: 'Geld', eingaben: [], faktoren: [], ressourcen: [
      { id: 'mat', label: 'Material', art: 'material', einheit: 'Stk', formel: 'menge', preisProEinheit: 100 },
    ],
    preise: { mwst: 19, anfahrt: { preisProKm: 1, hinUndZurueck: false } },
  };
  const basis = { eingaben: { menge: 1, anfahrtKm: 20 }, faktoren: {}, preise: { marge: 10 } };
  const r = calculate(geldPack, basis);
  assert.equal(r.summen.zwischensumme, 100);
  assert.equal(r.summen.anfahrt, 20);
  assert.equal(r.summen.marge, 10, '10 % Marge auf 100 € Material, nicht auf Anfahrt');
  assert.equal(r.summen.netto, 130);
  const r2 = calculate(geldPack, { ...basis, preise: { marge: 10, rabatt: 10 } });
  assert.equal(r2.summen.rabatt, 13);
  assert.equal(r2.summen.netto, 117);
  assert.equal(r2.summen.mwst, 22.23);
  assert.equal(r2.summen.gesamt, 139.23);
});

test('Overrides mit 0 als Ladegrenze erzeugen keine unendlichen Summen', () => {
  const nullPack = {
    id: 'null', name: 'Null', eingaben: [], faktoren: [], ressourcen: [
      { id: 'c', label: 'Mulde', art: 'container', einheit: 'Mulden', volumenFormel: 'volumen', volumenProContainer: 0, preisProContainer: 300 },
      { id: 's', label: 'Sack', art: 'sack', einheit: 'Säcke', gewichtFormel: 'kg', kgProSack: 0, preisProSack: 5 },
      { id: 'p', label: 'Palette', art: 'palette', einheit: 'Paletten', stueckFormel: 'stueck', stueckProPalette: 0, preisProPalette: 50 },
      { id: 't', label: 'Transport', art: 'transport', einheit: 'Fahrten', volumenFormel: 'volumen', volumenProFahrt: 0, preisProFahrt: 100 },
    ],
    preise: { mwst: 19 },
  };
  const r = calculate(nullPack, { eingaben: { volumen: 20, kg: 50, stueck: 100 }, faktoren: {}, preise: {} });
  assert.equal(r.summen.zwischensumme, 0);
  assert.ok(Number.isFinite(r.summen.gesamt));
  assert.ok(r.hinweise.length >= 4, 'jede nicht kalkulierbare Ressource meldet einen Hinweis');
});

test('Hinweise: Mindestpreis und weite Anfahrt', () => {
  const hinweisPack = {
    id: 'hinweis', name: 'Hinweis', eingaben: [], faktoren: [], ressourcen: [
      { id: 'pauschal', label: 'Pauschale', art: 'pauschal', einheit: 'Pauschale', preisProEinheit: 50 },
    ],
    preise: { mwst: 0, mindestpreis: 200, anfahrt: { preisProKm: 1, hinUndZurueck: false } },
  };
  const r = calculate(hinweisPack, { eingaben: { anfahrtKm: 60 }, faktoren: {}, preise: {} });
  assert.ok(r.summen.mindestpreis > 0);
  assert.ok(r.hinweise.some((h) => /Mindestpreis/.test(h)));
  assert.ok(r.hinweise.some((h) => /50 km/.test(h)));
});
