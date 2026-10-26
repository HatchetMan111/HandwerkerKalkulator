import { promises as fs } from 'node:fs';
import path from 'node:path';
import { evaluateFormula, FormulaError } from '../app/assets/engine.js';

const PACK_ID_RE = /^[a-z0-9_]+$/;
const ITEM_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const INPUT_ARTS = new Set(['flaeche', 'laenge', 'volumen', 'gewicht', 'anzahl', 'stunden', 'tage', 'prozent', 'auswahl']);
const RESOURCE_ARTS = new Set(['material', 'transport', 'container', 'palette', 'sack', 'stunden', 'pauschal']);
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export async function loadPacks(dir) {
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json')).sort();
  const packs = [];
  for (const file of files) {
    const full = path.join(dir, file);
    let pack;
    try {
      pack = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch (err) {
      throw new Error(`${file}: ungültiges JSON (${err.message})`);
    }
    const errors = validatePack(pack);
    if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
    packs.push(pack);
  }
  return packs;
}

function checkRange(errors, kind, item) {
  if (item.min !== undefined && !isNum(item.min)) errors.push(`${kind} ${item.id}: min ungültig`);
  if (item.max !== undefined && !isNum(item.max)) errors.push(`${kind} ${item.id}: max ungültig`);
  if (isNum(item.min) && isNum(item.max) && item.min > item.max) errors.push(`${kind} ${item.id}: min > max`);
  if (isNum(item.standard) && isNum(item.min) && item.standard < item.min) errors.push(`${kind} ${item.id}: standard < min`);
  if (isNum(item.standard) && isNum(item.max) && item.standard > item.max) errors.push(`${kind} ${item.id}: standard > max`);
}

function checkFormula(errors, resource, formula, scope) {
  try {
    evaluateFormula(formula, scope);
  } catch (err) {
    errors.push(`ressource ${resource.id}: ${err instanceof FormulaError ? err.message : String(err)}`);
  }
}

export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') return ['Pack ist kein Objekt'];
  if (!PACK_ID_RE.test(pack.id || '')) errors.push('id muss kleingeschrieben und ohne Umlaute sein');
  if (!pack.name || typeof pack.name !== 'string') errors.push('name fehlt');
  if (!pack.gruppe || typeof pack.gruppe !== 'string') errors.push('gruppe fehlt');
  if (!Array.isArray(pack.eingaben)) errors.push('eingaben fehlt');
  if (!Array.isArray(pack.faktoren)) errors.push('faktoren fehlt');
  if (!Array.isArray(pack.ressourcen) || pack.ressourcen.length === 0) errors.push('ressourcen fehlt');
  if (!pack.preise || typeof pack.preise !== 'object') errors.push('preise fehlt');
  if (pack.preise && !(isNum(pack.preise.mwst) && pack.preise.mwst >= 0 && pack.preise.mwst <= 100)) errors.push('preise.mwst fehlt oder ungültig');
  if (pack.preise?.mindestpreis !== undefined && !(isNum(pack.preise.mindestpreis) && pack.preise.mindestpreis >= 0)) errors.push('preise.mindestpreis ungültig');
  if (pack.preise?.anfahrt !== undefined && (!pack.preise.anfahrt || !isNum(pack.preise.anfahrt.preisProKm) || pack.preise.anfahrt.preisProKm < 0)) errors.push('preise.anfahrt.preisProKm ungültig');
  if (pack.preise?.anfahrtPauschal !== undefined && !(isNum(pack.preise.anfahrtPauschal) && pack.preise.anfahrtPauschal >= 0)) errors.push('preise.anfahrtPauschal ungültig');
  if (pack.ausgabe !== undefined && (!pack.ausgabe || typeof pack.ausgabe !== 'object' || !pack.ausgabe.titel)) errors.push('ausgabe.titel fehlt');

  const scopeStandard = {};
  const scopeOne = {};
  const ids = new Set();
  const addId = (kind, item) => {
    if (!item || typeof item !== 'object') {
      errors.push(`${kind}: Eintrag ist kein Objekt`);
      return false;
    }
    if (!ITEM_ID_RE.test(item.id || '')) errors.push(`${kind} ${item.id || '?'}: id ungültig`);
    if (ids.has(item.id)) errors.push(`${kind} ${item.id}: id doppelt`);
    ids.add(item.id);
    if (!item.label || typeof item.label !== 'string') errors.push(`${kind} ${item.id || '?'}: label fehlt`);
    if (!item.einheit || typeof item.einheit !== 'string') errors.push(`${kind} ${item.id || '?'}: einheit fehlt`);
    return true;
  };
  const addNumeric = (kind, item) => {
    if (!addId(kind, item)) return;
    if (!isNum(item.standard)) errors.push(`${kind} ${item.id || '?'}: standard fehlt`);
    checkRange(errors, kind, item);
    scopeStandard[item.id] = isNum(item.standard) ? item.standard : 0;
    scopeOne[item.id] = 1;
  };

  for (const input of pack.eingaben || []) {
    addNumeric('eingabe', input);
    if (!INPUT_ARTS.has(input.art)) errors.push(`eingabe ${input.id}: unbekannte art ${input.art}`);
    if (input.art === 'auswahl' && !Array.isArray(input.optionen)) errors.push(`eingabe ${input.id}: optionen fehlen`);
  }
  for (const factor of pack.faktoren || []) addNumeric('faktor', factor);

  for (const resource of pack.ressourcen || []) {
    addId('ressource', resource);
    if (!RESOURCE_ARTS.has(resource.art)) {
      errors.push(`ressource ${resource.id}: unbekannte art ${resource.art}`);
      continue;
    }
    const formulas = [];
    if (resource.art === 'transport') {
      if (!resource.volumenFormel) errors.push(`ressource ${resource.id}: volumenFormel fehlt`);
      else formulas.push(resource.volumenFormel);
      if (resource.gewichtFormel) formulas.push(resource.gewichtFormel);
      if (!(isNum(resource.volumenProFahrt) && resource.volumenProFahrt > 0)) errors.push(`ressource ${resource.id}: volumenProFahrt muss > 0 sein`);
      if (resource.gewichtFormel && !(isNum(resource.gewichtProFahrt) && resource.gewichtProFahrt > 0)) errors.push(`ressource ${resource.id}: gewichtProFahrt muss > 0 sein`);
      if (!(isNum(resource.preisProFahrt) && resource.preisProFahrt >= 0)) errors.push(`ressource ${resource.id}: preisProFahrt fehlt`);
    } else if (resource.art === 'container') {
      if (!resource.volumenFormel) errors.push(`ressource ${resource.id}: volumenFormel fehlt`);
      else formulas.push(resource.volumenFormel);
      if (!(isNum(resource.volumenProContainer) && resource.volumenProContainer > 0)) errors.push(`ressource ${resource.id}: volumenProContainer muss > 0 sein`);
      if (!(isNum(resource.preisProContainer) && resource.preisProContainer >= 0)) errors.push(`ressource ${resource.id}: preisProContainer fehlt`);
    } else if (resource.art === 'palette') {
      if (!resource.stueckFormel) errors.push(`ressource ${resource.id}: stueckFormel fehlt`);
      else formulas.push(resource.stueckFormel);
      if (!(isNum(resource.stueckProPalette) && resource.stueckProPalette > 0)) errors.push(`ressource ${resource.id}: stueckProPalette muss > 0 sein`);
      if (!(isNum(resource.preisProPalette) && resource.preisProPalette >= 0)) errors.push(`ressource ${resource.id}: preisProPalette fehlt`);
    } else if (resource.art === 'sack') {
      if (!resource.gewichtFormel) errors.push(`ressource ${resource.id}: gewichtFormel fehlt`);
      else formulas.push(resource.gewichtFormel);
      if (!(isNum(resource.kgProSack) && resource.kgProSack > 0)) errors.push(`ressource ${resource.id}: kgProSack muss > 0 sein`);
      if (!(isNum(resource.preisProSack) && resource.preisProSack >= 0)) errors.push(`ressource ${resource.id}: preisProSack fehlt`);
    } else if (resource.art === 'pauschal') {
      if (!(isNum(resource.preisProEinheit) && resource.preisProEinheit >= 0)) errors.push(`ressource ${resource.id}: preisProEinheit fehlt`);
    } else {
      if (!resource.formel) errors.push(`ressource ${resource.id}: formel fehlt`);
      else formulas.push(resource.formel);
      if (!(isNum(resource.preisProEinheit) && resource.preisProEinheit >= 0)) errors.push(`ressource ${resource.id}: preisProEinheit fehlt`);
    }
    for (const formula of formulas) {
      checkFormula(errors, resource, formula, scopeStandard);
      checkFormula(errors, resource, formula, scopeOne);
    }
  }

  if (pack.ausgabe?.mengeFormel) {
    checkFormula(errors, { id: 'ausgabe' }, pack.ausgabe.mengeFormel, scopeStandard);
    checkFormula(errors, { id: 'ausgabe' }, pack.ausgabe.mengeFormel, scopeOne);
  }

  return [...new Set(errors)];
}
