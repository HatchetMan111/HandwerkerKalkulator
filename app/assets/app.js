import { api } from './api.js';
import { calculate, FormulaError } from './engine.js';
import { formatNumber, formatCurrency, parseGermanNumber } from './formats.js';

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

const inputValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).replace('.', ',');
  return String(value ?? '');
};

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

function renderField(item, scope, value, options = {}) {
  const fieldId = `field-${scope}-${item.id}`;
  const errorId = `err-${scope}-${item.id}`;
  const helpId = `help-${scope}-${item.id}`;
  const min = item.min ?? options.min;
  const max = item.max ?? options.max;
  const describedBy = [item.hilfe ? helpId : '', errorId].filter(Boolean).join(' ');
  const help = item.hilfe
    ? `<p class="field__help" id="${helpId}">${escapeHtml(item.hilfe)}</p>`
    : '';
  const label = `<label class="field__label" for="${fieldId}">${escapeHtml(item.label)}</label>`;

  let control;
  if (item.art === 'auswahl') {
    const choices = (item.optionen || []).map((option) => {
      const optionValue = typeof option === 'string' ? option : (option.wert ?? option.value ?? option.id ?? '');
      const optionLabel = typeof option === 'string' ? option : (option.label ?? optionValue);
      return `<option value="${escapeHtml(optionValue)}"${String(value) === String(optionValue) ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
    }).join('');
    control = `<select id="${fieldId}" class="field__input" data-scope="${scope}" data-id="${escapeHtml(item.id)}" aria-describedby="${describedBy}">
      ${choices || '<option value="">Bitte wählen</option>'}
    </select>`;
  } else {
    const attrs = [
      `id="${fieldId}"`,
      'class="field__input"',
      'type="text"',
      'inputmode="decimal"',
      'autocomplete="off"',
      `value="${escapeHtml(inputValue(value))}"`,
      `data-scope="${scope}"`,
      `data-id="${escapeHtml(item.id)}"`,
      min !== undefined ? `data-min="${min}"` : '',
      max !== undefined ? `data-max="${max}"` : '',
      `aria-describedby="${describedBy}"`,
    ].filter(Boolean).join(' ');
    control = `<span class="field__control">
      <input ${attrs}>
      ${item.einheit ? `<span class="field__unit">${escapeHtml(item.einheit)}</span>` : ''}
    </span>`;
  }

  return `
    <div class="field">
      ${label}
      ${control}
      ${help}
      <span class="field__error" id="${errorId}" role="alert" hidden></span>
    </div>`;
}

function createCalcState(pack) {
  const state = { eingaben: {}, faktoren: {}, preise: {} };
  for (const input of pack.eingaben || []) {
    state.eingaben[input.id] = input.standard ?? (input.art === 'auswahl' ? '' : 0);
  }
  for (const factor of pack.faktoren || []) {
    state.faktoren[factor.id] = factor.standard ?? 0;
  }
  state.preise.mwst = pack.preise?.mwst ?? 19;
  state.preise.marge = pack.preise?.marge ?? 0;
  if (pack.preise?.anfahrt && !('anfahrtKm' in state.eingaben)) state.eingaben.anfahrtKm = 0;
  return state;
}

function fieldError(el) {
  if (el.tagName === 'SELECT') return el.value ? null : 'Bitte eine Auswahl treffen.';
  const raw = el.value.trim();
  if (raw === '') return 'Bitte eine Zahl eingeben.';
  const value = parseGermanNumber(raw);
  if (value === null) return 'Bitte eine gültige Zahl eingeben.';
  const unit = el.closest('.field')?.querySelector('.field__unit')?.textContent?.trim() || '';
  const suffix = unit ? ` ${unit}` : '';
  if (el.dataset.min !== undefined && value < Number(el.dataset.min)) {
    const min = Number(el.dataset.min);
    return `Mindestens ${formatNumber(min, Number.isInteger(min) ? 0 : 2)}${suffix}.`;
  }
  if (el.dataset.max !== undefined && value > Number(el.dataset.max)) {
    const max = Number(el.dataset.max);
    return `Höchstens ${formatNumber(max, Number.isInteger(max) ? 0 : 2)}${suffix}.`;
  }
  return null;
}

function syncState(form, state) {
  let ok = true;
  for (const el of form.querySelectorAll('[data-scope]')) {
    const scope = el.dataset.scope;
    const id = el.dataset.id;
    const errorId = `err-${scope}-${id}`;
    const errorEl = document.getElementById(errorId);
    const error = fieldError(el);
    if (error) {
      ok = false;
      el.setAttribute('aria-invalid', 'true');
      if (errorEl) {
        errorEl.textContent = error;
        errorEl.hidden = false;
      }
    } else {
      el.removeAttribute('aria-invalid');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.hidden = true;
      }
      state[scope][id] = el.tagName === 'SELECT' ? el.value : parseGermanNumber(el.value);
    }
  }
  return ok;
}

function showResultMessage(container, message) {
  container.innerHTML = `
    <section class="panel result-panel" data-result-error>
      <p class="eyebrow">Ergebnis</p>
      <h2>Bitte Eingaben prüfen</h2>
      <p class="result-message">${escapeHtml(message)}</p>
    </section>`;
}

function renderResult(container, result) {
  const rows = result.positionen.map((position) => {
    const decimals = Number.isInteger(position.menge) ? 0 : 2;
    return `
      <tr>
        <td>
          <div class="position-label">${escapeHtml(position.label)}</div>
          <div class="position-meta-mobile">${formatCurrency(position.einzelpreis)}${position.einheit ? ` / ${escapeHtml(position.einheit)}` : ''}</div>
          <details class="position-details">
            <summary>Herleitung</summary>
            <code>${escapeHtml(position.herleitung || '')}</code>
          </details>
        </td>
        <td class="num">${formatNumber(position.menge, decimals)} ${escapeHtml(position.einheit || '')}</td>
        <td class="num">${formatCurrency(position.einzelpreis)}</td>
        <td class="num result-strong">${formatCurrency(position.gesamt)}</td>
      </tr>`;
  }).join('');

  const row = (label, value, className = '') => `
    <div class="summary__row ${className}"><dt>${label}</dt><dd>${value}</dd></div>`;

  container.innerHTML = `
    <section class="panel result-panel">
      <div class="result-head">
        <div>
          <p class="eyebrow">Ergebnis</p>
          <h2>Kalkulation</h2>
        </div>
        <span class="result-badge">${result.positionen.length} Positionen</span>
      </div>
      <div class="table-wrap">
        <table class="position-table">
          <thead>
            <tr><th>Position</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" class="muted">Noch keine Positionen. Trage eine Menge ein.</td></tr>'}</tbody>
        </table>
      </div>
      <dl class="summary">
        ${row('Zwischensumme', formatCurrency(result.summen.zwischensumme))}
        ${row('Anfahrt', formatCurrency(result.summen.anfahrt))}
        ${row('Marge', formatCurrency(result.summen.marge))}
        ${result.summen.mindestpreis > 0 ? row('Mindestpreis', formatCurrency(result.summen.mindestpreis)) : ''}
        ${row('Netto', formatCurrency(result.summen.netto))}
        ${row(`MwSt. (${formatNumber(result.summen.mwstSatz, 0)} %)`, formatCurrency(result.summen.mwst))}
        ${row('Gesamt', formatCurrency(result.summen.gesamt), 'summary__row--total')}
      </dl>
      ${(result.hinweise || []).map((hinweis) => `<p class="result-hint">${escapeHtml(hinweis)}</p>`).join('')}
      <p class="result-note">Alle Beträge in Euro. Preise sind Vorschläge und im Betrieb zu prüfen.</p>
    </section>`;
}

async function renderKalkulation(packId, token) {
  const packs = await api.get('/api/trades');
  if (token !== renderToken) return;
  const pack = packs.find((entry) => entry.id === packId);
  if (!pack) {
    placeholder('Gewerk nicht gefunden', 'Dieses Gewerk gibt es nicht oder es wurde entfernt.');
    return;
  }

  const state = createCalcState(pack);
  const anfahrtInput = (pack.eingaben || []).find((input) => input.id === 'anfahrtKm');
  const anfahrtFeld = anfahrtInput || {
    id: 'anfahrtKm',
    label: 'Anfahrt (einfach)',
    art: 'anzahl',
    einheit: 'km',
  };
  const hasAnfahrt = Boolean(pack.preise?.anfahrt || anfahrtInput);
  const inputs = (pack.eingaben || []).filter((input) => input.id !== 'anfahrtKm');
  const factors = pack.faktoren || [];
  const anfahrtNote = pack.preise?.anfahrt
    ? `Anfahrt: ${formatCurrency(pack.preise.anfahrt.preisProKm || 0)}/km${pack.preise.anfahrt.hinUndZurueck ? ' (hin und zurück)' : ''}.`
    : '';
  const mindestNote = pack.preise?.mindestpreis
    ? `Mindestpreis: ${formatCurrency(pack.preise.mindestpreis)} netto.`
    : '';

  app.innerHTML = `
    <section class="calc-head">
      <a class="back-link" href="#/">← Alle Gewerke</a>
      <p class="eyebrow">${escapeHtml(pack.gruppe || 'Kalkulation')}</p>
      <h1>${escapeHtml(pack.name)}</h1>
      <p class="lead">${escapeHtml(pack.beschreibung || 'Mengen eingeben, Preise prüfen, Ergebnis sehen.')}</p>
    </section>
    <div class="calc-layout">
      <form class="calc-form" id="calc-form" novalidate>
        <section class="panel">
          <div class="panel__head">
            <div><h2>Eingaben</h2><p>Mengen und Maße</p></div>
          </div>
          <div class="fields">
            ${inputs.map((input) => renderField(input, 'eingaben', state.eingaben[input.id])).join('') || '<p class="muted">Keine Eingaben nötig.</p>'}
          </div>
        </section>
        ${factors.length ? `
          <section class="panel">
            <div class="panel__head">
              <div><h2>Faktoren</h2><p>Vorschläge im Betrieb prüfen</p></div>
            </div>
            <div class="fields fields--three">
              ${factors.map((factor) => renderField(factor, 'faktoren', state.faktoren[factor.id])).join('')}
            </div>
          </section>` : ''}
        <section class="panel">
          <div class="panel__head">
            <div><h2>Preise</h2><p>MwSt., Marge und Anfahrt</p></div>
          </div>
          <div class="fields fields--three">
            ${renderField({ id: 'mwst', label: 'MwSt.', art: 'anzahl', einheit: '%' }, 'preise', state.preise.mwst, { min: 0, max: 100 })}
            ${renderField({ id: 'marge', label: 'Marge', art: 'anzahl', einheit: '%' }, 'preise', state.preise.marge, { min: 0, max: 200 })}
            ${hasAnfahrt ? renderField(anfahrtFeld, 'eingaben', state.eingaben.anfahrtKm, { min: 0 }) : ''}
          </div>
          ${anfahrtNote || mindestNote ? `<div class="price-notes">${anfahrtNote ? `<p>${escapeHtml(anfahrtNote)}</p>` : ''}${mindestNote ? `<p>${escapeHtml(mindestNote)}</p>` : ''}</div>` : ''}
        </section>
      </form>
      <aside class="calc-result" id="calc-result" aria-live="polite"></aside>
    </div>`;

  const form = document.getElementById('calc-form');
  const result = document.getElementById('calc-result');
  const recalc = () => {
    if (!syncState(form, state)) {
      showResultMessage(result, 'Bitte korrigiere die markierten Felder.');
      return;
    }
    try {
      renderResult(result, calculate(pack, state));
    } catch (err) {
      showResultMessage(result, err instanceof FormulaError ? err.message : 'Die Berechnung ist nicht möglich.');
    }
  };

  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);
  form.addEventListener('submit', (event) => event.preventDefault());
  recalc();
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
      let packId = '';
      try {
        packId = decodeURIComponent(route.slice('/kalkulation/'.length));
      } catch {
        packId = '';
      }
      if (packId) await renderKalkulation(packId, token);
      else placeholder('Kalkulation', 'Bitte wähle ein Gewerk aus.');
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
