import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rectangleArea, lShapeArea, triangleArea, polygonArea, parseSpokenMeasurement } from '../app/assets/measure.js';

test('Flächen', () => {
  assert.equal(rectangleArea(5, 4), 20);
  assert.equal(lShapeArea(5, 4, 2, 1), 18);
  assert.equal(triangleArea(6, 3), 9);
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
