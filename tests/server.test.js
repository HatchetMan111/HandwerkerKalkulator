import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';

test('GET /api/health meldet ok', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-'));
  const server = createServer({ dataDir: dir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/trades liefert alle Packs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-trades-'));
  const server = createServer({ dataDir: dir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/trades`);
    const packs = await res.json();
    assert.ok(packs.length >= 3);
    assert.ok(packs.every((p) => p.id && p.name));
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
