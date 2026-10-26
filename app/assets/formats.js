export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCurrency(value) {
  return `${formatNumber(value, 2)} €`;
}

export function formatDate(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE');
}

export function parseGermanNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const raw = String(text).trim().replace(/\./g, '').replace(',', '.');
  if (raw === '' || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}
