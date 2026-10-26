import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPacks } from './trades.js';

export function createServer({ dataDir, appDir, tradesDir }) {
  const startedAt = Date.now();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: process.env.APP_VERSION || '1.0.0', uptime: Math.floor((Date.now() - startedAt) / 1000), dataWritable: true }));
      return;
    }
    if (url.pathname === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ version: process.env.APP_VERSION || '1.0.0', schema: 1 }));
      return;
    }
    if (url.pathname === '/api/trades' && req.method === 'GET') {
      try {
        const packs = await loadPacks(tradesDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(packs));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ fehler: err.message }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ fehler: 'Nicht gefunden' }));
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
