import { api } from './api.js';
import { calculate, FormulaError } from './engine.js';
import { formatNumber, formatCurrency, formatDate, parseGermanNumber } from './formats.js';
import { rectangleArea, lShapeArea, triangleArea, polygonArea, parseSpokenMeasurement } from './measure.js';

const GROUPS = ['Bau & Außen', 'Ausbau & Hochbau', 'Dienstleistung & Sonstiges'];
const DEFAULT_TITLE = 'Handwerker-Kalkulator';
const app = document.getElementById('app');
app.tabIndex = -1;
let renderToken = 0;
let measureCleanup = null;

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
      : route === target
        || route.startsWith(`${target}/`)
        || (target === '/vorgaenge' && route.startsWith('/vorgang/'));
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

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function stopMeasure() {
  if (!measureCleanup) return;
  const cleanup = measureCleanup;
  measureCleanup = null;
  try {
    cleanup();
  } catch {
    // Der Assistent ist bereits beendet.
  }
}

function setMeasureMessage(details, text, type = 'info') {
  const message = details.querySelector('[data-measure-message]');
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
}

function measureInput(name, label, unit = 'm') {
  return `
    <label class="measure__field">
      <span class="field__label">${escapeHtml(label)}</span>
      <span class="field__control">
        <input class="field__input" type="text" inputmode="decimal" autocomplete="off" data-measure-input="${name}">
        <span class="field__unit">${escapeHtml(unit)}</span>
      </span>
    </label>`;
}

function measureAssistant(fieldId) {
  const speech = Boolean(getSpeechRecognition());
  return `
    <details class="measure" data-measure data-target="${escapeHtml(fieldId)}">
      <summary>Maß-Assistent</summary>
      <div class="measure__actions">
        <button type="button" class="chip" data-measure-mode="rectangle">Rechteck</button>
        <button type="button" class="chip" data-measure-mode="lshape">L-Form</button>
        <button type="button" class="chip" data-measure-mode="triangle">Dreieck</button>
        <button type="button" class="chip" data-measure-mode="gps">GPS</button>
        ${speech ? '<button type="button" class="chip" data-measure-mode="speech">Diktieren</button>' : ''}
      </div>
      <div class="measure__panel" data-measure-panel hidden></div>
    </details>`;
}

function readMeasure(panel, name) {
  const input = panel.querySelector(`[data-measure-input="${name}"]`);
  return input ? parseGermanNumber(input.value) : null;
}

function applyMeasuredArea(details, area, source = '') {
  const target = document.getElementById(details.dataset.target);
  if (!target) {
    setMeasureMessage(details, 'Das Zielfeld wurde nicht gefunden.', 'error');
    return;
  }
  const value = Math.round(Number(area) * 100) / 100;
  if (!(value > 0)) {
    setMeasureMessage(details, 'Die Fläche muss größer als 0 sein.', 'error');
    return;
  }
  target.value = String(value).replace('.', ',');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus({ preventScroll: true });
  setMeasureMessage(details, `${source ? `${source}: ` : ''}${formatNumber(value, 2)} m² übernommen.`, 'success');
}

function geoErrorMessage(error) {
  if (error?.code === 1) return 'Standortfreigabe wurde abgelehnt.';
  if (error?.code === 2) return 'Standort ist gerade nicht verfügbar.';
  if (error?.code === 3) return 'Die Standortabfrage hat zu lange gedauert.';
  return 'Standort konnte nicht ermittelt werden.';
}

function openMeasurePanel(details, mode) {
  const panel = details.querySelector('[data-measure-panel]');
  if (!panel) return;
  stopMeasure();
  panel.hidden = false;

  if (mode === 'rectangle') {
    panel.innerHTML = `
      <div class="measure__grid">
        ${measureInput('laenge', 'Länge')}
        ${measureInput('breite', 'Breite')}
      </div>
      <div class="measure__footer">
        <button type="button" class="button button--primary" data-measure-apply>Fläche übernehmen</button>
        <p class="measure__message" data-measure-message role="status"></p>
      </div>`;
    panel.querySelector('[data-measure-apply]').addEventListener('click', () => {
      const laenge = readMeasure(panel, 'laenge');
      const breite = readMeasure(panel, 'breite');
      if (!(laenge > 0) || !(breite > 0)) {
        setMeasureMessage(details, 'Bitte Länge und Breite größer als 0 eingeben.', 'error');
        return;
      }
      applyMeasuredArea(details, rectangleArea(laenge, breite), 'Rechteck');
    });
    panel.querySelector('[data-measure-input="laenge"]')?.focus();
    return;
  }

  if (mode === 'lshape') {
    panel.innerHTML = `
      <div class="measure__grid">
        ${measureInput('aussenLaenge', 'Gesamtlänge')}
        ${measureInput('aussenBreite', 'Gesamtbreite')}
        ${measureInput('aussenAussparungLaenge', 'Aussparung Länge')}
        ${measureInput('aussenAussparungBreite', 'Aussparung Breite')}
      </div>
      <div class="measure__footer">
        <button type="button" class="button button--primary" data-measure-apply>Fläche übernehmen</button>
        <p class="measure__message" data-measure-message role="status"></p>
      </div>`;
    panel.querySelector('[data-measure-apply]').addEventListener('click', () => {
      const a = readMeasure(panel, 'aussenLaenge');
      const b = readMeasure(panel, 'aussenBreite');
      const c = readMeasure(panel, 'aussenAussparungLaenge');
      const d = readMeasure(panel, 'aussenAussparungBreite');
      if (!(a > 0) || !(b > 0) || !(c >= 0) || !(d >= 0)) {
        setMeasureMessage(details, 'Bitte alle vier Maße als Zahl eingeben.', 'error');
        return;
      }
      if (c * d >= a * b) {
        setMeasureMessage(details, 'Die Aussparung muss kleiner als die Gesamtfläche sein.', 'error');
        return;
      }
      applyMeasuredArea(details, lShapeArea(a, b, c, d), 'L-Form');
    });
    panel.querySelector('[data-measure-input="aussenLaenge"]')?.focus();
    return;
  }

  if (mode === 'triangle') {
    panel.innerHTML = `
      <div class="measure__grid">
        ${measureInput('grundseite', 'Grundseite')}
        ${measureInput('hoehe', 'Höhe')}
      </div>
      <div class="measure__footer">
        <button type="button" class="button button--primary" data-measure-apply>Fläche übernehmen</button>
        <p class="measure__message" data-measure-message role="status"></p>
      </div>`;
    panel.querySelector('[data-measure-apply]').addEventListener('click', () => {
      const grundseite = readMeasure(panel, 'grundseite');
      const hoehe = readMeasure(panel, 'hoehe');
      if (!(grundseite > 0) || !(hoehe > 0)) {
        setMeasureMessage(details, 'Bitte Grundseite und Höhe größer als 0 eingeben.', 'error');
        return;
      }
      applyMeasuredArea(details, triangleArea(grundseite, hoehe), 'Dreieck');
    });
    panel.querySelector('[data-measure-input="grundseite"]')?.focus();
    return;
  }

  if (mode === 'gps') {
    panel.innerHTML = `
      <p class="measure__readout" data-gps-status>Starte die Aufzeichnung und laufe die Fläche einmal ab.</p>
      <div class="measure__actions">
        <button type="button" class="chip" data-gps-start>GPS starten</button>
        <button type="button" class="chip" data-gps-stop disabled>Stoppen</button>
        <button type="button" class="button button--primary" data-gps-apply disabled>Fläche übernehmen</button>
      </div>
      <p class="measure__message" data-measure-message role="status"></p>`;
    const status = panel.querySelector('[data-gps-status]');
    const start = panel.querySelector('[data-gps-start]');
    const stop = panel.querySelector('[data-gps-stop]');
    const apply = panel.querySelector('[data-gps-apply]');
    const points = [];
    let watchId = null;

    const update = () => {
      const area = polygonArea(points);
      const punkteLabel = points.length === 1 ? '1 Punkt' : `${points.length} Punkte`;
      status.textContent = points.length
        ? `${punkteLabel} aufgezeichnet. Fläche: ${formatNumber(area, 2)} m².`
        : 'Starte die Aufzeichnung und laufe die Fläche einmal ab.';
      apply.disabled = points.length < 3 || area <= 0;
    };

    const stopWatch = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      start.disabled = false;
      stop.disabled = true;
      if (measureCleanup === cleanup) measureCleanup = null;
    };

    const cleanup = () => stopWatch();

    start.addEventListener('click', () => {
      if (!navigator.geolocation) {
        setMeasureMessage(details, 'GPS ist in diesem Browser nicht verfügbar.', 'error');
        return;
      }
      stopMeasure();
      points.length = 0;
      update();
      start.disabled = true;
      stop.disabled = false;
      setMeasureMessage(details, 'Standort wird aufgezeichnet. Bitte die Fläche umlaufen.', 'info');
      try {
        watchId = navigator.geolocation.watchPosition((position) => {
          points.push({ lat: position.coords.latitude, lon: position.coords.longitude });
          update();
        }, (error) => {
          setMeasureMessage(details, geoErrorMessage(error), 'error');
          stopWatch();
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        measureCleanup = cleanup;
      } catch {
        setMeasureMessage(details, 'GPS konnte nicht gestartet werden.', 'error');
        stopWatch();
      }
    });

    stop.addEventListener('click', () => {
      stopWatch();
      update();
      setMeasureMessage(details, points.length >= 3
        ? 'GPS gestoppt. Die Fläche kann jetzt übernommen werden.'
        : 'GPS gestoppt. Bitte mindestens drei Punkte aufzeichnen.', points.length >= 3 ? 'success' : 'error');
    });

    apply.addEventListener('click', () => {
      const area = polygonArea(points);
      if (area <= 0) {
        setMeasureMessage(details, 'Die aufgezeichnete Fläche ist noch zu klein.', 'error');
        return;
      }
      applyMeasuredArea(details, area, `GPS (${points.length} Punkte)`);
      stopWatch();
    });

    return;
  }

  if (mode === 'speech') {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      panel.innerHTML = '<p class="measure__message" data-measure-message role="status">Spracherkennung ist in diesem Browser nicht verfügbar.</p>';
      return;
    }
    panel.innerHTML = `
      <p class="measure__readout" data-speech-status>Ich höre zu …</p>
      <p class="measure__message" data-measure-message role="status">Sage zum Beispiel „zwölf Meter mal acht Meter“ oder „zwölf Quadratmeter“.</p>`;
    const recognition = new Recognition();
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    const cleanup = () => {
      try {
        recognition.abort();
      } catch {
        // Die Erkennung ist bereits beendet.
      }
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      const measurement = parseSpokenMeasurement(transcript);
      if (measurement.flaeche > 0) {
        applyMeasuredArea(details, measurement.flaeche, `Diktat „${transcript}“`);
      } else if (measurement.laenge > 0 && measurement.breite > 0) {
        applyMeasuredArea(details, rectangleArea(measurement.laenge, measurement.breite), `Diktat „${transcript}“`);
      } else {
        setMeasureMessage(details, `Erkannt: „${transcript}“. Bitte Länge und Breite nennen.`, 'error');
      }
    };

    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'Mikrofonzugriff wurde abgelehnt.',
        'service-not-allowed': 'Spracherkennung ist nicht erlaubt.',
        'no-speech': 'Keine Sprache erkannt.',
        'audio-capture': 'Kein Mikrofon gefunden.',
      };
      setMeasureMessage(details, messages[event.error] || 'Spracherkennung ist fehlgeschlagen.', 'error');
      if (measureCleanup === cleanup) measureCleanup = null;
    };

    recognition.onend = () => {
      const speechStatus = panel.querySelector('[data-speech-status]');
      if (speechStatus) speechStatus.textContent = 'Diktat beendet.';
      if (measureCleanup === cleanup) measureCleanup = null;
    };

    measureCleanup = cleanup;
    try {
      recognition.start();
    } catch {
      setMeasureMessage(details, 'Das Mikrofon konnte nicht gestartet werden.', 'error');
      if (measureCleanup === cleanup) measureCleanup = null;
    }
    return;
  }

  panel.innerHTML = '<p class="measure__message" data-measure-message role="status">Diesen Assistenten gibt es nicht.</p>';
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
      ${item.art === 'flaeche' ? measureAssistant(fieldId) : ''}
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

const DRAFT_KEY = 'hk_entwurf';
const STATUS_LABELS = {
  entwurf: 'Entwurf',
  angebot: 'Angebot',
  auftrag: 'Auftragsbestätigung',
  auftragsbestaetigung: 'Auftragsbestätigung',
  rechnung: 'Rechnung',
  abgeschlossen: 'Abgeschlossen',
  bezahlt: 'Bezahlt',
  storniert: 'Storniert',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Entwurf';
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && draft.packId && draft.state ? draft : null;
  } catch {
    return null;
  }
}

function writeDraft(payload) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Lokaler Speicher kann im privaten Modus gesperrt sein.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Siehe writeDraft.
  }
}

function draftTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unbekannter Zeit';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function applyJobState(state, job) {
  for (const scope of ['eingaben', 'faktoren', 'preise']) {
    const values = job?.[scope];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [id, value] of Object.entries(values)) {
      if (Object.prototype.hasOwnProperty.call(state[scope], id)) state[scope][id] = value;
    }
  }
  return state;
}

function applyDraftToForm(form, state, draft, titleInput, jobMeta) {
  for (const scope of ['eingaben', 'faktoren', 'preise']) {
    const values = draft.state?.[scope];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [id, value] of Object.entries(values)) {
      const el = [...form.querySelectorAll(`[data-scope="${scope}"]`)].find((entry) => entry.dataset.id === id);
      if (!el) continue;
      el.value = el.tagName === 'SELECT' ? value : inputValue(value);
      state[scope][id] = value;
    }
  }
  for (const group of ['kunde', 'baustelle']) {
    const values = draft.meta?.[group];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      const el = [...form.querySelectorAll('[data-meta]')].find((entry) => entry.dataset.meta === `${group}.${key}`);
      if (!el) continue;
      el.value = value ?? '';
      if (jobMeta[group]) jobMeta[group][key] = String(value ?? '');
    }
  }
  if (draft.titel) titleInput.value = draft.titel;
}

function addressSource(value, kind) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value === 'string' && value.trim()) {
    return kind === 'kunde' ? { name: value } : { hinweis: value };
  }
  return {};
}

function createJobMeta(job) {
  return {
    kunde: {
      name: '', firma: '', strasse: '', plz: '', ort: '',
      ...addressSource(job?.kunde, 'kunde'),
    },
    baustelle: {
      strasse: '', plz: '', ort: '', hinweis: '',
      ...addressSource(job?.baustelle, 'baustelle'),
    },
  };
}

function metaField(label, path, value, placeholder = '') {
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      <span class="field__control">
        <input class="field__input" type="text" data-meta="${path}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      </span>
    </label>`;
}

function renderMetaPanel(jobMeta) {
  const filled = [...Object.values(jobMeta.kunde), ...Object.values(jobMeta.baustelle)].some((value) => String(value || '').trim());
  return `
    <details class="panel" data-meta-panel${filled ? ' open' : ''}>
      <summary class="panel__head">
        <h2>Kunde &amp; Baustelle</h2>
        <span class="muted">${filled ? 'Für den Druck hinterlegt' : 'Optional für den Druck'}</span>
      </summary>
      <div class="fields">
        ${metaField('Kunde – Name', 'kunde.name', jobMeta.kunde.name, 'z. B. Erika Mustermann')}
        ${metaField('Kunde – Firma', 'kunde.firma', jobMeta.kunde.firma)}
        ${metaField('Kunde – Straße', 'kunde.strasse', jobMeta.kunde.strasse)}
        ${metaField('Kunde – PLZ', 'kunde.plz', jobMeta.kunde.plz)}
        ${metaField('Kunde – Ort', 'kunde.ort', jobMeta.kunde.ort)}
        ${metaField('Baustelle – Straße', 'baustelle.strasse', jobMeta.baustelle.strasse)}
        ${metaField('Baustelle – PLZ', 'baustelle.plz', jobMeta.baustelle.plz)}
        ${metaField('Baustelle – Ort', 'baustelle.ort', jobMeta.baustelle.ort)}
        ${metaField('Baustelle – Hinweis', 'baustelle.hinweis', jobMeta.baustelle.hinweis)}
      </div>
    </details>`;
}

function jobRow(job) {
  const title = job.titel || job.gewerkName || job.gewerkId || 'Ohne Titel';
  const gewerk = job.gewerkName || job.gewerkId || 'Gewerk';
  const status = job.status || 'entwurf';
  const total = Number(job.summen?.gesamt);
  const customer = job.kunde && typeof job.kunde === 'object'
    ? (job.kunde.firma || job.kunde.name || '')
    : (job.kunde || '');
  const site = job.baustelle && typeof job.baustelle === 'object'
    ? [job.baustelle.strasse, job.baustelle.ort].filter(Boolean).join(' ')
    : (job.baustelle || '');
  const search = normalise(`${title} ${gewerk} ${customer} ${site} ${statusLabel(status)}`);
  const statusClass = String(status).replace(/[^a-z0-9_-]/gi, '');
  return `
    <article class="job-row" data-job data-status="${escapeHtml(status)}" data-search="${escapeHtml(search)}">
      <div class="job-row__main">
        <div class="job-row__meta">
          <span class="status status--${escapeHtml(statusClass)}">${escapeHtml(statusLabel(status))}</span>
          <span>${escapeHtml(gewerk)}</span>
          <span>${formatDate(job.updatedAt || job.createdAt)}</span>
        </div>
        <h2><a href="#/vorgang/${encodeURIComponent(job.id)}">${escapeHtml(title)}</a></h2>
        <p>${Number.isFinite(total) ? formatCurrency(total) : 'Noch kein Betrag'}${customer ? ` · ${escapeHtml(customer)}` : ''}</p>
      </div>
      <div class="job-row__actions">
        <a class="button button--ghost button--compact" href="#/vorgang/${encodeURIComponent(job.id)}">Öffnen</a>
        <button class="button button--ghost button--compact" type="button" data-duplicate="${escapeHtml(job.id)}">Duplizieren</button>
        <button class="button button--ghost button--compact button--danger" type="button" data-delete="${escapeHtml(job.id)}">Löschen</button>
      </div>
    </article>`;
}

async function renderVorgaenge(token) {
  app.innerHTML = `
    <section class="page-head">
      <p class="eyebrow">Vorgänge</p>
      <div class="page-head__row">
        <div>
          <h1>Vorgänge</h1>
          <p class="lead">Kalkulationen speichern, wiederfinden und als Grundlage für Angebote nutzen.</p>
        </div>
        <a class="button button--primary" href="#/">Neue Kalkulation</a>
      </div>
    </section>
    <p class="job-feedback" id="job-feedback" role="status"></p>
    <div id="job-list" aria-live="polite"><p class="muted">Vorgänge werden geladen …</p></div>`;

  const jobs = await api.get('/api/jobs');
  if (token !== renderToken) return;

  const container = document.getElementById('job-list');
  if (!container) return;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    container.innerHTML = `
      <section class="state">
        <p class="eyebrow">Noch leer</p>
        <h2>Der erste Vorgang wartet.</h2>
        <p>Starte eine Kalkulation und speichere sie als Vorgang.</p>
        <a class="button button--primary" href="#/">Gewerk wählen</a>
      </section>`;
    return;
  }

  const sorted = [...jobs].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const statuses = [...new Set(sorted.map((job) => job.status || 'entwurf'))];
  const options = statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</option>`).join('');

  container.innerHTML = `
    <div class="list-tools">
      <label class="search">
        <span class="search__label">Vorgang suchen</span>
        <input id="job-search" type="search" placeholder="Titel, Gewerk oder Kunde" autocomplete="off">
      </label>
      <label class="filter">
        <span class="filter__label">Status</span>
        <select id="job-status">
          <option value="">Alle</option>
          ${options}
        </select>
      </label>
    </div>
    <p class="list-summary" id="job-summary"></p>
    <div class="job-list" data-job-list>
      ${sorted.map(jobRow).join('')}
    </div>
    <p class="job-empty" data-job-empty hidden>Kein Vorgang passt zur Suche.</p>`;

  const search = document.getElementById('job-search');
  const statusSelect = document.getElementById('job-status');
  const summary = document.getElementById('job-summary');
  const empty = container.querySelector('[data-job-empty]');
  const list = container.querySelector('[data-job-list]');

  const filterJobs = () => {
    const query = normalise(search?.value);
    const status = statusSelect?.value || '';
    let visible = 0;
    list.querySelectorAll('[data-job]').forEach((row) => {
      const matchesQuery = !query || normalise(row.dataset.search).includes(query);
      const matchesStatus = !status || row.dataset.status === status;
      row.hidden = !(matchesQuery && matchesStatus);
      if (!row.hidden) visible += 1;
    });
    if (summary) summary.textContent = `${visible} von ${sorted.length} ${sorted.length === 1 ? 'Vorgang' : 'Vorgängen'}`;
    if (empty) empty.hidden = visible > 0;
  };

  const feedback = (message, type = 'error') => {
    const el = document.getElementById('job-feedback');
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
  };

  search?.addEventListener('input', filterJobs);
  statusSelect?.addEventListener('change', filterJobs);

  list.addEventListener('click', async (event) => {
    const duplicate = event.target.closest('[data-duplicate]');
    if (duplicate) {
      const id = duplicate.dataset.duplicate;
      const source = sorted.find((job) => job.id === id);
      if (!source) return;
      duplicate.disabled = true;
      try {
        const copy = { ...source };
        delete copy.id;
        delete copy.createdAt;
        delete copy.updatedAt;
        delete copy.status;
        for (const key of Object.keys(copy)) {
          if (/nummer/i.test(key)) delete copy[key];
        }
        await api.post('/api/jobs', { ...copy, titel: `${source.titel || source.gewerkName || 'Vorgang'} (Kopie)` });
        if (token !== renderToken) return;
        await renderVorgaenge(token);
      } catch (err) {
        duplicate.disabled = false;
        feedback(err.message || 'Der Vorgang konnte nicht dupliziert werden.');
      }
      return;
    }

    const remove = event.target.closest('[data-delete]');
    if (remove) {
      const id = remove.dataset.delete;
      const source = sorted.find((job) => job.id === id);
      if (!source) return;
      const title = source.titel || source.gewerkName || 'Vorgang';
      if (!window.confirm(`Vorgang „${title}“ wirklich löschen?`)) return;
      remove.disabled = true;
      try {
        await api.del(`/api/jobs/${encodeURIComponent(id)}`);
        if (token !== renderToken) return;
        await renderVorgaenge(token);
      } catch (err) {
        remove.disabled = false;
        feedback(err.message || 'Der Vorgang konnte nicht gelöscht werden.');
      }
    }
  });

  filterJobs();
}

function printTitle(status) {
  if (status === 'rechnung' || status === 'abgeschlossen') return 'Rechnung';
  if (status === 'auftrag' || status === 'auftragsbestaetigung') return 'Auftragsbestätigung';
  return 'Angebot';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function ensurePrintNumber(job) {
  const updates = {};
  const status = job.status || 'entwurf';
  if (status === 'rechnung' || status === 'abgeschlossen') {
    if (!job.rechnungNummer) {
      if (job.nummer) {
        updates.rechnungNummer = job.nummer;
      } else {
        const nummer = await api.post('/api/nummern/rechnung');
        updates.rechnungNummer = nummer.nummer;
        updates.nummer = nummer.nummer;
      }
    }
  } else {
    if (!job.angebotNummer) {
      if (job.nummer) {
        updates.angebotNummer = job.nummer;
      } else {
        const nummer = await api.post('/api/nummern/angebot');
        updates.angebotNummer = nummer.nummer;
        updates.nummer = nummer.nummer;
      }
    }
    if (status === 'entwurf') updates.status = 'angebot';
  }
  if (Object.keys(updates).length === 0) return job;
  return api.put(`/api/jobs/${encodeURIComponent(job.id)}`, updates);
}

function printAddressBlock(value, kind) {
  const data = addressSource(value, kind);
  const lines = [];
  if (kind === 'kunde' && data.firma) lines.push(`<strong>${escapeHtml(data.firma)}</strong>`);
  if (data.name) lines.push(escapeHtml(data.name));
  if (data.strasse) lines.push(escapeHtml(data.strasse));
  const city = [data.plz, data.ort].filter(Boolean).join(' ');
  if (city) lines.push(escapeHtml(city));
  if (kind === 'baustelle' && data.hinweis) lines.push(`<span class="print-muted">${escapeHtml(data.hinweis)}</span>`);
  return lines.length ? lines.join('<br>') : '<span class="print-muted">Noch nicht hinterlegt.</span>';
}

function renderPrintView(job, settings, token) {
  const title = printTitle(job.status);
  const isInvoice = title === 'Rechnung';
  const number = isInvoice ? (job.rechnungNummer || job.nummer) : (job.angebotNummer || job.nummer);
  const numberLabel = isInvoice ? 'Rechnungsnummer' : title === 'Auftragsbestätigung' ? 'Auftragsnummer' : 'Angebotsnummer';
  const dateLabel = isInvoice ? 'Rechnungsdatum' : title === 'Auftragsbestätigung' ? 'Bestätigungsdatum' : 'Angebotsdatum';
  const docDate = isInvoice
    ? (job.rechnungsdatum || job.createdAt)
    : (job.angebotDatum || job.datum || job.createdAt);

  const firma = settings?.firma && typeof settings.firma === 'object' && !Array.isArray(settings.firma) ? settings.firma : {};
  const firmName = String(firma.name || settings?.firmenname || 'Handwerker-Kalkulator').trim();
  const firmStreet = String(firma.strasse || '').trim();
  const firmCity = [firma.plz, firma.ort].filter(Boolean).join(' ').trim();
  const firmContact = [firma.telefon, firma.email].filter(Boolean).join(' · ');
  const firmLegal = [
    firma.steuernummer ? `Steuernummer ${firma.steuernummer}` : '',
    firma.ustId ? `USt-IdNr. ${firma.ustId}` : '',
  ].filter(Boolean).join(' · ');
  const firmBank = firma.iban ? `IBAN ${firma.iban}` : '';
  const firmAddress = [firmStreet, firmCity].filter(Boolean).join(', ');

  const positions = Array.isArray(job.positionen) ? job.positionen : [];
  const rows = positions.map((position, index) => {
    const decimals = Number.isInteger(position.menge) ? 0 : 2;
    return `
      <tr>
        <td class="print-table__pos">${index + 1}</td>
        <td>
          <span class="print-table__label">${escapeHtml(position.label || 'Position')}</span>
          ${position.herleitung ? `<span class="print-table__derivation">${escapeHtml(position.herleitung)}</span>` : ''}
        </td>
        <td class="num">${formatNumber(position.menge, decimals)} ${escapeHtml(position.einheit || '')}</td>
        <td class="num">${formatCurrency(position.einzelpreis)}</td>
        <td class="num">${formatCurrency(position.gesamt)}</td>
      </tr>`;
  }).join('');

  const summen = job.summen && typeof job.summen === 'object' ? job.summen : {};
  const mwstSatz = Number(summen.mwstSatz ?? settings?.standardMwst ?? 19);
  const summaryRow = (label, value, total = false) => `
    <div class="print-summary__row${total ? ' print-summary__row--total' : ''}">
      <span>${escapeHtml(label)}</span>
      <span>${formatCurrency(value)}</span>
    </div>`;
  const summary = `
    ${summaryRow('Zwischensumme', summen.zwischensumme)}
    ${summaryRow('Anfahrt', summen.anfahrt)}
    ${summaryRow('Marge', summen.marge)}
    ${Number(summen.mindestpreis) > 0 ? summaryRow('Mindestpreis', summen.mindestpreis) : ''}
    ${summaryRow('Netto', summen.netto)}
    ${summaryRow(`MwSt. (${formatNumber(mwstSatz, 0)} %)`, summen.mwst)}
    ${summaryRow('Gesamt', summen.gesamt, true)}`;

  const days = Number(settings?.zahlungszielTage);
  const paymentDays = Number.isFinite(days) && days >= 0 ? days : 14;
  const paymentText = isInvoice
    ? `Bitte überweisen Sie den Gesamtbetrag innerhalb von ${paymentDays} Tagen ohne Abzug.`
    : `Zahlungsziel: ${paymentDays} Tage nach Auftragserteilung ohne Abzug.`;

  document.title = `${title}${number ? ` ${number}` : ''} – ${firmName}`;
  app.innerHTML = `
    <article class="print-view">
      <div class="print-toolbar no-print">
        <a class="button button--ghost button--compact" href="#/vorgang/${encodeURIComponent(job.id)}">← Vorgang</a>
        <div class="print-toolbar__actions">
          <span class="print-toolbar__status">${escapeHtml(title)}${number ? ` · ${escapeHtml(number)}` : ''}</span>
          ${isInvoice ? '' : '<button class="button button--ghost button--compact" type="button" data-to-invoice>Als Rechnung drucken</button>'}
          <button class="button button--primary button--compact" type="button" data-print>Drucken</button>
        </div>
        <p class="print-feedback" data-print-feedback role="status"></p>
      </div>

      <header class="print-head">
        <div class="print-firm">
          <span class="print-firm__mark" aria-hidden="true">HK</span>
          <div>
            <strong>${escapeHtml(firmName)}</strong>
            ${firmAddress ? `<p>${escapeHtml(firmAddress)}</p>` : ''}
            ${firmContact ? `<p>${escapeHtml(firmContact)}</p>` : ''}
          </div>
        </div>
        <div class="print-doc">
          <h1>${escapeHtml(title)}</h1>
          ${job.titel ? `<p class="print-doc__subject">${escapeHtml(job.titel)}</p>` : ''}
          <p class="print-doc__number">${escapeHtml(numberLabel)}: ${escapeHtml(number || '–')}</p>
          <p>${escapeHtml(dateLabel)}: ${formatDate(docDate)}</p>
          ${isInvoice ? `<p>Leistungsdatum: ${formatDate(job.leistungsdatum || docDate)}</p>` : ''}
          <p>Gewerk: ${escapeHtml(job.gewerkName || job.gewerkId || '–')}</p>
        </div>
      </header>

      <section class="print-addresses">
        <div>
          <h2>Kunde</h2>
          <p>${printAddressBlock(job.kunde, 'kunde')}</p>
        </div>
        <div>
          <h2>Baustelle</h2>
          <p>${printAddressBlock(job.baustelle, 'baustelle')}</p>
        </div>
      </section>

      <table class="print-table">
        <thead>
          <tr><th>Pos.</th><th>Position</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="print-muted">Keine Positionen gespeichert.</td></tr>'}</tbody>
      </table>

      <section class="print-summary">
        ${summary}
      </section>

      <section class="print-payment">
        <h2>Zahlung</h2>
        <p>${escapeHtml(paymentText)}</p>
      </section>

      ${job.notizen ? `<section class="print-notes"><h2>Hinweise</h2><p>${escapeHtml(job.notizen)}</p></section>` : ''}

      <footer class="print-footer">
        <p>${escapeHtml(firmName)}${firmAddress ? ` · ${escapeHtml(firmAddress)}` : ''}${firmContact ? ` · ${escapeHtml(firmContact)}` : ''}</p>
        ${firmLegal || firmBank ? `<p>${[firmLegal, firmBank].filter(Boolean).map(escapeHtml).join(' · ')}</p>` : ''}
      </footer>
    </article>`;

  app.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  app.querySelector('[data-to-invoice]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const feedback = app.querySelector('[data-print-feedback]');
    if (feedback) feedback.textContent = '';
    try {
      const updates = { status: 'rechnung', rechnungsdatum: todayIso(), leistungsdatum: todayIso() };
      if (job.rechnungNummer) {
        updates.nummer = job.rechnungNummer;
      } else {
        const nummer = await api.post('/api/nummern/rechnung');
        updates.nummer = nummer.nummer;
        updates.rechnungNummer = nummer.nummer;
      }
      const updated = await api.put(`/api/jobs/${encodeURIComponent(job.id)}`, updates);
      if (token !== renderToken) return;
      renderPrintView(updated, settings, token);
      window.print();
    } catch (err) {
      button.disabled = false;
      if (feedback) feedback.textContent = err.message || 'Die Rechnung konnte nicht angelegt werden.';
    }
  });
}

async function renderDruck(jobId, token) {
  let job;
  let settings;
  try {
    [job, settings] = await Promise.all([
      api.get(`/api/jobs/${encodeURIComponent(jobId)}`),
      api.get('/api/settings').catch(() => ({})),
    ]);
  } catch (err) {
    if (err.status === 404) {
      placeholder('Vorgang nicht gefunden', 'Dieser Vorgang existiert nicht oder wurde gelöscht.');
      return;
    }
    throw err;
  }
  if (token !== renderToken) return;
  job = await ensurePrintNumber(job);
  if (token !== renderToken) return;
  renderPrintView(job, settings, token);
}

async function renderKalkulation(packId, token, job = null) {
  const packs = await api.get('/api/trades');
  if (token !== renderToken) return;
  const pack = packs.find((entry) => entry.id === packId);
  if (!pack) {
    placeholder('Gewerk nicht gefunden', 'Dieses Gewerk gibt es nicht oder es wurde entfernt.');
    return;
  }

  let currentJob = job;
  const state = createCalcState(pack);
  const jobMeta = createJobMeta(currentJob);
  if (currentJob) applyJobState(state, currentJob);
  const draft = readDraft();
  const canOfferDraft = Boolean(draft && draft.packId === pack.id && (!draft.jobId || draft.jobId === currentJob?.id));
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
      <p class="eyebrow">${currentJob ? 'Vorgang bearbeiten' : escapeHtml(pack.gruppe || 'Kalkulation')}</p>
      <h1>${escapeHtml(pack.name)}</h1>
      <p class="lead">${escapeHtml(pack.beschreibung || 'Mengen eingeben, Preise prüfen, Ergebnis sehen.')}</p>
    </section>
    <div class="draft-banner" id="draft-banner" hidden>
      <div class="draft-banner__copy">
        <strong>Entwurf gefunden</strong>
        <span data-draft-info></span>
      </div>
      <div class="draft-banner__actions">
        <button class="button button--primary button--compact" type="button" data-draft-restore>Wiederherstellen</button>
        <button class="button button--ghost button--compact" type="button" data-draft-discard>Verwerfen</button>
      </div>
    </div>
    <div class="calc-actions">
      <label class="job-title">
        <span>Vorgangstitel</span>
        <input type="text" data-job-title value="${escapeHtml(currentJob?.titel || pack.name)}" placeholder="${escapeHtml(pack.name)}" autocomplete="off">
      </label>
      <div class="calc-actions__buttons">
        <button class="button button--primary" type="button" data-save-job>${currentJob ? 'Aktualisieren' : 'Speichern'}</button>
        <button class="button button--ghost" type="button" data-print-job>${['rechnung', 'abgeschlossen'].includes(currentJob?.status) ? 'Rechnung drucken' : 'Angebot drucken'}</button>
        <a class="button button--ghost" href="#/vorgaenge">Vorgangsliste</a>
      </div>
      <p class="save-status" data-save-status role="status"></p>
      <p class="calc-actions__hint">Der offene Entwurf wird automatisch lokal gesichert.</p>
    </div>
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
        ${renderMetaPanel(jobMeta)}
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
  const titleInput = document.querySelector('[data-job-title]');
  const saveButton = document.querySelector('[data-save-job]');
  const printButton = document.querySelector('[data-print-job]');
  const saveStatus = document.querySelector('[data-save-status]');
  let hasInteracted = false;

  const readJobMeta = () => {
    for (const el of form.querySelectorAll('[data-meta]')) {
      const [group, key] = el.dataset.meta.split('.');
      if (!jobMeta[group]) continue;
      jobMeta[group][key] = el.value.trim();
    }
  };

  const setSaveStatus = (message, type = '') => {
    if (!saveStatus) return;
    saveStatus.textContent = message;
    saveStatus.dataset.type = type;
  };

  const persistDraft = () => {
    if (!hasInteracted) return;
    writeDraft({
      packId: pack.id,
      jobId: currentJob?.id || null,
      titel: titleInput?.value || pack.name,
      state: {
        eingaben: { ...state.eingaben },
        faktoren: { ...state.faktoren },
        preise: { ...state.preise },
      },
      meta: {
        kunde: { ...jobMeta.kunde },
        baustelle: { ...jobMeta.baustelle },
      },
      savedAt: new Date().toISOString(),
    });
  };

  const recalc = () => {
    if (!syncState(form, state)) {
      showResultMessage(result, 'Bitte korrigiere die markierten Felder.');
      return;
    }
    try {
      renderResult(result, calculate(pack, state));
      persistDraft();
    } catch (err) {
      showResultMessage(result, err instanceof FormulaError ? err.message : 'Die Berechnung ist nicht möglich.');
    }
  };

  const markInteraction = () => {
    hasInteracted = true;
    if (saveStatus?.dataset.type === 'success') {
      saveStatus.textContent = 'Ungespeicherte Änderungen.';
      saveStatus.dataset.type = '';
    }
  };

  form.addEventListener('input', () => {
    markInteraction();
    readJobMeta();
    recalc();
  });
  form.addEventListener('change', () => {
    markInteraction();
    readJobMeta();
    recalc();
  });
  titleInput?.addEventListener('input', () => {
    markInteraction();
    persistDraft();
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-measure-mode]');
    if (!modeButton) return;
    const details = modeButton.closest('[data-measure]');
    if (!details) return;
    event.preventDefault();
    openMeasurePanel(details, modeButton.dataset.measureMode);
  });
  form.addEventListener('toggle', (event) => {
    if (event.target.matches?.('[data-measure]') && !event.target.open) stopMeasure();
  }, true);

  const draftBanner = document.getElementById('draft-banner');
  if (canOfferDraft && draftBanner) {
    draftBanner.hidden = false;
    const info = draftBanner.querySelector('[data-draft-info]');
    if (info) info.textContent = `Gesichert am ${draftTime(draft.savedAt)}.`;
    draftBanner.querySelector('[data-draft-restore]')?.addEventListener('click', () => {
      applyDraftToForm(form, state, draft, titleInput, jobMeta);
      const metaPanel = form.querySelector('[data-meta-panel]');
      if (metaPanel) {
        metaPanel.setAttribute('open', '');
        const hint = metaPanel.querySelector('summary .muted');
        if (hint) hint.textContent = 'Für den Druck hinterlegt';
      }
      hasInteracted = true;
      draftBanner.hidden = true;
      setSaveStatus('Entwurf wiederhergestellt.', 'success');
      recalc();
    });
    draftBanner.querySelector('[data-draft-discard]')?.addEventListener('click', () => {
      clearDraft();
      draftBanner.hidden = true;
      setSaveStatus('Entwurf verworfen.');
    });
  }

  const updatePrintButton = () => {
    if (!printButton) return;
    printButton.textContent = ['rechnung', 'abgeschlossen'].includes(currentJob?.status) ? 'Rechnung drucken' : 'Angebot drucken';
  };

  const saveJob = async () => {
    readJobMeta();
    if (!syncState(form, state)) {
      showResultMessage(result, 'Bitte korrigiere die markierten Felder.');
      setSaveStatus('Bitte Eingaben prüfen.', 'error');
      return null;
    }

    let snapshot;
    try {
      snapshot = calculate(pack, state);
    } catch (err) {
      setSaveStatus(err instanceof FormulaError ? err.message : 'Die Berechnung ist nicht möglich.', 'error');
      return null;
    }

    saveButton.disabled = true;
    setSaveStatus('Speichern …');
    const payload = {
      titel: titleInput?.value.trim() || pack.name,
      gewerkId: pack.id,
      gewerkName: pack.name,
      kunde: { ...jobMeta.kunde },
      baustelle: { ...jobMeta.baustelle },
      datum: currentJob?.datum || todayIso(),
      eingaben: { ...state.eingaben },
      faktoren: { ...state.faktoren },
      preise: { ...state.preise },
      positionen: snapshot.positionen,
      summen: snapshot.summen,
    };

    try {
      const saved = currentJob
        ? await api.put(`/api/jobs/${encodeURIComponent(currentJob.id)}`, payload)
        : await api.post('/api/jobs', payload);
      if (token !== renderToken) return null;
      currentJob = saved;
      clearDraft();
      saveButton.textContent = 'Aktualisieren';
      updatePrintButton();
      if (saveStatus) {
        saveStatus.innerHTML = 'Gespeichert. <a href="#/vorgaenge">Zur Vorgangsliste</a>';
        saveStatus.dataset.type = 'success';
      }
      history.replaceState(null, '', `#/vorgang/${encodeURIComponent(saved.id)}`);
      setActiveNav(`/vorgang/${saved.id}`);
      return saved;
    } catch (err) {
      setSaveStatus(err.message || 'Der Vorgang konnte nicht gespeichert werden.', 'error');
      return null;
    } finally {
      saveButton.disabled = false;
    }
  };

  saveButton?.addEventListener('click', saveJob);
  printButton?.addEventListener('click', async () => {
    const saved = await saveJob();
    if (!saved) return;
    location.hash = `#/vorgang/${encodeURIComponent(saved.id)}/drucken`;
  });

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
  document.title = DEFAULT_TITLE;
  stopMeasure();
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
      await renderVorgaenge(token);
    } else if (/^\/vorgang\/[^/]+\/drucken$/.test(route)) {
      let id = '';
      try {
        id = decodeURIComponent(route.slice('/vorgang/'.length, -'/drucken'.length));
      } catch {
        id = '';
      }
      if (id) await renderDruck(id, token);
      else placeholder('Druckansicht', 'Dieser Vorgang existiert nicht.');
    } else if (/^\/vorgang\/[^/]+$/.test(route)) {
      let id = '';
      try {
        id = decodeURIComponent(route.slice('/vorgang/'.length));
      } catch {
        id = '';
      }
      if (!id) {
        placeholder('Vorgang nicht gefunden', 'Dieser Vorgang existiert nicht.');
      } else {
        let job;
        try {
          job = await api.get(`/api/jobs/${encodeURIComponent(id)}`);
        } catch (err) {
          if (err.status === 404) {
            placeholder('Vorgang nicht gefunden', 'Dieser Vorgang existiert nicht oder wurde gelöscht.');
            return;
          }
          throw err;
        }
        if (token !== renderToken) return;
        if (!job.gewerkId) {
          placeholder('Vorgang ohne Gewerk', 'Diesem Vorgang ist kein Gewerk zugeordnet.');
          return;
        }
        await renderKalkulation(job.gewerkId, token, job);
      }
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
