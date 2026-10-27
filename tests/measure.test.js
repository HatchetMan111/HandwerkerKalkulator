import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rectangleArea, lShapeArea, triangleArea, polygonArea, parseSpokenMeasurement, convertArea, areaDecimals, roundArea } from '../app/assets/measure.js';

test('Flächen', () => {
  assert.equal(rectangleArea(5, 4), 20);
  assert.equal(lShapeArea(5, 4, 2, 1), 18);
  assert.equal(triangleArea(6, 3), 9);
});

test('Flächen in die Zieleinheit umrechnen', () => {
  assert.equal(convertArea(10000, 'm²'), 10000);
  assert.equal(convertArea(10000, 'ha'), 1);
  assert.equal(convertArea(2500, 'ha'), 0.25);
  assert.equal(convertArea(12, 'm2'), 12);
  assert.equal(convertArea(12, 'unbekannt'), null);
  assert.equal(roundArea(convertArea(50, 'ha'), 'ha'), 0.005);
  assert.equal(roundArea(convertArea(250, 'ha'), 'ha'), 0.025);
  assert.equal(roundArea(convertArea(40, 'ha'), 'ha'), 0.004);
  assert.equal(roundArea(convertArea(40, 'm²'), 'm²'), 40);
  assert.equal(areaDecimals('hektar'), 4);
  assert.equal(areaDecimals('qm'), 2);
  assert.equal(areaDecimals('unbekannt'), null);
});

test('GPS-Polygon (Näherung)', () => {
  const area = polygonArea([
    { lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0.001, lon: 0 },
  ]);
  assert.ok(Math.abs(area - 12364) < 500);
});

test('gesprochene Maße', () => {
  assert.deepEqual(parseSpokenMeasurement('zwölf Meter mal acht Meter'), { laenge: 12, breite: 8 });
  assert.deepEqual(parseSpokenMeasurement('zwei Komma fünf Meter tief'), { tiefe: 2.5 });
  assert.deepEqual(parseSpokenMeasurement('zwölf Quadratmeter'), { flaeche: 12 });
  assert.deepEqual(parseSpokenMeasurement('fünfundzwanzig Quadratmeter'), { flaeche: 25 });
});
