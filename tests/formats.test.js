import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatCurrency, parseGermanNumber } from '../app/assets/formats.js';

test('deutsche Zahlenformatierung', () => {
  assert.equal(formatNumber(1234.5), '1.234,50');
  assert.equal(formatNumber(0.25, 2), '0,25');
});

test('Währung', () => {
  assert.equal(formatCurrency(1234.5), '1.234,50 €');
});

test('deutsches Komma parsen', () => {
  assert.equal(parseGermanNumber('2,5'), 2.5);
  assert.equal(parseGermanNumber('1.234,50'), 1234.5);
  assert.equal(parseGermanNumber('abc'), null);
});
