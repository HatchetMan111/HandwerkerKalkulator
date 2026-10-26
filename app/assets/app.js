import { api } from './api.js';

const GROUPS = ['Bau & Außen', 'Ausbau & Hochbau', 'Dienstleistung & Sonstiges'];
const app = document.getElementById('app');
app.tabIndex = -1;
let renderToken = 0;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[char]);

const normalise = (value) => String(value ?? '').toLocaleLowerCase('de-DE');

function setActiveNav(route) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const target = link.getAttribute('href')?.slice(1) || '/';
    const active = target === '/'
      ? route === '/' || route.startsWith('/kalkulation')
      : route === target || route.startsWith(`${target}/`);
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderError(err) {
  app.innerHTML = `
    <section class="state state--error" role="alert">
      <p class="eyebrow">Das hat nicht geklappt</p>
      <h1>Die Daten konnten nicht geladen werden.</h1>
      <p>${escapeHtml(err.message || 'Unbekannter Fehler')}</p>
      <button class="button button--primary" type="button" data-retry>Erneut versuchen</button>
    </section>`;
  app.querySelector('[data-retry]')?.addEventListener('click', () => router());
}

function tradeCard(trade) {
  const search = normalise(`${trade.name} ${trade.beschreibung || ''} ${trade.gruppe || ''}`);
  return `
    <a class="trade-card" href="#/kalkulation/${encodeURIComponent(trade.id)}" data-search="${escapeHtml(search)}">
      <span class="trade-card__mark" aria-hidden="true">${escapeHtml(String(trade.name || '?').slice(0, 1))}</span>
      <span class="trade-card__body">
        <strong>${escapeHtml(trade.name)}</strong>
        <span>${escapeHtml(trade.beschreibung || 'Kalkulation öffnen')}</span>
      </span>
      <span class="trade-card__arrow" aria-hidden="true">→</span>
    </a>`;
}

async function renderHome(token) {
  app.innerHTML = `
    <section class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Kalkulation ohne Tabellenchaos</p>
        <h1>Angebote, die Hand und Fuß haben.</h1>
        <p class="lead">Gewerk wählen, Mengen eintragen, Material und Stunden kalkulieren – fertig.</p>
        <div class="hero__actions">
          <a class="button button--primary" href="#/kalkulation/maler">Kalkulation starten</a>
          <a class="button button--ghost" href="#/vorgaenge">Vorgänge ansehen</a>
        </div>
      </div>
      <aside class="hero__panel" aria-label="Überblick">
        <div><strong>20</strong><span>Gewerke</span></div>
        <div><strong>7</strong><span>Ressourcentypen</span></div>
        <div><strong>1</strong><span>Datenquelle</span></div>
      </aside>
    </section>
    <section class="section" aria-labelledby="gewerke-title">
      <div class="section__head">
        <div>
          <p class="eyebrow">Gewerke</p>
          <h2 id="gewerke-title">Was möchtest du kalkulieren?</h2>
        </div>
        <label class="search">
          <span class="search__label">Gewerk suchen</span>
          <input id="trade-search" type="search" placeholder="z. B. Fliesen, Dach, Reinigung" autocomplete="off">
        </label>
      </div>
      <div id="trade-groups" aria-live="polite">
        <p class="muted">Gewerke werden geladen …</p>
      </div>
    </section>`;

  const trades = await api.get('/api/trades');
  if (token !== renderToken) return;

  const grouped = new Map(GROUPS.map((group) => [group, []]));
  for (const trade of trades) {
    const group = grouped.has(trade.gruppe) ? trade.gruppe : 'Weitere Gewerke';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(trade);
  }

  const html = [...grouped.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([group, items]) => `
      <section class="group" data-group>
        <h3>${escapeHtml(group)}</h3>
        <div class="trade-grid">
          ${items.map(tradeCard).join('')}
        </div>
      </section>`)
    .join('');

  const groups = document.getElementById('trade-groups');
  groups.innerHTML = html || '<p class="muted">Keine Gewerke gefunden.</p>';
  groups.insertAdjacentHTML('beforeend', '<p class="muted" id="trade-empty" hidden>Kein Gewerk passt zu deiner Suche.</p>');

  const search = document.getElementById('trade-search');
  search?.addEventListener('input', () => {
    const query = normalise(search.value).trim();
    let visible = 0;
    document.querySelectorAll('[data-group]').forEach((section) => {
      let groupVisible = 0;
      section.querySelectorAll('.trade-card').forEach((card) => {
        const match = !query || card.dataset.search.includes(query);
        card.hidden = !match;
        if (match) groupVisible += 1;
      });
      section.hidden = groupVisible === 0;
      visible += groupVisible;
    });
    const empty = document.getElementById('trade-empty');
    if (empty) empty.hidden = visible !== 0;
  });
}

function placeholder(title, text) {
  app.innerHTML = `
    <section class="state">
      <p class="eyebrow">In Arbeit</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>
      <a class="button button--ghost" href="#/">Zur Gewerke-Übersicht</a>
    </section>`;
}

function renderHelp() {
  app.innerHTML = `
    <section class="prose">
      <p class="eyebrow">Hilfe</p>
      <h1>So funktioniert der Kalkulator</h1>
      <h2>Kalkulieren</h2>
      <p>Wähle ein Gewerk, trage die Mengen ein und prüfe die vorgeschlagenen Preise. Jede Position zeigt Menge, Einheit und Herleitung.</p>
      <h2>Speichern</h2>
      <p>Vorgänge werden lokal auf deinem Server gespeichert. Ein Export-Bundle sichert Jobs, Preislisten, Vorlagen und Einstellungen.</p>
      <h2>Bedienung</h2>
      <p>Alle Bereiche sind per Tastatur erreichbar. Fokusringe sind sichtbar, Schaltflächen mindestens 44 Pixel groß.</p>
      <a class="button button--ghost" href="#/">Zur Startseite</a>
    </section>`;
}

async function router() {
  const token = ++renderToken;
  const route = (location.hash || '#/').slice(1) || '/';
  setActiveNav(route);
  try {
    if (route === '/') await renderHome(token);
    else if (route.startsWith('/kalkulation/')) {
      placeholder('Kalkulation', 'Das Kalkulationsformular wird im nächsten Schritt ausgebaut.');
    } else if (route === '/vorgaenge') {
      placeholder('Vorgänge', 'Die Vorgangsliste wird im nächsten Schritt ausgebaut.');
    } else if (route.startsWith('/vorgang/')) {
      placeholder('Vorgang', 'Die Vorgangsdetails werden im nächsten Schritt ausgebaut.');
    } else if (route === '/preislisten') {
      placeholder('Preislisten', 'Preislisten werden im nächsten Schritt ausgebaut.');
    } else if (route === '/vorlagen') {
      placeholder('Vorlagen', 'Vorlagen werden im nächsten Schritt ausgebaut.');
    } else if (route === '/einstellungen') {
      placeholder('Einstellungen', 'Die Einstellungen werden im nächsten Schritt ausgebaut.');
    } else if (route === '/hilfe') {
      renderHelp();
    } else {
      placeholder('Seite nicht gefunden', 'Diese Adresse gibt es nicht.');
    }
  } catch (err) {
    if (token === renderToken) renderError(err);
  }
  if (token === renderToken) app.focus({ preventScroll: true });
}

window.addEventListener('hashchange', router);
router();
