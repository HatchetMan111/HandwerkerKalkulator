import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadPacks } from './trades.js';
import { createStore } from './store.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function createServer({ dataDir, appDir, tradesDir }) {
  const startedAt = Date.now();
  const store = createStore(dataDir);
  let ready;
  async function ensureReady() {
    ready ??= store.init();
    await ready;
  }

  async function jsonBody(req, limit = 5 * 1024 * 1024) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw Object.assign(new Error('Ungültiges JSON'), { status: 400 });
    }
  }

  function send(res, status, data) {
    res.writeHead(status, JSON_HEADERS);
    res.end(status === 204 ? undefined : JSON.stringify(data));
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') {
        send(res, 200, {
          ok: true,
          version: process.env.APP_VERSION || '1.0.0',
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          dataWritable: true,
        });
        return;
      }
      if (url.pathname === '/api/version') {
        send(res, 200, { version: process.env.APP_VERSION || '1.0.0', schema: 1 });
        return;
      }
      if (url.pathname === '/api/trades' && req.method === 'GET') {
        const packs = await loadPacks(tradesDir);
        send(res, 200, packs);
        return;
      }

      if (url.pathname === '/api/jobs') {
        await ensureReady();
        if (req.method === 'GET') {
          send(res, 200, await store.read('jobs', []));
          return;
        }
        if (req.method === 'POST') {
          const body = await jsonBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw Object.assign(new Error('Ungültige Job-Daten'), { status: 400 });
          }
          const now = new Date().toISOString();
          const job = {
            id: `job_${randomUUID()}`,
            status: 'entwurf',
            positionen: [],
            summen: {},
            fotos: [],
            createdAt: now,
            updatedAt: now,
            ...body,
          };
          const jobs = await store.read('jobs', []);
          jobs.push(job);
          await store.write('jobs', jobs);
          send(res, 201, job);
          return;
        }
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch) {
        await ensureReady();
        const jobs = await store.read('jobs', []);
        const idx = jobs.findIndex((job) => job.id === jobMatch[1]);
        if (idx === -1) {
          send(res, 404, { fehler: 'Vorgang nicht gefunden' });
          return;
        }
        if (req.method === 'GET') {
          send(res, 200, jobs[idx]);
          return;
        }
        if (req.method === 'PUT') {
          const body = await jsonBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw Object.assign(new Error('Ungültige Job-Daten'), { status: 400 });
          }
          const updated = {
            ...jobs[idx],
            ...body,
            id: jobs[idx].id,
            createdAt: jobs[idx].createdAt,
            updatedAt: new Date().toISOString(),
          };
          jobs[idx] = updated;
          await store.write('jobs', jobs);
          send(res, 200, updated);
          return;
        }
        if (req.method === 'DELETE') {
          jobs.splice(idx, 1);
          await store.write('jobs', jobs);
          send(res, 204);
          return;
        }
      }

      send(res, 404, { fehler: 'Nicht gefunden' });
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = err.status || 500;
      send(res, status, { fehler: status === 500 ? 'Interner Fehler' : err.message });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 8090);
  createServer({
    dataDir: process.env.DATA_DIR || '/var/lib/handwerker-kalkulator',
    appDir: path.resolve('app'),
    tradesDir: path.resolve('app/trades'),
  }).listen(port, '0.0.0.0', () => console.log(`Handwerker-Kalkulator läuft auf :${port}`));
}
