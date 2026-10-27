import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('GET /api/health meldet 503, wenn das Datenverzeichnis nicht nutzbar ist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-bad-health-'));
  const dataFile = path.join(dir, 'kein-verzeichnis');
  await writeFile(dataFile, 'blockiert');
  const server = createServer({ dataDir: dataFile, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.dataWritable, false);
    await rm(dataFile, { force: true });
    const retry = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).dataWritable, true);
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

test('Einstellungen und Preislisten werden persistiert', async () => {
  const api = await startApi();
  try {
    const settings = { firmenname: 'Muster GmbH', standardMwst: 19 };
    await fetch(`${api.base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    assert.equal((await (await fetch(`${api.base}/api/settings`)).json()).firmenname, 'Muster GmbH');
    await fetch(`${api.base}/api/pricelists`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ id: 'pl_1', name: 'Standard', positionen: [] }]) });
    assert.equal((await (await fetch(`${api.base}/api/pricelists`)).json())[0].name, 'Standard');
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Nummernkreis zählt hoch', async () => {
  const api = await startApi();
  try {
    const a = await (await fetch(`${api.base}/api/nummern/angebot`, { method: 'POST' })).json();
    const b = await (await fetch(`${api.base}/api/nummern/angebot`, { method: 'POST' })).json();
    assert.equal(b.zaehler, a.zaehler + 1);
    assert.match(b.nummer, /^A-\d{4}-\d{4}$/);
    assert.equal((await fetch(`${api.base}/api/nummern/unfug`, { method: 'POST' })).status, 400);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('defekter Import überschreibt keine Daten', async () => {
  const api = await startApi();
  try {
    await fetch(`${api.base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: 'Bestand', gewerkId: 'maler' }) });
    const before = await (await fetch(`${api.base}/api/jobs`)).json();
    const res = await fetch(`${api.base}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modus: 'ersetzen', bundle: { jobs: 'kaputt' } }) });
    assert.equal(res.status, 400);
    assert.equal((await (await fetch(`${api.base}/api/jobs`)).json()).length, before.length);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Export und Import Roundtrip', async () => {
  const first = await startApi();
  const second = await startApi();
  try {
    await fetch(`${first.base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firmenname: 'Roundtrip GmbH' }) });
    await fetch(`${first.base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: 'Exportiert', gewerkId: 'maler' }) });
    const bundle = await (await fetch(`${first.base}/api/export`)).json();
    const res = await fetch(`${second.base}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modus: 'ersetzen', bundle }) });
    assert.equal(res.status, 200);
    assert.equal((await (await fetch(`${second.base}/api/settings`)).json()).firmenname, 'Roundtrip GmbH');
    assert.equal((await (await fetch(`${second.base}/api/jobs`)).json())[0].titel, 'Exportiert');
  } finally {
    await stop(first.server);
    await stop(second.server);
    await rm(first.dir, { recursive: true, force: true });
    await rm(second.dir, { recursive: true, force: true });
  }
});

test('negative Eingaben werden serverseitig abgewiesen', async () => {
  const api = await startApi();
  try {
    const res = await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: 'Negativ', gewerkId: 'maler', eingaben: { flaeche: -5 } }),
    });
    assert.equal(res.status, 400);
    assert.equal((await (await fetch(`${api.base}/api/jobs`)).json()).length, 0);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('POST /api/jobs ignoriert serververwaltete Felder', async () => {
  const api = await startApi();
  try {
    const res = await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'job_manipuliert', status: 'rechnung', createdAt: '2000-01-01', updatedAt: '2000-01-01',
        fotos: [{ datei: 'fremd.jpg' }], titel: 'Sauber', gewerkId: 'maler',
      }),
    });
    assert.equal(res.status, 201);
    const job = await res.json();
    assert.notEqual(job.id, 'job_manipuliert');
    assert.equal(job.status, 'entwurf');
    assert.notEqual(job.createdAt, '2000-01-01');
    assert.deepEqual(job.fotos, []);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('API-Schreibzugriffe verlangen JSON und gleiche Origin', async () => {
  const api = await startApi();
  try {
    const plain = await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ titel: 'CSRF' }),
    });
    assert.equal(plain.status, 415);
    const cross = await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://boese.example' },
      body: JSON.stringify({ titel: 'CSRF' }),
    });
    assert.equal(cross.status, 403);
    assert.equal((await (await fetch(`${api.base}/api/jobs`)).json()).length, 0);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Foto-Upload dedupliziert gleiche Bilder und die Liste enthält keine Fotos', async () => {
  const api = await startApi();
  const bild = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';
  try {
    const job = await (await fetch(`${api.base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: 'Foto', gewerkId: 'maler' }),
    })).json();
    const first = await fetch(`${api.base}/api/jobs/${job.id}/fotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: bild, name: 'baustelle.png' }),
    });
    assert.equal(first.status, 201);
    const second = await fetch(`${api.base}/api/jobs/${job.id}/fotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: bild, name: 'baustelle.png' }),
    });
    assert.equal(second.status, 200);
    const duplicate = await second.json();
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.fotos.length, 1);
    const updated = await (await fetch(`${api.base}/api/jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'job_manipuliert', fotos: [], titel: 'Neu' }),
    })).json();
    assert.equal(updated.id, job.id);
    assert.equal(updated.fotos.length, 1);
    await rm(path.join(api.dir, 'fotos', job.id), { recursive: true, force: true });
    const third = await fetch(`${api.base}/api/jobs/${job.id}/fotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: bild, name: 'wiederhergestellt.png' }),
    });
    assert.equal(third.status, 201);
    const restored = await third.json();
    assert.equal(restored.job.fotos.length, 1);
    assert.equal((await fetch(`${api.base}${restored.foto.url}`)).status, 200);
    const list = await (await fetch(`${api.base}/api/jobs`)).json();
    assert.equal('fotos' in list[0], false);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('defekte Foto-Adresse liefert 400 statt 500', async () => {
  const api = await startApi();
  try {
    const res = await fetch(`${api.base}/api/fotos/%E0%A4%A/%E0%A4%A`);
    assert.equal(res.status, 400);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Import weist negative Job-Werte und doppelte Fotos ab', async () => {
  const api = await startApi();
  try {
    const job = { id: 'job_import', titel: 'Import', gewerkId: 'maler', eingaben: { flaeche: -1 } };
    const negative = await fetch(`${api.base}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modus: 'ersetzen', bundle: { jobs: [job], presets: [], pricelists: [], settings: {} } }),
    });
    assert.equal(negative.status, 400);
    const partialMeta = await fetch(`${api.base}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modus: 'ersetzen',
        bundle: { jobs: [], presets: [], pricelists: [], settings: {}, meta: { schema: 1, nummern: { angebot: 5 } } },
      }),
    });
    assert.equal(partialMeta.status, 400);
    const tooMany = await fetch(`${api.base}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modus: 'ersetzen',
        bundle: {
          jobs: [{ id: 'job_import', titel: 'Import', gewerkId: 'maler', fotos: Array.from({ length: 7 }, (_, i) => ({ datei: `f${i}.jpg` })) }],
          presets: [], pricelists: [], settings: {},
        },
      }),
    });
    assert.equal(tooMany.status, 400);
    const duplicate = await fetch(`${api.base}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modus: 'ersetzen',
        bundle: {
          jobs: [{ id: 'job_import', titel: 'Import', gewerkId: 'maler', fotos: [{ datei: 'a.jpg' }, { datei: 'a.jpg' }] }],
          presets: [], pricelists: [], settings: {},
        },
      }),
    });
    assert.equal(duplicate.status, 400);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Import erhält den Nummernstand', async () => {
  const first = await startApi();
  const second = await startApi();
  try {
    await fetch(`${first.base}/api/nummern/angebot`, { method: 'POST' });
    const bundle = await (await fetch(`${first.base}/api/export`)).json();
    assert.equal(bundle.meta.nummern.angebot, 2);
    await fetch(`${second.base}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modus: 'ersetzen', bundle }),
    });
    const next = await (await fetch(`${second.base}/api/nummern/angebot`, { method: 'POST' })).json();
    assert.equal(next.zaehler, 2);
  } finally {
    await stop(first.server);
    await stop(second.server);
    await rm(first.dir, { recursive: true, force: true });
    await rm(second.dir, { recursive: true, force: true });
  }
});

test('GET / liefert die App-Shell und blockt Traversal', async () => {
  const api = await startApi();
  try {
    const res = await fetch(`${api.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<main id="app">/);
    assert.equal((await fetch(`${api.base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${api.base}/..%2fpackage.json`)).status, 403);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});
