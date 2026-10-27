import http from 'node:http';
import path from 'node:path';
import { constants } from 'node:fs';
import { readFile, writeFile, unlink, mkdir, rm, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const DEFAULT_META = { schema: 1, nummern: { angebot: 1, rechnung: 1 } };
const JOB_STATUS = new Set(['entwurf', 'angebot', 'auftrag', 'auftragsbestaetigung', 'rechnung', 'abgeschlossen', 'bezahlt', 'storniert']);

export function createServer({ dataDir, appDir, tradesDir }) {
  const startedAt = Date.now();
  const store = createStore(dataDir);
  const fotosRoot = path.resolve(dataDir, 'fotos');
  const isSafeSegment = (value) => /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..';
  let ready;
  let packsPromise;
  async function ensureReady() {
    try {
      ready ??= store.init();
      await ready;
    } catch (err) {
      ready = undefined;
      throw err;
    }
  }

  async function jsonBody(req, limit = 5 * 1024 * 1024) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      throw Object.assign(new Error('Content-Type muss application/json sein'), { status: 415 });
    }
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

  function badRequest(message, feld = undefined, status = 400) {
    throw Object.assign(new Error(message), { status, ...(feld ? { feld } : {}) });
  }

  function assertSameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      badRequest('Cross-Site-Anfrage abgewiesen', undefined, 403);
    }
    const origin = req.headers.origin;
    if (!origin) return;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      badRequest('Ungültige Origin', undefined, 403);
    }
    if (!req.headers.host || parsed.host.toLowerCase() !== req.headers.host.toLowerCase() || !['http:', 'https:'].includes(parsed.protocol)) {
      badRequest('Cross-Origin-Anfrage abgewiesen', undefined, 403);
    }
  }

  function validateNumericScopes(job) {
    for (const scope of ['eingaben', 'faktoren', 'preise']) {
      if (job[scope] === undefined) continue;
      if (!isPlainObject(job[scope])) badRequest(`${scope} muss ein Objekt sein`, scope);
      for (const [key, value] of Object.entries(job[scope])) {
        if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
          badRequest(`${scope}.${key} darf nicht negativ sein`, `${scope}.${key}`);
        }
      }
    }
  }

  function validateJob(job) {
    if (!isPlainObject(job)) badRequest('Ungültige Job-Daten');
    if (job.id !== undefined && (typeof job.id !== 'string' || !isSafeSegment(job.id))) {
      badRequest('Ungültige Vorgangs-ID', 'id');
    }
    if (job.status !== undefined && (typeof job.status !== 'string' || !JOB_STATUS.has(job.status))) {
      badRequest('Unbekannter Status', 'status');
    }
    for (const key of ['titel', 'gewerkId', 'gewerkName', 'notizen', 'nummer', 'angebotNummer', 'rechnungNummer']) {
      if (job[key] !== undefined && typeof job[key] !== 'string') badRequest(`${key} muss Text sein`, key);
    }
    if (job.positionen !== undefined && !Array.isArray(job.positionen)) badRequest('Positionen müssen ein Array sein', 'positionen');
    if (job.summen !== undefined && !isPlainObject(job.summen)) badRequest('Summen müssen ein Objekt sein', 'summen');
    if (job.kunde !== undefined && !isPlainObject(job.kunde)) badRequest('Kunde muss ein Objekt sein', 'kunde');
    if (job.baustelle !== undefined && !isPlainObject(job.baustelle)) badRequest('Baustelle muss ein Objekt sein', 'baustelle');
    validateNumericScopes(job);
    if (job.fotos !== undefined) {
      if (!Array.isArray(job.fotos)) badRequest('Fotos müssen ein Array sein', 'fotos');
      const dateien = new Set();
      for (const foto of job.fotos) {
        if (!isPlainObject(foto) || typeof foto.datei !== 'string' || !isSafeSegment(foto.datei)) {
          badRequest('Ungültiger Foto-Eintrag', 'fotos');
        }
        if (dateien.has(foto.datei)) badRequest('Doppelte Foto-Einträge', 'fotos');
        dateien.add(foto.datei);
      }
      if (dateien.size > 6) badRequest('Es sind höchstens 6 Fotos je Vorgang erlaubt', 'fotos');
    }
    return job;
  }

  function validatePreset(preset) {
    if (!isPlainObject(preset)) badRequest('Ungültige Vorlage');
    if (preset.id !== undefined && (typeof preset.id !== 'string' || !isSafeSegment(preset.id))) badRequest('Ungültige Vorlagen-ID', 'id');
    if (preset.name !== undefined && typeof preset.name !== 'string') badRequest('Vorlagenname muss Text sein', 'name');
    if (preset.werte !== undefined && !isPlainObject(preset.werte)) badRequest('Vorlagenwerte müssen ein Objekt sein', 'werte');
    return preset;
  }

  function validatePricelist(pricelist) {
    if (!isPlainObject(pricelist)) badRequest('Ungültige Preisliste');
    if (pricelist.id !== undefined && (typeof pricelist.id !== 'string' || !isSafeSegment(pricelist.id))) badRequest('Ungültige Preislisten-ID', 'id');
    if (pricelist.positionen !== undefined && !Array.isArray(pricelist.positionen)) badRequest('Preislistenpositionen müssen ein Array sein', 'positionen');
    return pricelist;
  }

  function validateSettings(settings) {
    if (!isPlainObject(settings)) badRequest('Einstellungen müssen ein Objekt sein', 'settings');
    if (settings.standardMwst !== undefined && (!Number.isFinite(Number(settings.standardMwst)) || Number(settings.standardMwst) < 0 || Number(settings.standardMwst) > 100)) {
      badRequest('Standard-MwSt. muss zwischen 0 und 100 liegen', 'settings.standardMwst');
    }
    if (settings.dezimalstellen !== undefined) {
      const decimals = Number(settings.dezimalstellen);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) badRequest('Dezimalstellen müssen 0 bis 4 sein', 'settings.dezimalstellen');
    }
    if (settings.zahlungszielTage !== undefined && (!Number.isFinite(Number(settings.zahlungszielTage)) || Number(settings.zahlungszielTage) < 0)) {
      badRequest('Zahlungsziel darf nicht negativ sein', 'settings.zahlungszielTage');
    }
    return settings;
  }

  function validateMeta(meta) {
    if (!isPlainObject(meta)) badRequest('Meta muss ein Objekt sein', 'meta');
    if (meta.nummern !== undefined) {
      if (!isPlainObject(meta.nummern)) badRequest('Nummern müssen ein Objekt sein', 'meta.nummern');
      if (!Number.isInteger(meta.nummern.angebot) || meta.nummern.angebot < 1
        || !Number.isInteger(meta.nummern.rechnung) || meta.nummern.rechnung < 1) {
        badRequest('Nummernstände für Angebot und Rechnung erforderlich', 'meta.nummern');
      }
      for (const [key, value] of Object.entries(meta.nummern)) {
        if (!['angebot', 'rechnung'].includes(key) || !Number.isInteger(value) || value < 1) {
          badRequest('Ungültiger Nummernzähler', 'meta.nummern');
        }
      }
    }
    return meta;
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
    bundle.jobs.forEach(validateJob);
    bundle.presets.forEach(validatePreset);
    bundle.pricelists.forEach(validatePricelist);
    validateSettings(bundle.settings);
    if (bundle.meta !== undefined) validateMeta(bundle.meta);
    return {
      jobs: bundle.jobs,
      presets: bundle.presets,
      pricelists: bundle.pricelists,
      settings: bundle.settings,
      meta: bundle.meta,
    };
  }

  function reserviereNummer(art) {
    return (async () => {
      const settings = await store.read('settings', {});
      const praefix = art === 'rechnung' ? settings.rechnungsPrefix : settings.angebotsPrefix;
      let result;
      await store.mutate('meta', DEFAULT_META, (meta) => {
        result = naechsteNummer(meta, art, praefix);
        return result.meta;
      });
      return { nummer: result.nummer, jahr: result.jahr, zaehler: result.zaehler };
    })();
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method || 'GET')) {
        assertSameOrigin(req);
      }
      if (url.pathname === '/api/health') {
        let dataWritable = true;
        let fehler;
        try {
          await ensureReady();
          await access(dataDir, constants.W_OK);
        } catch {
          dataWritable = false;
          fehler = 'Datenverzeichnis nicht verfügbar oder nicht schreibbar';
        }
        send(res, dataWritable ? 200 : 503, {
          ok: dataWritable,
          version: process.env.APP_VERSION || '1.0.0',
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          dataWritable,
          ...(fehler ? { fehler } : {}),
        });
        return;
      }
      if (url.pathname === '/api/version') {
        send(res, 200, { version: process.env.APP_VERSION || '1.0.0', schema: 1 });
        return;
      }
      if (url.pathname === '/api/trades' && req.method === 'GET') {
        packsPromise ??= loadPacks(tradesDir).catch((err) => {
          packsPromise = undefined;
          throw err;
        });
        send(res, 200, await packsPromise);
        return;
      }

      if (url.pathname === '/api/jobs') {
        await ensureReady();
        if (req.method === 'GET') {
          const jobs = await store.read('jobs', []);
          send(res, 200, jobs.map(({ fotos, ...job }) => job));
          return;
        }
        if (req.method === 'POST') {
          const body = await jsonBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw Object.assign(new Error('Ungültige Job-Daten'), { status: 400 });
          }
          const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, status: _status, fotos: _fotos, ...data } = body;
          validateJob(data);
          const now = new Date().toISOString();
          const job = {
            ...data,
            id: `job_${randomUUID()}`,
            status: 'entwurf',
            positionen: Array.isArray(data.positionen) ? data.positionen : [],
            summen: isPlainObject(data.summen) ? data.summen : {},
            fotos: [],
            createdAt: now,
            updatedAt: now,
          };
          await store.mutate('jobs', [], (jobs) => {
            jobs.push(job);
            return jobs;
          });
          send(res, 201, job);
          return;
        }
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch) {
        await ensureReady();
        const jobId = jobMatch[1];
        if (req.method === 'GET') {
          const jobs = await store.read('jobs', []);
          const job = jobs.find((entry) => entry.id === jobId);
          if (!job) {
            send(res, 404, { fehler: 'Vorgang nicht gefunden' });
            return;
          }
          send(res, 200, job);
          return;
        }
        if (req.method === 'PUT') {
          const body = await jsonBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw Object.assign(new Error('Ungültige Job-Daten'), { status: 400 });
          }
          const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, fotos: _fotos, ...data } = body;
          validateJob(data);
          let updated;
          await store.mutate('jobs', [], async (jobs) => {
            const idx = jobs.findIndex((job) => job.id === jobId);
            if (idx === -1) throw Object.assign(new Error('Vorgang nicht gefunden'), { status: 404 });
            updated = {
              ...jobs[idx],
              ...data,
              id: jobs[idx].id,
              createdAt: jobs[idx].createdAt,
              fotos: jobs[idx].fotos,
              updatedAt: new Date().toISOString(),
            };
            jobs[idx] = updated;
            return jobs;
          });
          send(res, 200, updated);
          return;
        }
        if (req.method === 'DELETE') {
          let removed;
          await store.mutate('jobs', [], async (jobs) => {
            const idx = jobs.findIndex((job) => job.id === jobId);
            if (idx === -1) throw Object.assign(new Error('Vorgang nicht gefunden'), { status: 404 });
            [removed] = jobs.splice(idx, 1);
            return jobs;
          });
          if (isSafeSegment(removed.id)) {
            await rm(path.join(fotosRoot, removed.id), { recursive: true, force: true }).catch(() => {});
          }
          send(res, 204);
          return;
        }
        send(res, 405, { fehler: 'Methode nicht erlaubt' });
        return;
      }

      const fotoUploadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/fotos$/);
      if (fotoUploadMatch && req.method === 'POST') {
        await ensureReady();
        let jobId;
        try {
          jobId = decodeURIComponent(fotoUploadMatch[1]);
        } catch {
          send(res, 400, { fehler: 'Ungültige Vorgangs-ID' });
          return;
        }
        if (!isSafeSegment(jobId)) {
          send(res, 400, { fehler: 'Ungültige Vorgangs-ID' });
          return;
        }
        const body = await jsonBody(req);
        const raw = typeof body?.data === 'string' ? body.data : '';
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
        if (!match) {
          send(res, 400, { fehler: 'Foto muss ein JPEG, PNG oder WebP als Base64-DatenURL sein', feld: 'data' });
          return;
        }
        const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
        if (buffer.length === 0) {
          send(res, 400, { fehler: 'Foto ist leer', feld: 'data' });
          return;
        }
        if (buffer.length > 2 * 1024 * 1024) {
          send(res, 413, { fehler: 'Foto ist größer als 2 MB', feld: 'data' });
          return;
        }
        const hash = createHash('sha256').update(buffer).digest('hex');
        const extension = match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg';
        const datei = `foto_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`;
        const dir = path.join(fotosRoot, jobId);
        const file = path.join(dir, datei);
        await mkdir(dir, { recursive: true, mode: 0o750 });
        await writeFile(file, buffer, { mode: 0o640 });
        let foto;
        let updated;
        let duplicate = false;
        try {
          await store.mutate('jobs', [], async (jobs) => {
            const idx = jobs.findIndex((job) => job.id === jobId);
            if (idx === -1) throw Object.assign(new Error('Vorgang nicht gefunden'), { status: 404 });
            const job = jobs[idx];
            let fotos = Array.isArray(job.fotos) ? job.fotos : [];
            const vorhanden = fotos.find((entry) => entry.hash === hash);
            if (vorhanden) {
              const vorhandenPfad = path.join(fotosRoot, jobId, vorhanden.datei);
              const exists = isSafeSegment(vorhanden.datei) && await access(vorhandenPfad).then(() => true, () => false);
              if (exists) {
                foto = vorhanden;
                duplicate = true;
                updated = job;
                return jobs;
              }
              fotos = fotos.filter((entry) => entry !== vorhanden);
            }
            if (fotos.length >= 6) {
              throw Object.assign(new Error('Es sind höchstens 6 Fotos je Vorgang erlaubt'), { status: 400 });
            }
            foto = {
              datei,
              name: typeof body.name === 'string' ? body.name.slice(0, 120) : datei,
              groesse: buffer.length,
              hash,
              createdAt: new Date().toISOString(),
              url: `/api/fotos/${encodeURIComponent(jobId)}/${encodeURIComponent(datei)}`,
            };
            updated = { ...job, fotos: [...fotos, foto], updatedAt: new Date().toISOString() };
            jobs[idx] = updated;
            return jobs;
          });
        } catch (err) {
          await unlink(file).catch(() => {});
          throw err;
        }
        if (duplicate) await unlink(file).catch(() => {});
        send(res, duplicate ? 200 : 201, { foto, job: updated, ...(duplicate ? { duplicate: true } : {}) });
        return;
      }

      const fotoMatch = url.pathname.match(/^\/api\/fotos\/([^/]+)\/([^/]+)$/);
      if (fotoMatch) {
        await ensureReady();
        let jobId;
        let datei;
        try {
          jobId = decodeURIComponent(fotoMatch[1]);
          datei = decodeURIComponent(fotoMatch[2]);
        } catch {
          send(res, 400, { fehler: 'Ungültige Foto-Adresse' });
          return;
        }
        if (!isSafeSegment(jobId) || !isSafeSegment(datei)) {
          send(res, 400, { fehler: 'Ungültige Foto-Adresse' });
          return;
        }
        const target = path.join(fotosRoot, jobId, datei);
        if (req.method === 'GET') {
          const jobs = await store.read('jobs', []);
          const job = jobs.find((entry) => entry.id === jobId);
          const foto = job && Array.isArray(job.fotos) ? job.fotos.find((entry) => entry.datei === datei) : null;
          if (!job || !foto) {
            send(res, 404, { fehler: 'Foto nicht gefunden' });
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
              'Cache-Control': 'private, max-age=3600',
            });
            res.end(data);
          } catch {
            send(res, 404, { fehler: 'Foto nicht gefunden' });
          }
          return;
        }
        if (req.method === 'DELETE') {
          let updated;
          await store.mutate('jobs', [], (jobs) => {
            const idx = jobs.findIndex((entry) => entry.id === jobId);
            const job = idx >= 0 ? jobs[idx] : null;
            const foto = job && Array.isArray(job.fotos) ? job.fotos.find((entry) => entry.datei === datei) : null;
            if (!job || !foto) throw Object.assign(new Error('Foto nicht gefunden'), { status: 404 });
            updated = { ...job, fotos: job.fotos.filter((entry) => entry.datei !== datei), updatedAt: new Date().toISOString() };
            jobs[idx] = updated;
            return jobs;
          });
          await unlink(target).catch(() => {});
          send(res, 204);
          return;
        }
        send(res, 405, { fehler: 'Methode nicht erlaubt' });
        return;
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
            validateSettings(body);
          } else {
            if (!Array.isArray(body)) {
              throw Object.assign(new Error(`${name} muss ein Array sein`), { status: 400 });
            }
            if (name === 'presets') body.forEach(validatePreset);
            else body.forEach(validatePricelist);
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
        const [jobs, presets, pricelists, settings, meta] = await Promise.all([
          store.read('jobs', []),
          store.read('presets', []),
          store.read('pricelists', []),
          store.read('settings', {}),
          store.read('meta', DEFAULT_META),
        ]);
        send(res, 200, {
          schema: 1,
          exportiertAm: new Date().toISOString(),
          jobs,
          presets,
          pricelists,
          settings,
          meta,
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
          await store.write('jobs', valid.jobs);
          await store.write('presets', valid.presets);
          await store.write('pricelists', valid.pricelists);
          await store.write('settings', valid.settings);
          if (valid.meta) {
            await store.mutate('meta', DEFAULT_META, (meta) => ({
              ...meta,
              ...valid.meta,
              nummern: {
                angebot: Math.max(Number(meta?.nummern?.angebot) || 1, Number(valid.meta?.nummern?.angebot) || 1),
                rechnung: Math.max(Number(meta?.nummern?.rechnung) || 1, Number(valid.meta?.nummern?.rechnung) || 1),
              },
            }));
          }
        } else {
          await store.mutate('jobs', [], (jobs) => mergeById(jobs, valid.jobs));
          await store.mutate('presets', [], (presets) => mergeById(presets, valid.presets));
          await store.mutate('pricelists', [], (pricelists) => mergeById(pricelists, valid.pricelists));
          await store.mutate('settings', {}, (settings) => ({ ...settings, ...valid.settings }));
          if (valid.meta) {
            await store.mutate('meta', DEFAULT_META, (meta) => ({
              ...meta,
              ...valid.meta,
              nummern: {
                angebot: Math.max(Number(meta?.nummern?.angebot) || 1, Number(valid.meta?.nummern?.angebot) || 1),
                rechnung: Math.max(Number(meta?.nummern?.rechnung) || 1, Number(valid.meta?.nummern?.rechnung) || 1),
              },
            }));
          }
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
