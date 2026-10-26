import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadPacks } from './trades.js';
import { createStore } from './store.js';
import { naechsteNummer } from './numbering.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

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

  const appRoot = path.resolve(appDir);

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Methode nicht erlaubt');
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ungültige Adresse');
      return;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Verboten');
      return;
    }
    const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const target = path.resolve(appRoot, rel);
    if (target !== appRoot && !target.startsWith(appRoot + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Verboten');
      return;
    }
    try {
      const data = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeById(existing, incoming) {
    const result = [...existing];
    for (const item of incoming) {
      const idx = item.id ? result.findIndex((entry) => entry.id === item.id) : -1;
      if (idx >= 0) result[idx] = { ...result[idx], ...item };
      else result.push(item);
    }
    return result;
  }

  function validateBundle(bundle) {
    if (!isPlainObject(bundle)) {
      throw Object.assign(new Error('Bundle muss ein Objekt sein'), { status: 400 });
    }
    const arrays = ['jobs', 'presets', 'pricelists'];
    for (const key of arrays) {
      if (!Array.isArray(bundle[key])) {
        throw Object.assign(new Error(`Bundle: ${key} muss ein Array sein`), { status: 400 });
      }
      if (!bundle[key].every(isPlainObject)) {
        throw Object.assign(new Error(`Bundle: ${key} enthält ungültige Einträge`), { status: 400 });
      }
    }
    if (!isPlainObject(bundle.settings)) {
      throw Object.assign(new Error('Bundle: settings muss ein Objekt sein'), { status: 400 });
    }
    return { jobs: bundle.jobs, presets: bundle.presets, pricelists: bundle.pricelists, settings: bundle.settings };
  }

  let nummernQueue = Promise.resolve();
  function reserviereNummer(art) {
    const run = async () => {
      const meta = await store.read('meta', { schema: 1, nummern: { angebot: 1, rechnung: 1 } });
      const result = naechsteNummer(meta, art);
      await store.write('meta', result.meta);
      return { nummer: result.nummer, jahr: result.jahr, zaehler: result.zaehler };
    };
    nummernQueue = nummernQueue.then(run, run);
    return nummernQueue;
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

      const collection = url.pathname.match(/^\/api\/(presets|pricelists|settings)$/);
      if (collection) {
        await ensureReady();
        const name = collection[1];
        if (req.method === 'GET') {
          send(res, 200, await store.read(name, name === 'settings' ? {} : []));
          return;
        }
        if (req.method === 'PUT') {
          const body = await jsonBody(req);
          if (name === 'settings') {
            if (!isPlainObject(body)) {
              throw Object.assign(new Error('Einstellungen müssen ein Objekt sein'), { status: 400 });
            }
          } else if (!Array.isArray(body)) {
            throw Object.assign(new Error(`${name} muss ein Array sein`), { status: 400 });
          }
          await store.write(name, body);
          send(res, 200, body);
          return;
        }
      }

      const nummerMatch = url.pathname.match(/^\/api\/nummern\/([^/]+)$/);
      if (nummerMatch) {
        await ensureReady();
        if (req.method !== 'POST') {
          send(res, 405, { fehler: 'Methode nicht erlaubt' });
          return;
        }
        const art = decodeURIComponent(nummerMatch[1]);
        if (art !== 'angebot' && art !== 'rechnung') {
          send(res, 400, { fehler: 'Unbekannte Nummernart', feld: 'art' });
          return;
        }
        send(res, 200, await reserviereNummer(art));
        return;
      }

      if (url.pathname === '/api/export' && req.method === 'GET') {
        await ensureReady();
        const [jobs, presets, pricelists, settings] = await Promise.all([
          store.read('jobs', []),
          store.read('presets', []),
          store.read('pricelists', []),
          store.read('settings', {}),
        ]);
        send(res, 200, {
          schema: 1,
          exportiertAm: new Date().toISOString(),
          jobs,
          presets,
          pricelists,
          settings,
        });
        return;
      }

      if (url.pathname === '/api/import' && req.method === 'POST') {
        await ensureReady();
        const body = await jsonBody(req);
        if (!isPlainObject(body)) {
          throw Object.assign(new Error('Import muss ein Objekt sein'), { status: 400 });
        }
        const { modus, bundle } = body;
        if (modus !== 'merge' && modus !== 'ersetzen') {
          throw Object.assign(new Error('Unbekannter Importmodus'), { status: 400, feld: 'modus' });
        }
        const valid = validateBundle(bundle);
        if (modus === 'ersetzen') {
          await Promise.all([
            store.write('jobs', valid.jobs),
            store.write('presets', valid.presets),
            store.write('pricelists', valid.pricelists),
            store.write('settings', valid.settings),
          ]);
        } else {
          const [jobs, presets, pricelists, settings] = await Promise.all([
            store.read('jobs', []),
            store.read('presets', []),
            store.read('pricelists', []),
            store.read('settings', {}),
          ]);
          await Promise.all([
            store.write('jobs', mergeById(jobs, valid.jobs)),
            store.write('presets', mergeById(presets, valid.presets)),
            store.write('pricelists', mergeById(pricelists, valid.pricelists)),
            store.write('settings', { ...settings, ...valid.settings }),
          ]);
        }
        send(res, 200, { ok: true, modus });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        send(res, 404, { fehler: 'Nicht gefunden' });
        return;
      }
      await serveStatic(req, res, url.pathname);
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
