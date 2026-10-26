import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

test('write und read persistieren JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-store-'));
  const store = createStore(dir);
  await store.init();
  await store.write('jobs', [{ id: 'a' }]);
  assert.deepEqual(await store.read('jobs', []), [{ id: 'a' }]);
  assert.ok((await readdir(dir)).includes('jobs.json'));
  await rm(dir, { recursive: true, force: true });
});

test('konkurrierende Writes bleiben vollständig', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-store-'));
  const store = createStore(dir);
  await store.init();
  await Promise.all([store.write('x', { n: 1 }), store.write('x', { n: 2 })]);
  assert.deepEqual(await store.read('x', null), { n: 2 });
  await rm(dir, { recursive: true, force: true });
});

test('read liefert Fallback bei fehlender Datei', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-store-'));
  const store = createStore(dir);
  await store.init();
  assert.deepEqual(await store.read('fehlt', { leer: true }), { leer: true });
  await rm(dir, { recursive: true, force: true });
});

test('settings startet als Objekt', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-store-'));
  const store = createStore(dir);
  await store.init();
  assert.deepEqual(await store.read('settings', {}), {});
  await rm(dir, { recursive: true, force: true });
});
