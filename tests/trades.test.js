import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPacks, validatePack } from '../server/trades.js';

test('alle Packs sind schema-valide', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  assert.ok(packs.length >= 3);
  for (const pack of packs) {
    assert.deepEqual(validatePack(pack), [], `${pack.id}: ${validatePack(pack).join('; ')}`);
  }
});

test('Pflichtfelder werden geprüft', () => {
  const errors = validatePack({ id: 'X', name: '', eingaben: [], faktoren: [], ressourcen: [], preise: {} });
  assert.ok(errors.some((e) => /id/i.test(e)));
  assert.ok(errors.some((e) => /name/i.test(e)));
});

test('doppelte IDs und Wertebereiche werden gemeldet', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  const basis = packs.find((p) => p.id === 'erdbau');
  const doppelt = JSON.parse(JSON.stringify(basis));
  doppelt.faktoren.push({ ...doppelt.faktoren[0] });
  assert.ok(validatePack(doppelt).some((e) => /doppelt/.test(e)));
  const bereich = JSON.parse(JSON.stringify(basis));
  bereich.faktoren[0].standard = 999;
  assert.ok(validatePack(bereich).some((e) => /standard > max/.test(e)));
});

test('unbekannte Variablen und Null-Teiler werden gemeldet', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  const basis = packs.find((p) => p.id === 'erdbau');
  const variable = JSON.parse(JSON.stringify(basis));
  variable.ressourcen[0].formel = 'flaeche * unbekannt';
  assert.ok(validatePack(variable).some((e) => /unbekannt/i.test(e)));
  const teiler = JSON.parse(JSON.stringify(basis));
  teiler.ressourcen[1].volumenProFahrt = 0;
  assert.ok(validatePack(teiler).some((e) => /volumenProFahrt/.test(e)));
});

test('genau die 20 geplanten Gewerke sind vorhanden', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  const ids = packs.map((p) => p.id).sort();
  assert.deepEqual(ids, [
    '3ddruck', 'abbruch', 'baumfaellung', 'baustelle', 'beton', 'catering', 'dachdecker',
    'erdbau', 'event', 'fliesenleger', 'fotografie', 'garten', 'landwirtschaft', 'maler',
    'pflaster', 'reinigung', 'tiefbau', 'trockenbau', 'umzug', 'zaun',
  ]);
});
