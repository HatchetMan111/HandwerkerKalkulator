# Handwerker-Kalkulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein self-hosted, deutschsprachiger Kalkulations-Assistent für 20 Gewerke, der vor Ort Maße in Mengen, Ressourcen und Angebotspreise umrechnet und als Proxmox-LXC installierbar ist.

**Architecture:** Statisches HTML/CSS/JS-Frontend ohne Build-Schritt, ausgeliefert von einem Node-22-Server, der nur eingebaute Module nutzt. Der Rechenkern ist generisch und wird von JSON-Trade-Packs gesteuert; Persistenz erfolgt atomar in JSON-Dateien unter `DATA_DIR`.

**Tech Stack:** Node.js 22 (ESM, `node:http`, `node:fs`, `node:test`), pures HTML/CSS/JavaScript (ES-Module), systemd, Proxmox LXC, Bash.

**Spec:** `docs/superpowers/specs/2026-10-26-handwerker-kalkulator-design.md`

## Global Constraints

- Produkt, UI, Fehlermeldungen und Doku auf Deutsch; Zahlenformat `de-DE`.
- Keine Laufzeitabhängigkeiten außer Node.js 22; kein `npm install` nötig.
- Kein `eval`, kein `new Function` im Rechenkern.
- Keine Cloud, keine Telemetrie, keine Konten.
- Port `8090`, `DATA_DIR` per Umgebungsvariable (Standard `/var/lib/handwerker-kalkulator`).
- Alle Schreibvorgänge atomar (`tmp` + `rename`) und serialisiert.
- 20 Trade-Packs, IDs kleingeschrieben ohne Umlaute.
- Druckansicht DIN A4, Tap-Ziele mindestens 44 px, sichtbare Fokusringe.
- Keine Secrets im Repo; Token niemals in `.git/config` oder Dateien schreiben.
- Jede Aufgabe endet mit grünen Tests und einem Commit.

## Review Focus

Diese fünf Fälle sind in der Spec nicht durch Tests abgedeckt und müssen in der jeweils zuständigen Aufgabe gepinnt werden:

1. **Division durch null / leere Eingaben** – darf kein `NaN`/`Infinity` liefern, sondern eine deutsche Fehlermeldung (Task 3/4).
2. **Transport mit Volumen- und Gewichtslimit** – Fahrten sind das Maximum beider Grenzen, nicht die Summe (Task 4).
3. **Deutsches Dezimalkomma** – `2,5` muss in Eingaben und Formeln als 2.5 erkannt werden (Task 3/9).
4. **Ergiebigkeit/Fläche null** – Materialformeln dürfen nicht durch 0 teilen; Validierung blockiert das Speichern (Task 4/5).
5. **Defekter Import** – ungültiges JSON darf keine bestehenden Daten überschreiben (Task 8).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `package.json` | ESM-Modus, Start-/Test-Skripte, keine Dependencies |
| `VERSION`, `LICENSE`, `CHANGELOG.md` | Metadaten |
| `server/server.js` | HTTP-Server, Routing, statische Auslieferung, Start |
| `server/store.js` | Atomare JSON-Persistenz, Serialisierung |
| `server/trades.js` | Laden und Validieren der Trade-Packs |
| `server/numbering.js` | Angebots-/Rechnungsnummern |
| `app/index.html` | App-Shell, Navigation, Templates |
| `app/assets/styles.css` | Layout, Tokens, Responsive, Dark/Light |
| `app/assets/print.css` | DIN-A4-Druck |
| `app/assets/formats.js` | `de-DE`-Zahlen, Währung, Datum |
| `app/assets/engine.js` | Formel-Parser, Kalkulation, Validierung |
| `app/assets/measure.js` | Rechteck, L-Form, Dreieck, GPS-Polygon, Sprache |
| `app/assets/api.js` | Fetch-Wrapper |
| `app/assets/app.js` | Router, Zustand, Rendering, Events |
| `app/trades/*.json` | 20 Gewerke-Packs |
| `tests/*.test.js` | Engine, Packs, Server, Measure, Formats |
| `install/handwerker-kalkulator.sh` | Proxmox-LXC-Installer |
| `systemd/handwerker-kalkulator.service` | systemd-Unit |
| `README.md` | Installation, Betrieb, Backup, Sicherheit |

---

### Task 1: Repo-Grundgerüst und Server-Skelett

**Files:**
- Create: `package.json`, `.gitignore`, `VERSION`, `server/server.js`, `tests/server.test.js`

**Interfaces:**
- Produces: `createServer({ dataDir, appDir, tradesDir }) → http.Server`; `GET /api/health` liefert `{ok, version, uptime, dataWritable}`.

- [ ] **Step 1: Failing Test schreiben**

```js
// tests/server.test.js
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
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node --test tests/server.test.js`
Expected: FAIL, weil `server/server.js` fehlt.

- [ ] **Step 3: Minimal implementieren**

```json
// package.json
{
  "name": "handwerker-kalkulator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server/server.js",
    "test": "node --test tests/"
  }
}
```

```js
// server/server.js
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
```

`.gitignore`:

```text
node_modules/
data/
*.log
.DS_Store
```

`VERSION`: `1.0.0`

- [ ] **Step 4: Test bestehen lassen**

Run: `node --test tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore VERSION server/server.js tests/server.test.js
git commit -m "Grundgerüst: Node-Server mit Health-Endpoint"
```

---

### Task 2: Atomare JSON-Persistenz

**Files:**
- Create: `server/store.js`, `tests/store.test.js`

**Interfaces:**
- Produces: `createStore(dataDir) → { init(), read(name, fallback), write(name, value) }`.
- `write` serialisiert konkurrierende Aufrufe und ersetzt die Datei atomar.

- [ ] **Step 1: Failing Test schreiben**

```js
// tests/store.test.js
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
  assert.deepEqual(await readdir(dir), ['jobs.json']);
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
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `node --test tests/store.test.js`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

```js
// server/store.js
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createStore(dataDir) {
  let queue = Promise.resolve();
  const file = (name) => path.join(dataDir, `${name}.json`);

  async function init() {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o750 });
    for (const name of ['jobs', 'presets', 'pricelists', 'settings']) {
      try { await fs.access(file(name)); } catch { await fs.writeFile(file(name), '[]\n', { mode: 0o640 }); }
    }
    try { await fs.access(path.join(dataDir, 'meta.json')); } catch { await fs.writeFile(path.join(dataDir, 'meta.json'), JSON.stringify({ schema: 1, nummern: { angebot: 1, rechnung: 1 } }, null, 2) + '\n', { mode: 0o640 }); }
    await fs.mkdir(path.join(dataDir, 'fotos'), { recursive: true, mode: 0o750 });
  }

  async function read(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  function write(name, value) {
    const run = async () => {
      const tmp = `${file(name)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o640 });
      await fs.rename(tmp, file(name));
    };
    queue = queue.then(run, run);
    return queue;
  }

  return { init, read, write };
}
```

- [ ] **Step 4: Test bestehen lassen**

Run: `node --test tests/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/store.js tests/store.test.js
git commit -m "Persistenz: atomare JSON-Ablage mit Write-Queue"
```

---

### Task 3: Sicherer Formel-Parser

**Files:**
- Create: `app/assets/engine.js`, `tests/engine.test.js`

**Interfaces:**
- Produces: `evaluateFormula(expr, scope) → number`; `FormulaError` mit deutscher `message`.
- Unterstützt `+ - * / ( )`, Dezimalkomma, Funktionen `ceil floor round min max abs sqrt pi`.

- [ ] **Step 1: Failing Tests schreiben**

```js
// tests/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFormula, FormulaError } from '../app/assets/engine.js';

test('Punkt-vor-Strich und Klammern', () => {
  assert.equal(evaluateFormula('2 + 3 * 4'), 14);
  assert.equal(evaluateFormula('(2 + 3) * 4'), 20);
});

test('deutsches Dezimalkomma', () => {
  assert.equal(evaluateFormula('2,5 * 4'), 10);
});

test('Funktionen und Variablen', () => {
  assert.equal(evaluateFormula('ceil(laenge / 2)', { laenge: 5 }), 3);
  assert.equal(evaluateFormula('max(a, b)', { a: 2, b: 7 }), 7);
});

test('Division durch null wird zur deutschen Fehlermeldung', () => {
  assert.throws(() => evaluateFormula('1 / 0'), (err) => err instanceof FormulaError && /null/.test(err.message));
});

test('unbekannte Variable wird gemeldet', () => {
  assert.throws(() => evaluateFormula('x + 1', {}), (err) => err instanceof FormulaError && /unbekannt/i.test(err.message));
});
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/engine.test.js`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

```js
// app/assets/engine.js
export class FormulaError extends Error {
  constructor(message, position = 0) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

const FUNCTIONS = {
  ceil: Math.ceil, floor: Math.floor, round: Math.round,
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt,
  pi: () => Math.PI,
};

function tokenize(input) {
  const src = String(input).replace(/(\d),(\d)/g, '$1.$2');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new FormulaError(`Ungültige Zahl: ${raw}`, i);
      tokens.push({ type: 'number', value: Number(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(ch)) { tokens.push({ type: ch }); i += 1; continue; }
    throw new FormulaError(`Unerwartetes Zeichen: ${ch}`, i);
  }
  return tokens;
}

export function evaluateFormula(expr, scope = {}) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (type) => {
    if (!peek() || peek().type !== type) throw new FormulaError(`Erwartet: ${type}`, pos);
    return tokens[pos++];
  };

  function parseExpression() {
    let value = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = tokens[pos++].type;
      const right = parseUnary();
      if (op === '/' && right === 0) throw new FormulaError('Division durch null ist nicht erlaubt.', pos);
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseUnary() {
    if (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      const value = parseUnary();
      return op === '-' ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new FormulaError('Formel ist unvollständig.', pos);
    if (token.type === 'number') { pos += 1; return token.value; }
    if (token.type === '(') { pos += 1; const value = parseExpression(); take(')'); return value; }
    if (token.type === 'ident') {
      pos += 1;
      const name = token.value;
      if (peek() && peek().type === '(') {
        const fn = FUNCTIONS[name];
        if (!fn) throw new FormulaError(`Unbekannte Funktion: ${name}`, pos);
        pos += 1;
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpression());
          while (peek() && peek().type === ',') { pos += 1; args.push(parseExpression()); }
        }
        take(')');
        return fn(...args);
      }
      if (!(name in scope)) throw new FormulaError(`Unbekannte Variable: ${name}`, pos);
      return scope[name];
    }
    throw new FormulaError(`Unerwartetes Zeichen: ${token.type}`, pos);
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new FormulaError('Unerwarteter Rest in der Formel.', pos);
  if (!Number.isFinite(result)) throw new FormulaError('Ergebnis ist keine gültige Zahl (Division durch 0?).', pos);
  return result;
}
```

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assets/engine.js tests/engine.test.js
git commit -m "Rechenkern: sicherer Formel-Parser"
```

---

### Task 4: Kalkulations-Engine

**Files:**
- Modify: `app/assets/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Produces: `calculate(pack, state) → { positionen, summen, hinweise }`.
- `state = { eingaben: {}, faktoren: {}, preise: {} }`.
- Position: `{ id, label, menge, einheit, einzelpreis, gesamt, herleitung }`.
- Summen: `{ zwischensumme, anfahrt, marge, mindestpreis, netto, mwst, gesamt, mwstSatz }`.

- [ ] **Step 1: Failing Tests ergänzen**

```js
// tests/engine.test.js (ergänzen)
import { calculate } from '../app/assets/engine.js';

const pack = {
  id: 'test', name: 'Test', eingaben: [], faktoren: [], preise: { mwst: 19 },
  ressourcen: [
    { id: 'mat', label: 'Material', art: 'material', einheit: 'l', formel: 'flaeche / ergiebigkeit', preisProEinheit: 10 },
    { id: 'tr', label: 'Transport', art: 'transport', einheit: 'Fahrten', volumenFormel: 'volumen', gewichtFormel: 'gewicht', volumenProFahrt: 8, gewichtProFahrt: 12, preisProFahrt: 100 },
    { id: 'c', label: 'Mulde', art: 'container', einheit: 'Mulden', volumenFormel: 'volumen', volumenProContainer: 10, preisProContainer: 300 },
    { id: 'p', label: 'Paletten', art: 'palette', einheit: 'Paletten', stueckFormel: 'stueck', stueckProPalette: 200, preisProPalette: 50 },
    { id: 's', label: 'Säcke', art: 'sack', einheit: 'Säcke', gewichtFormel: 'kg', kgProSack: 25, preisProSack: 5 },
    { id: 'h', label: 'Stunden', art: 'stunden', einheit: 'h', formel: 'stunden', preisProEinheit: 40 },
    { id: 'f', label: 'Pauschale', art: 'pauschal', einheit: 'Pauschale', preisProEinheit: 20 },
  ],
};

test('Transport nimmt das Maximum aus Volumen und Gewicht', () => {
  const r = calculate(pack, { eingaben: { volumen: 20, gewicht: 30, kg: 60, stueck: 450, stunden: 1.1 }, faktoren: { ergiebigkeit: 10, flaeche: 50 }, preise: {} });
  const tr = r.positionen.find((p) => p.id === 'tr');
  assert.equal(tr.menge, 3); // max(ceil(20/8)=3, ceil(30/12)=3)
});

test('Container, Palette, Sack und Stunden runden auf', () => {
  const r = calculate(pack, { eingaben: { volumen: 21, gewicht: 1, kg: 51, stueck: 401, stunden: 1.1 }, faktoren: { ergiebigkeit: 10, flaeche: 50 }, preise: {} });
  assert.equal(r.positionen.find((p) => p.id === 'c').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 'p').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 's').menge, 3);
  assert.equal(r.positionen.find((p) => p.id === 'h').menge, 1.25);
});

test('Mindestpreis, Marge und MwSt', () => {
  const minPack = { ...pack, preise: { mwst: 19, mindestpreis: 500 } };
  const r = calculate(minPack, { eingaben: { volumen: 0, gewicht: 0, kg: 0, stueck: 0, stunden: 0 }, faktoren: { ergiebigkeit: 10, flaeche: 0 }, preise: { marge: 10 } });
  assert.equal(r.summen.netto, 500);
  assert.equal(r.summen.mwst, 95);
  assert.equal(r.summen.gesamt, 595);
});

test('Division durch null in der Formel wird abgefangen', () => {
  assert.throws(() => calculate(pack, { eingaben: { volumen: 0, gewicht: 0, kg: 0, stueck: 0, stunden: 0 }, faktoren: { ergiebigkeit: 0, flaeche: 10 }, preise: {} }), /null/);
});
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/engine.test.js`
Expected: FAIL, `calculate` fehlt.

- [ ] **Step 3: Implementieren**

```js
// app/assets/engine.js (ergänzen)
const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

function resourceLine(resource, scope) {
  const preis = Number(resource.preisProEinheit ?? resource.preisProFahrt ?? resource.preisProContainer ?? resource.preisProPalette ?? resource.preisProSack ?? 0);
  if (resource.art === 'material') {
    const roh = evaluateFormula(resource.formel, scope);
    const menge = roundTo(roh, 2);
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${resource.formel} = ${menge} ${resource.einheit}` };
  }
  if (resource.art === 'transport') {
    const volumen = evaluateFormula(resource.volumenFormel, scope);
    const gewicht = resource.gewichtFormel ? evaluateFormula(resource.gewichtFormel, scope) : 0;
    const nachVolumen = resource.volumenProFahrt ? Math.ceil(volumen / resource.volumenProFahrt) : 0;
    const nachGewicht = resource.gewichtProFahrt ? Math.ceil(gewicht / resource.gewichtProFahrt) : 0;
    const menge = Math.max(nachVolumen, nachGewicht, volumen > 0 || gewicht > 0 ? 1 : 0);
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${volumen} m³ / ${gewicht} t → ${menge} Fahrten` };
  }
  if (resource.art === 'container') {
    const volumen = evaluateFormula(resource.volumenFormel, scope);
    const menge = volumen > 0 ? Math.ceil(volumen / resource.volumenProContainer) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${volumen} m³ / ${resource.volumenProContainer} m³ = ${menge} Mulden` };
  }
  if (resource.art === 'palette') {
    const stueck = evaluateFormula(resource.stueckFormel, scope);
    const menge = stueck > 0 ? Math.ceil(stueck / resource.stueckProPalette) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${stueck} Stk / ${resource.stueckProPalette} = ${menge} Paletten` };
  }
  if (resource.art === 'sack') {
    const kg = evaluateFormula(resource.gewichtFormel, scope);
    const menge = kg > 0 ? Math.ceil(kg / resource.kgProSack) : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${kg} kg / ${resource.kgProSack} kg = ${menge} Säcke` };
  }
  if (resource.art === 'stunden') {
    const roh = evaluateFormula(resource.formel, scope);
    const menge = roh > 0 ? Math.ceil(roh * 4) / 4 : 0;
    return { ...resource, menge, einzelpreis: preis, gesamt: roundTo(menge * preis, 2), herleitung: `${resource.formel} = ${menge} h (auf 0,25 h aufgerundet)` };
  }
  if (resource.art === 'pauschal') {
    return { ...resource, menge: 1, einzelpreis: preis, gesamt: roundTo(preis, 2), herleitung: 'Pauschale' };
  }
  throw new FormulaError(`Unbekannter Ressourcentyp: ${resource.art}`);
}

export function calculate(pack, state = {}) {
  const scope = { ...state.eingaben, ...state.faktoren };
  for (const input of pack.eingaben || []) {
    if (!(input.id in scope)) scope[input.id] = input.standard ?? 0;
  }
  for (const factor of pack.faktoren || []) {
    if (!(factor.id in scope)) scope[factor.id] = factor.standard ?? 0;
  }
  const positionen = (pack.ressourcen || []).map((r) => resourceLine(r, scope));
  let zwischensumme = roundTo(positionen.reduce((sum, p) => sum + p.gesamt, 0), 2);
  const preise = { ...(pack.preise || {}), ...(state.preise || {}) };
  const km = Number(state.eingaben?.anfahrtKm ?? 0);
  const anfahrt = preise.anfahrt ? roundTo(km * Number(preise.anfahrt.preisProKm || 0) * (preise.anfahrt.hinUndZurueck ? 2 : 1), 2) : roundTo(Number(preise.anfahrtPauschal || 0), 2);
  const margeSatz = Number(state.preise?.marge || 0);
  const marge = roundTo((zwischensumme + anfahrt) * margeSatz / 100, 2);
  let netto = roundTo(zwischensumme + anfahrt + marge, 2);
  let mindestpreis = 0;
  if (preise.mindestpreis && netto < preise.mindestpreis) {
    mindestpreis = roundTo(preise.mindestpreis - netto, 2);
    positionen.push({ id: 'mindestpreis', label: 'Mindestpreis', menge: 1, einheit: 'Pauschale', einzelpreis: mindestpreis, gesamt: mindestpreis, herleitung: 'Auf Mindestpreis aufgerundet' });
    netto = roundTo(preise.mindestpreis, 2);
  }
  const mwstSatz = Number(preise.mwst ?? 19);
  const mwst = roundTo(netto * mwstSatz / 100, 2);
  const gesamt = roundTo(netto + mwst, 2);
  return {
    positionen,
    summen: { zwischensumme, anfahrt, marge, mindestpreis, netto, mwst, gesamt, mwstSatz },
    hinweise: [],
  };
}
```

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assets/engine.js tests/engine.test.js
git commit -m "Rechenkern: Kalkulation für sieben Ressourcentypen"
```

---

### Task 5: Pack-Validierung und erste drei Gewerke

**Files:**
- Create: `server/trades.js`, `app/trades/erdbau.json`, `app/trades/maler.json`, `app/trades/umzug.json`, `tests/trades.test.js`
- Modify: `server/server.js`, `tests/server.test.js`

**Interfaces:**
- Produces: `loadPacks(dir) → Promise<object[]>`, `validatePack(pack) → string[]`, `GET /api/trades → pack[]`.
- Validiert Pflichtfelder, IDs, Formeln, referenzierte Variablen und Wertebereiche.

- [ ] **Step 1: Failing Test schreiben**

```js
// tests/trades.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPacks, validatePack } from '../server/trades.js';

test('alle Packs sind schema-valide', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  assert.ok(packs.length >= 3);
  for (const pack of packs) {
    assert.deepEqual(validatePack(pack), [], `${pack.id}: ${validatePack(pack).join('; ')}`);
  }
});

test('Pflichtfelder werden geprüft', () => {
  const errors = validatePack({ id: 'X', name: '', eingaben: [], faktoren: [], ressourcen: [], preise: {} });
  assert.ok(errors.some((e) => /id/i.test(e)));
  assert.ok(errors.some((e) => /name/i.test(e)));
});
```

Ergänze außerdem in `tests/server.test.js`:

```js
test('GET /api/trades liefert alle Packs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-trades-'));
  const server = createServer({ dataDir: dir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/trades`);
  const packs = await res.json();
  assert.ok(packs.length >= 3);
  assert.ok(packs.every((p) => p.id && p.name));
  server.close();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/trades.test.js`
Expected: FAIL, Modul/JSON fehlen.

- [ ] **Step 3: Implementieren**

```js
// server/trades.js
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { evaluateFormula, FormulaError } from '../app/assets/engine.js';

export async function loadPacks(dir) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const packs = [];
  for (const file of files) packs.push(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')));
  return packs;
}

export function validatePack(pack) {
  const errors = [];
  if (!/^[a-z0-9_]+$/.test(pack.id || '')) errors.push('id muss kleingeschrieben und ohne Umlaute sein');
  if (!pack.name || typeof pack.name !== 'string') errors.push('name fehlt');
  if (!pack.gruppe) errors.push('gruppe fehlt');
  if (!Array.isArray(pack.eingaben)) errors.push('eingaben fehlt');
  if (!Array.isArray(pack.faktoren)) errors.push('faktoren fehlt');
  if (!Array.isArray(pack.ressourcen) || pack.ressourcen.length === 0) errors.push('ressourcen fehlt');
  const scope = {};
  for (const i of pack.eingaben || []) { scope[i.id] = 1; if (i.standard === undefined) errors.push(`eingabe ${i.id}: standard fehlt`); }
  for (const f of pack.faktoren || []) { scope[f.id] = 1; if (f.standard === undefined) errors.push(`faktor ${f.id}: standard fehlt`); }
  for (const r of pack.ressourcen || []) {
    const formula = r.formel || r.volumenFormel || r.gewichtFormel || r.stueckFormel;
    if (r.art !== 'pauschal' && !formula) errors.push(`ressource ${r.id}: formel fehlt`);
    if (formula) {
      try { evaluateFormula(formula, scope); } catch (err) {
        errors.push(`ressource ${r.id}: ${err instanceof FormulaError ? err.message : String(err)}`);
      }
    }
  }
  if (!pack.preise || typeof pack.preise.mwst !== 'number') errors.push('preise.mwst fehlt');
  return errors;
}
```

`app/trades/erdbau.json`:

```json
{
  "id": "erdbau", "name": "Erdbau & Aushub", "gruppe": "Bau & Außen", "icon": "bagger",
  "beschreibung": "Aushubmengen, Auflockerung und LKW-Fahrten kalkulieren.",
  "eingaben": [
    {"id": "flaeche", "label": "Aushubfläche", "art": "flaeche", "einheit": "m²", "standard": 0},
    {"id": "tiefe", "label": "Aushubtiefe", "art": "volumen", "einheit": "m", "standard": 0},
    {"id": "dichte", "label": "Bodenichte", "art": "anzahl", "einheit": "t/m³", "standard": 1.8, "min": 0.8, "max": 3},
    {"id": "anfahrtKm", "label": "Anfahrt (einfach)", "art": "anzahl", "einheit": "km", "standard": 0}
  ],
  "faktoren": [{"id": "auflockerung", "label": "Auflockerung", "einheit": "%", "standard": 25, "min": 0, "max": 80}],
  "ressourcen": [
    {"id": "aushub", "label": "Aushub (lose)", "art": "material", "einheit": "m³", "formel": "flaeche * tiefe * (1 + auflockerung / 100)", "preisProEinheit": 0},
    {"id": "transport", "label": "LKW-Transport", "art": "transport", "einheit": "Fahrten", "volumenFormel": "flaeche * tiefe * (1 + auflockerung / 100)", "gewichtFormel": "flaeche * tiefe * dichte", "volumenProFahrt": 8, "gewichtProFahrt": 12, "preisProFahrt": 180}
  ],
  "preise": {"mwst": 19, "anfahrt": {"preisProKm": 0.8, "hinUndZurueck": true}},
  "ausgabe": {"titel": "Erdbauarbeiten", "mengeLabel": "Aushub", "mengeEinheit": "m³", "mengeFormel": "flaeche * tiefe"}
}
```

`app/trades/maler.json`: übernimm das Beispiel aus Spec Abschnitt 7.5, ergänze `"gruppe": "Ausbau & Hochbau"`.

In `server/server.js` ergänzen:

```js
import { loadPacks } from './trades.js';

// innerhalb von createServer, vor dem 404:
if (url.pathname === '/api/trades' && req.method === 'GET') {
  const packs = await loadPacks(tradesDir);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(packs));
  return;
}
```

`app/trades/umzug.json`:

```json
{
  "id": "umzug", "name": "Umzug & Transport", "gruppe": "Ausbau & Hochbau", "icon": "lkw",
  "beschreibung": "Umzugsvolumen, LKW-Ladungen und Tragezeit kalkulieren.",
  "eingaben": [
    {"id": "volumen", "label": "Umzugsvolumen", "art": "volumen", "einheit": "m³", "standard": 0},
    {"id": "gewicht", "label": "Gewicht", "art": "gewicht", "einheit": "t", "standard": 0},
    {"id": "etage", "label": "Etage", "art": "anzahl", "einheit": "Etage", "standard": 0},
    {"id": "anfahrtKm", "label": "Anfahrt (einfach)", "art": "anzahl", "einheit": "km", "standard": 0}
  ],
  "faktoren": [{"id": "traegerFaktor", "label": "Tragefaktor pro Etage", "einheit": "h", "standard": 0.5}],
  "ressourcen": [
    {"id": "transport", "label": "LKW-Ladungen", "art": "transport", "einheit": "Fahrten", "volumenFormel": "volumen", "gewichtFormel": "gewicht", "volumenProFahrt": 20, "gewichtProFahrt": 1, "preisProFahrt": 220},
    {"id": "traeger", "label": "Tragezeit", "art": "stunden", "einheit": "h", "formel": "volumen / 4 + etage * traegerFaktor", "preisProEinheit": 35},
    {"id": "pauschale", "label": "Verpackung", "art": "pauschal", "einheit": "Pauschale", "preisProEinheit": 60}
  ],
  "preise": {"mwst": 19, "anfahrt": {"preisProKm": 0.9, "hinUndZurueck": true}},
  "ausgabe": {"titel": "Umzug", "mengeLabel": "Volumen", "mengeEinheit": "m³", "mengeFormel": "volumen"}
}
```

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/trades.test.js tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/trades.js server/server.js app/trades/erdbau.json app/trades/maler.json app/trades/umzug.json tests/trades.test.js tests/server.test.js
git commit -m "Gewerke: Validierung, erste drei Packs und /api/trades"
```

---

### Task 6: Restliche 17 Gewerke-Packs

**Files:**
- Create: `app/trades/abbruch.json`, `garten.json`, `tiefbau.json`, `baumfaellung.json`, `baustelle.json`, `dachdecker.json`, `fliesenleger.json`, `trockenbau.json`, `beton.json`, `zaun.json`, `pflaster.json`, `reinigung.json`, `catering.json`, `event.json`, `landwirtschaft.json`, `fotografie.json`, `3ddruck.json`
- Modify: `tests/trades.test.js`

**Interfaces:**
- Alle 20 Packs erfüllen das Schema aus Task 5; IDs und Gruppen wie in der Spec.

- [ ] **Step 1: Test auf 20 Packs erweitern**

```js
test('genau die 20 geplanten Gewerke sind vorhanden', async () => {
  const packs = await loadPacks(path.resolve('app/trades'));
  const ids = packs.map((p) => p.id).sort();
  assert.deepEqual(ids, [
    '3ddruck', 'abbruch', 'baumfaellung', 'baustelle', 'beton', 'catering', 'dachdecker',
    'erdbau', 'event', 'fliesenleger', 'fotografie', 'garten', 'landwirtschaft', 'maler',
    'pflaster', 'reinigung', 'tiefbau', 'trockenbau', 'umzug', 'zaun',
  ]);
});
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `node --test tests/trades.test.js`
Expected: FAIL, fehlende IDs.

- [ ] **Step 3: Packs anlegen**

Jede Datei folgt dem Muster aus Task 5. Verbindliche Eckdaten (Eingaben, Faktoren, Ressourcen):

| Datei | Eingaben | Faktoren | Ressourcen |
|---|---|---|---|
| `abbruch.json` | flaeche, dicke, dichte | auflockerung 35 | material Bauschutt m³, container 10 m³, transport |
| `garten.json` | flaeche, schichtdicke | verdichtung 10, verschnitt 5, dichte 1.4 | material Mutterboden m³, sack 25 kg, stunden |
| `tiefbau.json` | grabenlaenge, grabenbreite, grabentiefe, rohrlaenge, schaechte | auflockerung 20 | transport Aushub, material Bettung m³, material Rohre m, material Schächte Stk, stunden |
| `baumfaellung.json` | anzahl, durchmesser, hoehe | — | stunden Fällarbeiten, transport Hackschnitzel, pauschal Entsorgung |
| `baustelle.json` | zaunlaenge, toiletten, dauer | — | material Bauzaun m, pauschal Toiletten/Tag, transport |
| `dachdecker.json` | dachflaeche, firstlaenge | ziegelProM2 10, verschnitt 10 | material Ziegel Stk, palette Ziegel, material Firstziegel Stk, stunden |
| `fliesenleger.json` | flaeche | fliesenProM2 11, verschnitt 10, kleberProM2 4 | material Fliesen Stk, sack Kleber 25 kg, sack Fugenmörtel 25 kg, stunden |
| `trockenbau.json` | flaeche | plattenProM2 0.4, verschnitt 10, schraubenProM2 25, spachtelProM2 0.5 | material Platten Stk, material Schrauben Stk, sack Spachtel 25 kg, stunden |
| `beton.json` | flaeche, dicke, bewehrung | verschnitt 5, dichte 2.4 | material Beton m³, material Bewehrung kg, transport Fahrmischer, stunden |
| `zaun.json` | laenge, hoehe, pfostenabstand | verschnitt 5 | material Pfosten Stk, material Querlatten m, material H-Platten m², sack Beton 40 kg, stunden |
| `pflaster.json` | flaeche | steineProM2 40, verschnitt 8, splittProM2 30, sandProM2 50 | material Pflastersteine Stk, palette Steine, sack Splitt 25 kg, sack Sand 25 kg, stunden |
| `reinigung.json` | flaeche, frequenz | m2ProStunde 60 | stunden Reinigung, pauschal Material, anfahrt |
| `catering.json` | gaeste, portionenProGast | — | material Portionen Stk, material Getränke Stk, stunden Service |
| `event.json` | gaeste, dauer | — | material Tische Stk, material Stühle Stk, pauschal Zelt, stunden Aufbau |
| `landwirtschaft.json` | flaecheHa, saatgutProHa, duengerProHa | — | sack Saatgut 25 kg, sack Dünger 50 kg, stunden Maschine |
| `fotografie.json` | stunden, bilder | — | stunden Shooting, stunden Nachbearbeitung, pauschal Anfahrt |
| `3ddruck.json` | volumenCm3 | dichte 1.24, verschnitt 5 | material Filament g, rollen Filament, stunden Druck |

Vollständiges Beispiel für `fliesenleger.json`:

```json
{
  "id": "fliesenleger", "name": "Fliesenleger", "gruppe": "Ausbau & Hochbau", "icon": "fliese",
  "beschreibung": "Fliesen, Kleber und Fugenmörtel für Wand- und Bodenflächen kalkulieren.",
  "eingaben": [
    {"id": "flaeche", "label": "Zu fliesende Fläche", "art": "flaeche", "einheit": "m²", "standard": 0},
    {"id": "anfahrtKm", "label": "Anfahrt (einfach)", "art": "anzahl", "einheit": "km", "standard": 0}
  ],
  "faktoren": [
    {"id": "fliesenProM2", "label": "Fliesen pro m²", "einheit": "Stk/m²", "standard": 11, "min": 1, "max": 100},
    {"id": "verschnitt", "label": "Verschnitt", "einheit": "%", "standard": 10, "min": 0, "max": 30},
    {"id": "kleberProM2", "label": "Kleber", "einheit": "kg/m²", "standard": 4, "min": 1, "max": 20},
    {"id": "fugeProM2", "label": "Fugenmörtel", "einheit": "kg/m²", "standard": 0.5, "min": 0.1, "max": 5}
  ],
  "ressourcen": [
    {"id": "fliesen", "label": "Fliesen", "art": "material", "einheit": "Stk", "formel": "flaeche * fliesenProM2 * (1 + verschnitt / 100)", "preisProEinheit": 2.5},
    {"id": "paletten", "label": "Fliesen-Paletten", "art": "palette", "einheit": "Paletten", "stueckFormel": "flaeche * fliesenProM2 * (1 + verschnitt / 100)", "stueckProPalette": 100, "preisProPalette": 0},
    {"id": "kleber", "label": "Fliesenkleber", "art": "sack", "einheit": "Säcke", "gewichtFormel": "flaeche * kleberProM2", "kgProSack": 25, "preisProSack": 12},
    {"id": "fuge", "label": "Fugenmörtel", "art": "sack", "einheit": "Säcke", "gewichtFormel": "flaeche * fugeProM2", "kgProSack": 25, "preisProSack": 18},
    {"id": "arbeit", "label": "Arbeitszeit", "art": "stunden", "einheit": "h", "formel": "flaeche / 6", "preisProEinheit": 55}
  ],
  "preise": {"mwst": 19, "mindestpreis": 250, "anfahrt": {"preisProKm": 0.8, "hinUndZurueck": true}},
  "ausgabe": {"titel": "Fliesenarbeiten", "mengeLabel": "Fläche", "mengeEinheit": "m²", "mengeFormel": "flaeche"}
}
```

Für jede Ressource gilt: realistische Netto-Einzelpreise (z. B. Ziegel 1,20 €/Stk, Kleber 12 €/Sack, Stunden 45–65 €/h), `preise.mwst: 19`, `ausgabe` mit Titel und Menge.

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/trades.test.js`
Expected: PASS, alle 20 Packs valide.

- [ ] **Step 5: Commit**

```bash
git add app/trades tests/trades.test.js
git commit -m "Gewerke: alle 20 Trade-Packs"
```

---

### Task 7: Jobs-API

**Files:**
- Modify: `server/server.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Produces: `GET/POST /api/jobs`, `GET/PUT/DELETE /api/jobs/:id`.
- Server akzeptiert `createServer({ dataDir, appDir, tradesDir })` und initialisiert den Store.

- [ ] **Step 1: Failing Tests ergänzen**

```js
// tests/server.test.js (oben ergänzen)
async function startApi(dir) {
  const dataDir = dir || await mkdtemp(path.join(tmpdir(), 'hk-api-'));
  const opts = { dataDir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') };
  const server = createServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir: dataDir, opts, server, base: `http://127.0.0.1:${server.address().port}` };
}
const stop = (server) => new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));

test('Jobs CRUD', async () => {
  const api = await startApi();
  try {
    const created = await (await fetch(`${api.base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: 'Test', gewerkId: 'maler', eingaben: { flaeche: 10 } }) })).json();
    assert.ok(created.id);
    assert.equal((await (await fetch(`${api.base}/api/jobs`)).json()).length, 1);
    await fetch(`${api.base}/api/jobs/${created.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...created, titel: 'Neu' }) });
    assert.equal((await (await fetch(`${api.base}/api/jobs/${created.id}`)).json()).titel, 'Neu');
    assert.equal((await fetch(`${api.base}/api/jobs/${created.id}`, { method: 'DELETE' })).status, 204);
  } finally {
    await stop(api.server);
    await rm(api.dir, { recursive: true, force: true });
  }
});

test('Jobs überleben einen Neustart', async () => {
  const first = await startApi();
  const created = await (await fetch(`${first.base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: 'Bleibt', gewerkId: 'maler' }) })).json();
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
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `node --test tests/server.test.js`
Expected: FAIL, 404 statt CRUD.

- [ ] **Step 3: Implementieren**

Ergänze in `server/server.js`:

```js
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';

// innerhalb von createServer:
const store = createStore(dataDir);
let ready;
async function ensureReady() { ready ??= store.init(); await ready; }

async function jsonBody(req, limit = 5 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Ungültiges JSON'), { status: 400 }); }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}
```

Routing (vor dem 404):

```js
await ensureReady();
if (url.pathname === '/api/jobs' && req.method === 'GET') {
  return send(res, 200, await store.read('jobs', []));
}
if (url.pathname === '/api/jobs' && req.method === 'POST') {
  const body = await jsonBody(req);
  const now = new Date().toISOString();
  const job = { id: `job_${randomUUID()}`, status: 'entwurf', positionen: [], summen: {}, fotos: [], createdAt: now, updatedAt: now, ...body };
  const jobs = await store.read('jobs', []);
  jobs.push(job);
  await store.write('jobs', jobs);
  return send(res, 201, job);
}
const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
if (jobMatch) {
  const jobs = await store.read('jobs', []);
  const idx = jobs.findIndex((j) => j.id === jobMatch[1]);
  if (idx === -1) return send(res, 404, { fehler: 'Vorgang nicht gefunden' });
  if (req.method === 'GET') return send(res, 200, jobs[idx]);
  if (req.method === 'PUT') {
    const body = await jsonBody(req);
    const updated = { ...jobs[idx], ...body, id: jobs[idx].id, createdAt: jobs[idx].createdAt, updatedAt: new Date().toISOString() };
    jobs[idx] = updated;
    await store.write('jobs', jobs);
    return send(res, 200, updated);
  }
  if (req.method === 'DELETE') {
    jobs.splice(idx, 1);
    await store.write('jobs', jobs);
    return send(res, 204);
  }
}
```

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/server.js tests/server.test.js
git commit -m "API: Jobs-CRUD mit Persistenz"
```

---

### Task 8: Presets, Preislisten, Einstellungen, Nummern, Export/Import

**Files:**
- Modify: `server/server.js`, `server/numbering.js`
- Test: `tests/server.test.js`

**Interfaces:**
- `GET/PUT /api/presets`, `/api/pricelists`, `/api/settings`.
- `POST /api/nummern/:art` → `{nummer, jahr, zaehler}`.
- `GET /api/export` → Bundle; `POST /api/import` mit `{modus: "merge"|"ersetzen", bundle}`.
- Import ist atomar: bei Validierungsfehler wird nichts geschrieben.

- [ ] **Step 1: Failing Tests ergänzen**

```js
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
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/server.test.js`
Expected: FAIL, Endpunkte fehlen.

- [ ] **Step 3: Implementieren**

`server/numbering.js`:

```js
export function naechsteNummer(meta, art, praefix, jahr = new Date().getFullYear()) {
  const key = art === 'rechnung' ? 'rechnung' : 'angebot';
  const zaehler = (meta.nummern?.[key] || 1);
  const nummer = `${praefix || (key === 'rechnung' ? 'R' : 'A')}-${jahr}-${String(zaehler).padStart(4, '0')}`;
  return { nummer, jahr, zaehler, meta: { ...meta, nummern: { ...meta.nummern, [key]: zaehler + 1 } } };
}
```

In `server/server.js` ergänzen: generische Collection-Endpunkte für `presets`, `pricelists`, `settings`; Nummern-Endpunkt liest/schreibt `meta.json`; Export bündelt `{schema, exportiertAm, jobs, presets, pricelists, settings}`; Import prüft `Array.isArray(jobs)` usw., schreibt erst nach vollständiger Validierung in alle Dateien.

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/numbering.js tests/server.test.js
git commit -m "API: Stammdaten, Nummernkreis, Export und Import"
```

---

### Task 9: Frontend-Shell, Formate und API-Client

**Files:**
- Create: `app/index.html`, `app/assets/styles.css`, `app/assets/formats.js`, `app/assets/api.js`, `app/assets/app.js`, `tests/formats.test.js`
- Modify: `server/server.js`, `tests/server.test.js`

**Interfaces:**
- `formatNumber(n, decimals=2)`, `formatCurrency(n)`, `formatDate(iso)`, `parseGermanNumber(text)`.
- `api.get/post/put/del(path, body)`.
- Router über `location.hash`: `#/`, `#/kalkulation/:id`, `#/vorgaenge`, `#/vorgang/:id`, `#/preislisten`, `#/vorlagen`, `#/einstellungen`, `#/hilfe`.
- Statische Auslieferung aus `appDir`; `/` liefert `index.html`, unbekannte Dateien 404, Pfad-Traversal wird abgewiesen.

- [ ] **Step 1: Failing Format-Tests schreiben**

```js
// tests/formats.test.js
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
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/formats.test.js`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

```js
// app/assets/formats.js
export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function formatCurrency(value) {
  return `${formatNumber(value, 2)} €`;
}
export function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('de-DE');
}
export function parseGermanNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const raw = String(text).trim().replace(/\./g, '').replace(',', '.');
  if (raw === '' || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}
```

`app/index.html` enthält die App-Shell, Kopfzeile, Navigation und `<main id="app">`; `app/assets/app.js` implementiert den Hash-Router und rendert zunächst eine Begrüßung mit Gewerke-Karten aus `GET /api/trades`. `styles.css` definiert Design-Tokens (Anthrazit, Signalorange), Fokusringe, 44-px-Tap-Ziele und `prefers-reduced-motion`.

Statische Auslieferung in `server/server.js` ergänzen:

```js
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(appDir, rel);
  if (!target.startsWith(path.resolve(appDir) + path.sep)) {
    res.writeHead(403); res.end('Verboten'); return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}
```

Am Ende des Handlers vor dem 404: `return serveStatic(req, res, url.pathname);`

Ergänze in `tests/server.test.js`:

```js
test('GET / liefert die App-Shell und blockt Traversal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-static-'));
  const server = createServer({ dataDir: dir, appDir: path.resolve('app'), tradesDir: path.resolve('app/trades') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<main id="app">/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  server.close();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 4: Tests und Smoke bestehen lassen**

Run: `node --test tests/formats.test.js tests/server.test.js`
Run: `node server/server.js` und `http://localhost:8090` öffnen; Startseite sichtbar.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/assets server/server.js tests/formats.test.js tests/server.test.js
git commit -m "Frontend: Shell, Formate, API-Client und statische Auslieferung"
```

---

### Task 10: Gewerke-Galerie und generisches Kalkulationsformular

**Files:**
- Modify: `app/assets/app.js`, `app/assets/styles.css`

- [ ] **Step 1: Manuellen Smoke-Test definieren**

Checkliste:
- Startseite zeigt 20 Karten in drei Gruppen.
- Klick auf „Maler & Lackierer“ öffnet `#/kalkulation/maler`.
- Formular zeigt Eingaben, Faktoren und Preisfelder.
- Eingabe `flaeche = 50` zeigt sofort Positionen und Summen.
- Ungültige Eingabe (leer) zeigt eine Feldfehlermeldung, keinen `NaN`.

- [ ] **Step 2: Implementieren**

In `app.js`:

```js
async function renderGalerie() {
  const packs = await api.get('/api/trades');
  const gruppen = [...new Set(packs.map((p) => p.gruppe))];
  app.innerHTML = `<h1>Gewerk wählen</h1>` + gruppen.map((g) => `
    <section><h2>${g}</h2><div class="karten">${packs.filter((p) => p.gruppe === g).map((p) => `
      <button class="karte" data-pack="${p.id}"><strong>${p.name}</strong><span>${p.beschreibung}</span></button>`).join('')}</div></section>`).join('');
  app.querySelectorAll('[data-pack]').forEach((el) => el.onclick = () => { location.hash = `#/kalkulation/${el.dataset.pack}`; });
}
```

Kalkulationsansicht rendert je Eingabe ein Feld passend zu `art` (Zahl, Fläche mit Maß-Assistent, Auswahl), je Faktor ein überschreibbares Zahlenfeld und die Preisfelder MwSt./Marge/Anfahrt. Bei jeder Änderung wird `calculate(pack, state)` aufgerufen und das Ergebnis in der rechten Spalte gerendert. Fehler aus `FormulaError` werden am betroffenen Feld angezeigt.

- [ ] **Step 3: Smoke-Test durchführen**

Run: `node server/server.js`, Checkliste aus Step 1 abarbeiten.
Expected: Alle Punkte erfüllt.

- [ ] **Step 4: Commit**

```bash
git add app/assets/app.js app/assets/styles.css
git commit -m "UI: Gewerke-Galerie und generisches Kalkulationsformular"
```

---

### Task 11: Maß-Assistent (Rechteck, L-Form, GPS, Sprache)

**Files:**
- Create: `app/assets/measure.js`, `tests/measure.test.js`
- Modify: `app/assets/app.js`

**Interfaces:**
- `rectangleArea(laenge, breite)`, `lShapeArea(a, b, c, d)`, `triangleArea(grundseite, hoehe)`, `polygonArea(punkte)`, `parseSpokenMeasurement(text)`.

- [ ] **Step 1: Failing Tests schreiben**

```js
// tests/measure.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rectangleArea, lShapeArea, triangleArea, polygonArea, parseSpokenMeasurement } from '../app/assets/measure.js';

test('Flächen', () => {
  assert.equal(rectangleArea(5, 4), 20);
  assert.equal(lShapeArea(5, 4, 2, 1), 18);
  assert.equal(triangleArea(6, 3), 9);
});

test('GPS-Polygon (Näherung)', () => {
  const area = polygonArea([
    { lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0.001, lon: 0 },
  ]);
  assert.ok(Math.abs(area - 12364) < 500); // ~111 m × 111 m
});

test('gesprochene Maße', () => {
  assert.deepEqual(parseSpokenMeasurement('zwölf Meter mal acht Meter'), { laenge: 12, breite: 8 });
  assert.deepEqual(parseSpokenMeasurement('zwei Komma fünf Meter tief'), { tiefe: 2.5 });
});
```

- [ ] **Step 2: Tests fehlschlagen lassen**

Run: `node --test tests/measure.test.js`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

```js
// app/assets/measure.js
export const rectangleArea = (laenge, breite) => laenge * breite;
export const lShapeArea = (a, b, c, d) => rectangleArea(a, b) + rectangleArea(c, d);
export const triangleArea = (grundseite, hoehe) => (grundseite * hoehe) / 2;

export function polygonArea(punkte) {
  if (punkte.length < 3) return 0;
  const R = 6378137;
  const rad = (grad) => (grad * Math.PI) / 180;
  let summe = 0;
  for (let i = 0; i < punkte.length; i += 1) {
    const p1 = punkte[i];
    const p2 = punkte[(i + 1) % punkte.length];
    summe += (rad(p2.lon) - rad(p1.lon)) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((summe * R * R) / 2);
}

const ZAHLEN = { null: 0, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwanzig: 20, dreißig: 30 };
export function parseSpokenMeasurement(text) {
  let s = String(text).toLowerCase();
  s = s.replace(/\b([a-zäöüß]+)\b/g, (wort) => (ZAHLEN[wort] !== undefined ? String(ZAHLEN[wort]) : wort));
  s = s.replace(/(\d+)\s*komma\s*(\d+)/g, '$1.$2').replace(/(\d),(\d)/g, '$1.$2');
  const zahlen = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (/(tief|tiefe|dicke|höhe)/.test(s) && zahlen.length === 1) return { tiefe: zahlen[0] };
  if (zahlen.length >= 2) return { laenge: zahlen[0], breite: zahlen[1] };
  if (zahlen.length === 1) return { tiefe: zahlen[0] };
  return {};
}
```

In `app.js` Flächenfelder mit Buttons „Rechteck“, „L-Form“, „Dreieck“, „GPS“, „Diktieren“ ausstatten. GPS nutzt `navigator.geolocation.watchPosition`, sammelt Punkte und übergibt sie an `polygonArea`. Sprache nutzt `window.SpeechRecognition || window.webkitSpeechRecognition` mit `lang = 'de-DE'`; fehlt die API, wird der Button nicht gerendert.

- [ ] **Step 4: Tests bestehen lassen**

Run: `node --test tests/measure.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assets/measure.js app/assets/app.js tests/measure.test.js
git commit -m "Maß-Assistent: Flächen, GPS-Polygon und Spracheingabe"
```

---

### Task 12: Ergebnisanzeige, Speichern und Vorgangsliste

**Files:**
- Modify: `app/assets/app.js`, `app/assets/styles.css`

- [ ] **Step 1: Smoke-Checkliste**

- Nach Eingabe erscheinen Positionen mit Menge, Einheit, Einzelpreis, Gesamt und Herleitung.
- Schaltfläche „Speichern“ legt einen Vorgang an; er erscheint unter `#/vorgaenge`.
- „Duplizieren“ erzeugt eine Kopie mit neuer ID.
- „Löschen“ entfernt den Vorgang nach Bestätigung.
- Autosave des offenen Entwurfs stellt Eingaben nach Reload wieder her.

- [ ] **Step 2: Implementieren**

`renderKalkulation` hält den Zustand in `state = { eingaben, faktoren, preise }`, ruft `calculate()` bei jeder Änderung auf und rendert die Positionstabelle. Speichern sendet `POST /api/jobs` bzw. `PUT /api/jobs/:id` mit `positionen` und `summen` als Snapshot. Vorgangsliste lädt `GET /api/jobs`, bietet Suche, Statusfilter und die Aktionen öffnen/duplizieren/löschen. Entwurf wird unter `localStorage['hk_entwurf']` gesichert und beim Öffnen eines Gewerks angeboten.

- [ ] **Step 3: Smoke-Test durchführen**

Run: `node server/server.js`, Checkliste abarbeiten.
Expected: Alle Punkte erfüllt.

- [ ] **Step 4: Commit**

```bash
git add app/assets/app.js app/assets/styles.css
git commit -m "UI: Ergebnisse, Speichern und Vorgangsliste"
```

---

### Task 13: Angebot/Rechnung drucken und Nummernkreis

**Files:**
- Create: `app/assets/print.css`
- Modify: `app/index.html`, `app/assets/app.js`

- [ ] **Step 1: Smoke-Checkliste**

- Vorgang öffnen, „Angebot drucken“ öffnet die Druckansicht.
- Druckansicht zeigt Firmenkopf, Kunde, Baustelle, Positionen, Summen, MwSt., Zahlungsziel.
- Beim ersten Druck eines Angebots wird eine Nummer aus `POST /api/nummern/angebot` vergeben und gespeichert.
- Statuswechsel auf „Rechnung“ vergibt eine Rechnungsnummer.
- Browser-Druckdialog bietet eine saubere A4-Seite ohne Navigation.

- [ ] **Step 2: Implementieren**

Druckansicht als eigener Renderer mit `window.print()`; `print.css` mit `@page { size: A4; margin: 18mm }`, `thead { display: table-header-group }`, `tr { break-inside: avoid }`. Nummernvergabe vor dem Druck, Ergebnis im Vorgang speichern. Titel je Status: Angebot/Auftragsbestätigung/Rechnung.

- [ ] **Step 3: Smoke-Test durchführen**

Run: `node server/server.js`, Checkliste abarbeiten; Druckvorschau prüfen.
Expected: Alle Punkte erfüllt.

- [ ] **Step 4: Commit**

```bash
git add app/assets/print.css app/index.html app/assets/app.js
git commit -m "UI: Angebot, Rechnung und DIN-A4-Druck"
```

---

### Task 14: Preislisten, Vorlagen, Fotos und Einstellungen

**Files:**
- Modify: `app/assets/app.js`, `app/assets/styles.css`, `server/server.js`

- [ ] **Step 1: Smoke-Checkliste**

- Preisliste anlegen, Lieferant und Materialposition speichern, in einer Kalkulation übernehmen.
- Vorlage „LKW 8 m³“ anlegen und im Formular auswählen.
- Foto aufnehmen/auswählen; es erscheint in der Vorgangsdetailansicht und überlebt einen Reload.
- Einstellungen (Firma, MwSt., Dezimalstellen, Theme) speichern und nach Reload wiederfinden.
- Export erzeugt eine JSON-Datei; Import stellt die Daten wieder her.

- [ ] **Step 2: Implementieren**

CRUD-Ansichten für Preislisten und Vorlagen, Auswahl-Dropdowns in der Kalkulation. Foto-Upload: `FileReader` → Canvas auf max. 1280 px → JPEG 0,7 → `POST /api/jobs/:id/fotos` als Base64; Server schreibt Datei nach `DATA_DIR/fotos/<jobId>/` und ergänzt den Job. Einstellungsformular sendet `PUT /api/settings`. Export/Import über `GET /api/export` und `POST /api/import`.

- [ ] **Step 3: Smoke-Test durchführen**

Run: `node server/server.js`, Checkliste abarbeiten.
Expected: Alle Punkte erfüllt.

- [ ] **Step 4: Commit**

```bash
git add app/assets/app.js app/assets/styles.css server/server.js
git commit -m "UI: Preislisten, Vorlagen, Fotos und Einstellungen"
```

---

### Task 15: PWA und Offline-Entwurf

**Files:**
- Create: `app/manifest.webmanifest`, `app/sw.js`
- Modify: `app/index.html`, `app/assets/app.js`

- [ ] **Step 1: Smoke-Checkliste**

- App lässt sich im Browser als PWA installieren (Manifest gültig, Icons vorhanden).
- Nach dem ersten Laden ist die App-Shell offline erreichbar.
- Offline-Kalkulation funktioniert; Speichern zeigt einen Hinweis und sichert den Entwurf lokal.
- Nach Reload wird der lokale Entwurf angeboten.

- [ ] **Step 2: Implementieren**

Manifest mit Name „Handwerker-Kalkulator“, `start_url: "/"`, `display: "standalone"`, Theme-Farbe `#1c1c1e`, Icons als SVG/PNG unter `app/assets/icons/`. Service Worker cached `/`, `/assets/*`, `/trades/*` mit Cache-First für statische Dateien und Network-First für `/api/*`; bei API-Fehler fällt die App auf `localStorage` zurück.

- [ ] **Step 3: Smoke-Test durchführen**

Run: `node server/server.js`, DevTools → Application → Service Worker/Manifest prüfen, offline schalten und kalkulieren.
Expected: Alle Punkte erfüllt.

- [ ] **Step 4: Commit**

```bash
git add app/manifest.webmanifest app/sw.js app/index.html app/assets
git commit -m "PWA: Manifest, Service Worker und Offline-Entwurf"
```

---

### Task 16: Proxmox-Installer, systemd-Unit und Doku

**Files:**
- Create: `install/handwerker-kalkulator.sh`, `systemd/handwerker-kalkulator.service`, `README.md`, `LICENSE`, `CHANGELOG.md`
- Modify: `VERSION`

**Interfaces:**
- Installer legt LXC an, installiert Node 22, holt die App, startet den Dienst und verifiziert `/api/health` mit HTTP 200.
- Flags: `--ctid --hostname --cores --memory --disk --storage --template-store --bridge --password --ssh-key --repo --branch --local-src --debug --help`.

- [ ] **Step 1: Syntax-Test definieren**

Run: `bash -n install/handwerker-kalkulator.sh`
Expected: keine Ausgabe, Exit 0.

- [ ] **Step 2: Installer implementieren**

Aufbau wie die bestehenden `*-proxmox`-Installer (z. B. `orca-proxmox`):

- Kopfkommentar mit App, Repo, Stack, Host-Hinweis, Usage.
- `set -euo pipefail`, Farben, `msg_info/ok/warn/error`, `exec > >(tee -i "$LOG_FILE") 2>&1`, `trap ERR`.
- Variablen: `APP="handwerker-kalkulator"`, `APP_PORT="8090"`, `REPO_URL="https://github.com/HatchetMan111/HandwerkerKalkulator"`, `BRANCH="main"`, `APP_DIR="/opt/handwerker-kalkulator"`, `DATA_DIR="/var/lib/handwerker-kalkulator"`, Defaults 1 vCPU / 512 MB / 4 GB / 512 MB Swap.
- Host-Checks (`id -u`, `pct`, `pvesh`), nächste CT-ID, Storage-Erkennung, Template-Sicherstellung.
- CT erstellen: `--unprivileged 1 --features nesting=1 --onboot 1 --net0 name=eth0,bridge=$BRIDGE,ip=dhcp`.
- Im Container: `apt-get install -y curl ca-certificates git tar`; Node 22 via NodeSource; User `handwerker`; Verzeichnisse anlegen.
- App holen: bei `--local-src` Verzeichnis auf dem Host tar-en und mit `pct push` nach `/opt` entpacken; sonst `git clone --depth 1 --branch "$BRANCH" "$REPO_URL"`.
- systemd-Unit aus Repo laden (Fallback Inline), `daemon-reload`, `enable --now`.
- Verifikation: `systemctl is-active`, HTTP 200 auf `/api/health` und `/`.
- Abschlussausgabe mit Endpoint, Health, CT-ID, Ressourcen, Root-Passwort, Datenverzeichnis, Update/Deinstall, Logpfad.

- [ ] **Step 3: Unit und Doku schreiben**

`systemd/handwerker-kalkulator.service`:

```ini
[Unit]
Description=Handwerker-Kalkulator – Angebots- und Mengenrechner
Documentation=https://github.com/HatchetMan111/HandwerkerKalkulator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=handwerker
Group=handwerker
WorkingDirectory=/opt/handwerker-kalkulator
Environment=NODE_ENV=production
Environment=PORT=8090
Environment=DATA_DIR=/var/lib/handwerker-kalkulator
ExecStart=/usr/bin/node /opt/handwerker-kalkulator/server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

README mit: Einzeiler, Optionen, Features, Gewerke-Liste, Daten/Backup, Update, Deinstallation, Reboot-Test, Sicherheitshinweis (LAN, kein Login), Entwicklung (`npm start`, `npm test`), Lizenz. `LICENSE` MIT, `CHANGELOG.md` mit 1.0.0.

- [ ] **Step 4: Syntax und Tests prüfen**

Run: `bash -n install/handwerker-kalkulator.sh`
Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add install systemd README.md LICENSE CHANGELOG.md VERSION
git commit -m "Proxmox-Installer, systemd-Unit und Dokumentation"
```

---

### Task 17: Integration, Smoke-Test und Push

**Files:**
- Modify: ggf. gefundene Fehler

- [ ] **Step 1: Gesamte Testsuite**

Run: `node --test tests/`
Expected: alle Tests PASS.

- [ ] **Step 2: Server-Smoke-Test**

Run: `DATA_DIR=/tmp/hk-smoke PORT=8090 node server/server.js &`
Run: `curl -fsS http://127.0.0.1:8090/api/health`
Run: `curl -fsS http://127.0.0.1:8090/api/trades | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))"`
Expected: Health `ok:true`; 20 Trade-Packs.

- [ ] **Step 3: UI-Smoke-Test**

Browser auf `http://127.0.0.1:8090`, ein Gewerk kalkulieren, speichern, Angebot drucken, Einstellungen speichern, Reload.

- [ ] **Step 4: Installer-Syntax und lokale Struktur prüfen**

Run: `bash -n install/handwerker-kalkulator.sh`
Run: `test -f app/index.html && test -f server/server.js && test -f systemd/handwerker-kalkulator.service`
Expected: Exit 0.

- [ ] **Step 5: Commit und Push**

```bash
git add -A
git commit -m "Handwerker-Kalkulator 1.0.0"
git push origin main
```

Push nur mit vorhandener Git-Credential-Konfiguration oder temporärem Askpass; niemals Token in Remote-URL, `.git/config` oder Dateien schreiben.

---

## Self-Review

### Spec-Abdeckung

| Spec-Abschnitt | Aufgabe |
|---|---|
| 5 Architektur | 1, 2, 7 |
| 6 Repo-Struktur | 1, 16 |
| 7 Datenmodell | 2, 7, 8 |
| 8 Rechenkern | 3, 4 |
| 9 Gewerke (20) | 5, 6 |
| 10.1 Galerie | 10 |
| 10.2 Kalkulation | 10, 12 |
| 10.3 Maß-Assistent | 11 |
| 10.4 Angebot/Rechnung/PDF | 13 |
| 10.5 Vorgänge | 12 |
| 10.6 Preislisten | 14 |
| 10.7 Vorlagen | 14 |
| 10.8 Fotos | 14 |
| 10.9 Backup | 8, 14 |
| 10.10 Einstellungen | 14 |
| 10.11 PWA/Offline | 15 |
| 11 UI/Design | 9, 10 |
| 12 Server-API | 5, 7, 8 |
| 13 Persistenz | 2 |
| 14 Installer | 16 |
| 15 Tests | 1–11, 17 |
| 16 Sicherheit | 2, 7, 16 |
| 18 Akzeptanzkriterien | 17 |

### Platzhalter-Scan

Keine `TBD`/`TODO`/`FIXME`. UI-Aufgaben nennen konkrete Smoke-Checklisten statt vager „poliere die UI“-Schritte.

### Typkonsistenz

- `calculate(pack, state)` wird in Task 4 definiert und in Task 10/12 verwendet.
- `evaluateFormula(expr, scope)` wird in Task 3 definiert, in Task 4/5 verwendet.
- `createServer({ dataDir, appDir, tradesDir })` ist in Task 1 definiert und bleibt in Task 7/8 stabil.
- `createStore(dataDir)` ist in Task 2 definiert und wird in Task 7 verwendet.
- Positionsfelder (`id, label, menge, einheit, einzelpreis, gesamt, herleitung`) sind in Task 4 und Task 12 identisch.

### Review-Focus-Abdeckung

1. Division durch null → Task 3/4 Tests.
2. Transport Volumen + Gewicht → Task 4 Test.
3. Deutsches Dezimalkomma → Task 3 Test, Task 9 `parseGermanNumber`.
4. Ergiebigkeit null → Task 4 Test, Task 5 Validierung.
5. Defekter Import → Task 8 Test.
