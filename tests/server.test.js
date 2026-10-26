import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';

async function startApi(dir) {
  const dataDir = dir || await mkdtemp(path.join(tmpdir(), 'hk-api-'));
  const opts = { dataDir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') };
  const server = createServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir: dataDir, opts, server, base: `http://127.0.0.1:${server.address().port}` };
}

const stop = (server) => new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));

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

test('Jobs CRUD', async () => {
  const api = await startApi();
  try {
    const created = await (await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: 'Test', gewerkId: 'maler', eingaben: { flaeche: 10 } }),
    })).json();
    assert.ok(created.id);
    assert.equal((await (await fetch(`${api.base}/api/jobs`)).json()).length, 1);
    await fetch(`${api.base}/api/jobs/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...created, titel: 'Neu' }),
    });
    assert.equal((await (await fetch(`${api.base}/api/jobs/${created.id}`)).json()).titel, 'Neu');
    assert.equal((await fetch(`${api.base}/api/jobs/${created.id}`, { method: 'DELETE' })).status, 204);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Jobs überleben einen Neustart', async () => {
  const first = await startApi();
  const created = await (await fetch(`${first.base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titel: 'Bleibt', gewerkId: 'maler' }),
  })).json();
  await stop(first.server);
  const second = await startApi(first.dir);
  try {
    const jobs = await (await fetch(`${second.base}/api/jobs`)).json();
    assert.equal(jobs[0].titel, 'Bleibt');
    assert.equal(jobs[0].id, created.id);
  } finally {
    await stop(second.server);
    await rm(first.dir, { recursive: true, force: true });
  }
});
