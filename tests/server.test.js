import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';

test('GET /api/health meldet ok', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-'));
  const server = createServer({ dataDir: dir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
  server.close();
  await rm(dir, { recursive: true, force: true });
});
