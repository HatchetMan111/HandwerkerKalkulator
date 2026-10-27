let defaultDecimals = 2;

export function setDefaultDecimals(value) {
  const decimals = Number(value);
  defaultDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 2;
}

export function formatNumber(value, decimals = defaultDecimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCurrency(value, decimals = Math.max(2, defaultDecimals)) {
  return `${formatNumber(value, decimals)} €`;
}

export function formatDate(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE');
}

export function parseGermanNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  let raw = String(text).trim().replace(/\s+/g, '');
  if (raw === '') return null;
  if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}
