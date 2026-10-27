const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const rectangleArea = (laenge, breite) => toNumber(laenge) * toNumber(breite);

const normaliseUnit = (unit) => String(unit ?? '').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, '');

export function convertArea(area, unit = 'm²') {
  const value = toNumber(area);
  const normalised = normaliseUnit(unit);
  if (['m²', 'm2', 'qm', 'quadratmeter'].includes(normalised)) return value;
  if (['ha', 'hektar'].includes(normalised)) return value / 10000;
  return null;
}

export function areaDecimals(unit = 'm²') {
  const normalised = normaliseUnit(unit);
  if (['m²', 'm2', 'qm', 'quadratmeter'].includes(normalised)) return 2;
  if (['ha', 'hektar'].includes(normalised)) return 4;
  return null;
}

export function roundArea(area, unit = 'm²') {
  const decimals = areaDecimals(unit);
  if (decimals === null) return null;
  const factor = 10 ** decimals;
  return Math.round(toNumber(area) * factor) / factor;
}

export const lShapeArea = (a, b, c, d) => Math.max(0, rectangleArea(a, b) - rectangleArea(c, d));

export const triangleArea = (grundseite, hoehe) => (toNumber(grundseite) * toNumber(hoehe)) / 2;

export function polygonArea(punkte) {
  if (!Array.isArray(punkte) || punkte.length < 3) return 0;
  const gueltig = punkte.filter((punkt) => Number.isFinite(punkt?.lat) && Number.isFinite(punkt?.lon));
  if (gueltig.length < 3) return 0;

  const R = 6378137;
  const rad = (grad) => (grad * Math.PI) / 180;
  let summe = 0;
  for (let i = 0; i < gueltig.length; i += 1) {
    const p1 = gueltig[i];
    const p2 = gueltig[(i + 1) % gueltig.length];
    summe += (rad(p2.lon) - rad(p1.lon)) * (Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((summe * R * R) / 2);
}

const EINER = {
  null: 0,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
};

const ZAHLEN = {
  ...EINER,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  dreißig: 30,
  vierzig: 40,
  fünfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
  hundert: 100,
};

const ZEHNER = {
  zwanzig: 20,
  dreißig: 30,
  vierzig: 40,
  fünfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};

function zahlwort(wort) {
  if (ZAHLEN[wort] !== undefined) return ZAHLEN[wort];
  const zusammengesetzt = wort.match(/^([a-zäöüß]+)und(zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)$/);
  if (zusammengesetzt && EINER[zusammengesetzt[1]] !== undefined) {
    return EINER[zusammengesetzt[1]] + ZEHNER[zusammengesetzt[2]];
  }
  return null;
}

export function parseSpokenMeasurement(text) {
  let s = String(text).toLocaleLowerCase('de-DE');
  s = s.replace(/\b([a-zäöüß]+)\b/g, (wort) => {
    const zahl = zahlwort(wort);
    return zahl !== null ? String(zahl) : wort;
  });
  s = s.replace(/(\d+)\s*komma\s*(\d+)/g, '$1.$2').replace(/(\d),(\d)/g, '$1.$2');
  const zahlen = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((treffer) => Number(treffer[0]));
  if (/(quadratmeter|qm|m2|m²)/.test(s) && zahlen.length === 1) return { flaeche: zahlen[0] };
  if (/(tief|tiefe|dicke|höhe|hoehe)/.test(s) && zahlen.length === 1) return { tiefe: zahlen[0] };
  if (zahlen.length >= 2) return { laenge: zahlen[0], breite: zahlen[1] };
  if (zahlen.length === 1) return { tiefe: zahlen[0] };
  return {};
}
