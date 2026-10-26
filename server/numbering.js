export function naechsteNummer(meta, art, praefix, jahr = new Date().getFullYear()) {
  const key = art === 'rechnung' ? 'rechnung' : 'angebot';
  const gespeichert = Number(meta?.nummern?.[key]);
  const zaehler = Number.isInteger(gespeichert) && gespeichert > 0 ? gespeichert : 1;
  const nummer = `${praefix || (key === 'rechnung' ? 'R' : 'A')}-${jahr}-${String(zaehler).padStart(4, '0')}`;
  return {
    nummer,
    jahr,
    zaehler,
    meta: {
      ...meta,
      nummern: { ...(meta?.nummern || {}), [key]: zaehler + 1 },
    },
  };
}
