# Handwerker-Kalkulator – Design-Spec

- **Datum:** 2026-10-26
- **Status:** Entwurf zur Freigabe
- **Repo:** `HatchetMan111/HandwerkerKalkulator` (Ordner `handwerker-kalkulator-proxmox`)
- **Vorbild:** `DeSynkro/quote-assistant` (Offline-Kalkulator für Erdbau) – hier als Mehrgewerke-Rechner für den deutschen Markt
- **Sprache:** Produkt, UI, Doku und Fehlermeldungen auf Deutsch

## 1. Ziel

Ein self-hosted Kalkulations-Assistent für deutsche Handwerks- und Dienstleistungsbetriebe. Vor Ort werden Maße erfasst; die App rechnet daraus Mengen, Material, Ressourcen (LKW-Fahrten, Mulden, Paletten, Säcke, Stunden) und einen belastbaren Angebotspreis. Die App läuft in einem Proxmox-LXC, ist im LAN erreichbar, benötigt keine Cloud und keine Benutzerkonten.

## 2. Zielgruppe und typischer Ablauf

Zielgruppe: kleine und mittlere Handwerksbetriebe (1–20 Mitarbeitende), Meister, Vorarbeiter, Bauleiter, Selbstständige.

Ablauf:

1. Gewerk im Starter auswählen (z. B. „Maler & Lackierer“).
2. Maße eingeben – per Tastatur, Rechteck/L-Form, GPS-Polygon oder Sprache.
3. Faktoren prüfen (Verschnitt, Auflockerung, Ergiebigkeit …).
4. Live-Ergebnis sehen: Mengen, Ressourcen, Preis, Klartext.
5. Als Vorgang speichern, Angebot drucken oder als PDF sichern.
6. Später Auftrag/Rechnung daraus machen.

## 3. Erfolgskriterien

- Ein Gewerk ist in unter 60 Sekunden vollständig kalkuliert.
- Jede Kalkulation ist nachvollziehbar: jede Position zeigt Menge, Einheit, Einzelpreis und Herleitung.
- Alle 20 Gewerke sind ohne Codeänderung über JSON-Packs nutzbar.
- Die App funktioniert auf Handy, Tablet und Desktop; die Druckansicht ist DIN-A4-tauglich.
- Der Proxmox-Installer legt in einem Lauf einen lauffähigen Container an und verifiziert ihn per HTTP.
- Kein externer Dienst, keine Telemetrie, keine Konten.
- `node --test` ist grün; alle Trade-Packs bestehen die Schema-Prüfung.

## 4. Nicht-Ziele

- Keine Cloud-Synchronisation über das LAN hinaus.
- Keine Benutzerkonten, Rollen oder Rechteverwaltung (LAN-Vertrauensmodell).
- Keine AR-Vermessung, keine Live-Karten, keine Routenoptimierung.
- Keine nativen Tauri-/Android-Builds; die Web-App ist als PWA installierbar.
- Keine Anbindung an Lieferanten-APIs; Preislisten werden manuell gepflegt.
- Keine Buchhaltung, kein DATEV-Export, keine Lohnabrechnung.

## 5. Architektur

**Ansatz A: statisches Frontend + schlanker Node-Server + JSON-Datenhaltung.**

- Frontend: reines HTML, CSS, JavaScript (ES-Module), kein Build-Schritt.
- Server: Node.js 22, ausschließlich eingebaute Module (`http`, `fs`, `path`, `url`), keine npm-Abhängigkeiten.
- Server liefert die statische App und eine kleine REST-API für Jobs, Vorlagen, Preislisten, Einstellungen und Fotos.
- Persistenz: JSON-Dateien unter `DATA_DIR` (Standard `/var/lib/handwerker-kalkulator`), atomare Schreibvorgänge.
- Trade-Packs: je Gewerk eine JSON-Datei unter `app/trades/`. Der Rechenkern ist generisch.
- Betrieb: systemd-Service im LXC, Port `8090`, erreichbar über `http://<CT-IP>:8090`.

Begründung: identisch zum Vorbild (offline, schlank, wartbar), aber mit zentraler Datenhaltung, damit mehrere Geräte im Betrieb dieselben Vorgänge sehen.

## 6. Repo-Struktur

```text
handwerker-kalkulator-proxmox/
├── README.md
├── LICENSE                        # MIT
├── VERSION                        # 1.0.0
├── CHANGELOG.md
├── install/
│   └── handwerker-kalkulator.sh   # Proxmox-Host-Installer (root)
├── systemd/
│   └── handwerker-kalkulator.service
├── app/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── assets/
│   │   ├── styles.css
│   │   ├── print.css
│   │   ├── app.js                 # UI, Routing, Zustand
│   │   ├── engine.js              # Rechenkern + Formel-Parser
│   │   ├── measure.js             # Rechteck/L-Form/GPS/Sprache
│   │   ├── api.js                 # Fetch-Wrapper
│   │   └── formats.js             # de-DE-Zahlen, Datum, Währung
│   └── trades/
│       ├── erdbau.json
│       ├── abbruch.json
│       ├── garten.json
│       ├── tiefbau.json
│       ├── baumfaellung.json
│       ├── baustelle.json
│       ├── maler.json
│       ├── dachdecker.json
│       ├── fliesenleger.json
│       ├── trockenbau.json
│       ├── beton.json
│       ├── zaun.json
│       ├── pflaster.json
│       ├── umzug.json
│       ├── reinigung.json
│       ├── catering.json
│       ├── event.json
│       ├── landwirtschaft.json
│       ├── fotografie.json
│       └── 3ddruck.json
├── server/
│   └── server.js
├── tests/
│   ├── engine.test.js
│   ├── trades.test.js
│   └── server.test.js
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-10-26-handwerker-kalkulator-design.md
```

## 7. Datenmodell

### 7.1 Job (Vorgang)

```json
{
  "id": "job_20261026_ab12cd",
  "nummer": "A-2026-0001",
  "status": "angebot",
  "gewerkId": "maler",
  "titel": "Wohnzimmer streichen",
  "kunde": {"name": "", "firma": "", "strasse": "", "plz": "", "ort": "", "telefon": "", "email": ""},
  "baustelle": {"strasse": "", "plz": "", "ort": "", "hinweis": ""},
  "datum": "2026-10-26",
  "eingaben": {"flaeche": 42, "anstriche": 2},
  "faktoren": {"verschnitt": 10, "ergiebigkeit": 10},
  "preise": {"mwst": 19, "marge": 0, "anfahrtKm": 0, "anfahrtPauschal": 0},
  "positionen": [],
  "summen": {},
  "notizen": "",
  "fotos": [],
  "createdAt": "2026-10-26T10:00:00.000Z",
  "updatedAt": "2026-10-26T10:00:00.000Z"
}
```

- `status`: `entwurf`, `angebot`, `auftrag`, `rechnung`, `abgeschlossen`.
- `positionen` und `summen` werden beim Speichern als Snapshot mitgeschrieben, damit ein gedrucktes Angebot später unverändert bleibt.
- `nummer` wird beim Wechsel auf `angebot` bzw. `rechnung` aus dem Zähler in `settings` vergeben.

### 7.2 Vorlage (Preset)

```json
{
  "id": "preset_lkw_8m3",
  "art": "transport",
  "name": "LKW 8 m³ / 12 t",
  "werte": {"volumenProFahrt": 8, "gewichtProFahrt": 12, "preisProFahrt": 180}
}
```

Arten: `transport`, `container`, `material`, `stunden`, `pauschal`.

### 7.3 Preisliste

```json
{
  "id": "pl_baustoff_2026",
  "lieferant": "Baustoffe Müller",
  "stand": "2026-10-01",
  "positionen": [
    {"id": "mat_farbe", "bezeichnung": "Innenwandfarbe", "einheit": "l", "preis": 8.5, "mwst": 19}
  ]
}
```

### 7.4 Einstellungen

```json
{
  "firma": {"name": "", "strasse": "", "plz": "", "ort": "", "telefon": "", "email": "", "steuernummer": "", "ustId": "", "iban": ""},
  "standardMwst": 19,
  "dezimalstellen": 2,
  "theme": "system",
  "reduzierteBewegung": false,
  "autosave": true,
  "angebotsPrefix": "A",
  "rechnungsPrefix": "R",
  "zahlungszielTage": 14
}
```

### 7.5 Trade-Pack-Schema

```json
{
  "id": "maler",
  "name": "Maler & Lackierer",
  "gruppe": "Ausbau",
  "icon": "walze",
  "beschreibung": "Wände und Decken streichen.",
  "eingaben": [
    {"id": "flaeche", "label": "Zu streichende Fläche", "art": "flaeche", "einheit": "m²", "standard": 0, "hilfe": "Türen und Fenster abziehen."},
    {"id": "anstriche", "label": "Anzahl Anstriche", "art": "anzahl", "einheit": "x", "standard": 2, "min": 1, "max": 5}
  ],
  "faktoren": [
    {"id": "verschnitt", "label": "Verschnitt", "einheit": "%", "standard": 10, "min": 0, "max": 50},
    {"id": "ergiebigkeit", "label": "Ergiebigkeit", "einheit": "m²/l", "standard": 10, "min": 1, "max": 50}
  ],
  "ressourcen": [
    {"id": "farbe", "label": "Wandfarbe", "art": "material", "einheit": "l", "formel": "flaeche * anstriche / ergiebigkeit * (1 + verschnitt / 100)", "preisProEinheit": 8.5},
    {"id": "arbeit", "label": "Arbeitszeit", "art": "stunden", "einheit": "h", "formel": "flaeche / 12", "preisProEinheit": 45},
    {"id": "abdeckung", "label": "Abdeckmaterial", "art": "pauschal", "einheit": "Pauschale", "preisProEinheit": 35}
  ],
  "preise": {"mindestpreis": 150, "mwst": 19, "anfahrt": {"preisProKm": 0.8, "hinUndZurueck": true}},
  "ausgabe": {"titel": "Malerarbeiten", "mengeLabel": "Fläche", "mengeEinheit": "m²", "mengeFormel": "flaeche"}
}
```

Regeln:

- `id` ist eindeutig, kleingeschrieben, ohne Umlaute.
- Jede Ressource hat `art`, `label`, `einheit` und eine `formel` (bzw. typspezifische Formeln); `pauschal` benötigt keine Formel.
- Formeln dürfen nur deklarierte Eingaben, Faktoren, Ressourcen und die Funktionen aus Abschnitt 8.4 referenzieren.
- Preise sind Netto-Einzelpreise in Euro; MwSt. wird erst in der Summe angewandt.

## 8. Rechenkern

### 8.1 Eingabetypen

| `art` | Bedeutung | Erfassung |
|---|---|---|
| `flaeche` | Fläche in m² | Rechteck, L-Form, Dreieck, manuell, GPS-Polygon |
| `laenge` | Länge in m | direkt oder Stück × Länge |
| `volumen` | Volumen in m³ | Fläche × Tiefe oder direkt |
| `gewicht` | Gewicht in t oder kg | direkt |
| `anzahl` | Stückzahl | Zahl |
| `stunden` | Zeit in h | Zahl |
| `tage` | Zeit in Tagen | Zahl |
| `prozent` | Prozentwert | Zahl |
| `auswahl` | Auswahl aus Optionen | Select; Option liefert Faktorwert |

Jede Eingabe hat `standard`, optional `min`, `max`, `hilfe` und `einheit`.

Eingaben der Art `auswahl` tragen zusätzlich `optionen: [{"label": "…", "wert": 1.2}]`. Der gewählte `wert` wird in Formeln wie ein Faktor verwendet.

### 8.2 Faktoren

Faktoren sind benannte, vom Nutzer überschreibbare Rechengrößen (Prozent, Verhältnis, Dichte). Beispiele: `verschnitt`, `auflockerung`, `verdichtung`, `ergiebigkeit`, `dichte`, `ziegelProM2`, `kleberProM2`, `pfostenabstand`.

### 8.3 Ressourcentypen

| `art` | Menge | Preis | Rundung |
|---|---|---|---|
| `material` | `formel` (Einheit) | `preisProEinheit` | 2 Dezimalen |
| `transport` | `volumenFormel`, `gewichtFormel`; Fahrten = max(ceil(Volumen/`volumenProFahrt`), ceil(Gewicht/`gewichtProFahrt`)) | `preisProFahrt` | ganzzahlig |
| `container` | `volumenFormel`; Anzahl = ceil(Volumen/`volumenProContainer`) | `preisProContainer` | ganzzahlig |
| `palette` | `stueckFormel`; Paletten = ceil(Stück/`stueckProPalette`) | `preisProPalette` | ganzzahlig |
| `sack` | `gewichtFormel`; Säcke = ceil(kg/`kgProSack`) | `preisProSack` | ganzzahlig |
| `stunden` | `formel` | `preisProEinheit` | auf 0,25 h aufrunden |
| `pauschal` | 1 | `preisProEinheit` | ganzzahlig |

Jede Position liefert zusätzlich eine `herleitung` (Klartext, z. B. „42 m² × 2 Anstriche ÷ 10 m²/l × 1,10 = 9,24 l“).

### 8.4 Formel-Parser

Sicherer, rekursiver Ausdrucksparser ohne `eval`/`new Function`:

- Zahlen (deutsche und englische Dezimaltrennung werden vorher normalisiert), Bezeichner, `+ - * / ( ) ,`.
- Funktionen: `ceil`, `floor`, `round`, `min`, `max`, `abs`, `sqrt`, `pi()`.
- Variablen: alle Eingabe- und Faktor-IDs einer Kalkulation.
- Fehler (unbekannte Variable, Division durch 0, Syntax) ergeben eine verständliche deutsche Meldung und markieren die betroffene Zeile; die Kalkulation wird nicht gespeichert.

### 8.5 Preisberechnung

1. Positionssummen = gerundete Menge × Einzelpreis.
2. Zwischensumme = Summe der Positionen.
3. Anfahrt = `km × preisProKm × (hinUndZurueck ? 2 : 1)` oder Pauschale.
4. Marge = `(Zwischensumme + Anfahrt) × marge/100`.
5. Mindestpreis: liegt die Summe darunter, wird eine Position „Mindestpreis“ ergänzt.
6. MwSt. = `(Zwischensumme + Anfahrt + Marge) × mwst/100`.
7. Gesamt = Zwischensumme + Anfahrt + Marge + MwSt.
8. Anzeige in `de-DE` mit Komma und Punkt-Tausendertrennung; Rundung auf `dezimalstellen`.

### 8.6 Rundung und Validierung

- Mengen werden erst nach der Formel gerundet, Preise erst in der Summe.
- Negative Eingaben sind unzulässig, außer bei explizit erlaubten Korrekturwerten.
- `min`/`max` werden geprüft; Verstöße zeigen eine Feldfehlermeldung.
- Division durch 0 und fehlende Pflichtfelder blockieren das Speichern, nicht die Live-Vorschau.

## 9. Gewerke-Packs

### 9.1 Bau und Außen

| Pack | Kern-Eingaben | Wichtigste Ressourcen |
|---|---|---|
| **Erdbau & Aushub** | Fläche, Tiefe, Auflockerung, Dichte | LKW-Fahrten (Volumen/Gewicht), Aushub m³ |
| **Abbruch & Entsorgung** | Fläche, Dicke, Dichte, Auflockerung | Mulden, Gewicht t, Transport |
| **Garten- & Landschaftsbau** | Fläche, Schichtdicke, Verdichtung | Mutterboden m³, Big Bags, Stunden |
| **Tiefbau & Kanalbau** | Grabenlänge, -breite, -tiefe, Rohrlänge, Schächte | Aushub-Fahrten, Bettung, Rohre, Schächte, Stunden |
| **Baumfällung & Grünpflege** | Anzahl Bäume, Durchmesser, Höhe | Hackschnitzel, Entsorgung, Stunden |
| **Baustelleneinrichtung** | Zaunlänge, Toiletten, Dauer | Bauzaun, Toiletten/Tag, Transport |
| **Zaunbau** | Länge, Höhe, Pfostenabstand, Querlatten | Pfosten, Latten, H-Platten, Beton-Säcke, Stunden |
| **Pflasterarbeiten** | Fläche, Steinformat, Verschnitt | Pflastersteine, Splitt, Sand, Paletten, Stunden |

### 9.2 Ausbau und Hochbau

| Pack | Kern-Eingaben | Wichtigste Ressourcen |
|---|---|---|
| **Maler & Lackierer** | Fläche, Anstriche, Ergiebigkeit | Farbe l, Stunden, Abdeckung |
| **Dachdecker** | Dachfläche, Neigung, Firstlänge | Ziegel, Firstziegel, Paletten, Stunden |
| **Fliesenleger** | Fläche, Fliesen pro m², Verschnitt | Fliesen, Kleber-Säcke, Fugenmörtel-Säcke, Stunden |
| **Trockenbau** | Fläche, Platten pro m², Verschnitt | Platten, Schrauben, Spachtel-Säcke, Stunden |
| **Betonbau** | Fläche, Dicke, Bewehrung kg/m³ | Beton m³, Bewehrung, Fahrmischer-Fahrten, Stunden |
| **Umzug & Transport** | Volumen, Gewicht, Etage | LKW-Fahrten, Stunden, Pauschale |

### 9.3 Dienstleistung und Sonstiges

| Pack | Kern-Eingaben | Wichtigste Ressourcen |
|---|---|---|
| **Reinigung** | Fläche, Verschmutzungsgrad, Frequenz | Stunden, Material, Anfahrt |
| **Catering** | Gäste, Portionen pro Gast | Portionen, Getränke, Stunden |
| **Event & Vermietung** | Gäste, Dauer | Tische, Stühle, Zelte, Stunden |
| **Landwirtschaft** | Fläche in ha, Saatgut kg/ha, Dünger kg/ha | Saatgut-Säcke, Dünger-Säcke, Maschinenstunden |
| **Fotografie** | Stunden, Bilder, Anfahrt | Stunden, Nachbearbeitung, Anfahrt |
| **3D-Druck** | Volumen cm³, Dichte, Verschnitt | Filament g, Druckstunden, Rollen |

Jedes Pack enthält deutsche Hilfetexte und realistische Standardwerte. Die Werte sind als Vorschlag dokumentiert und im UI überschreibbar; sie ersetzen keine betriebliche Kalkulation.

## 10. Funktionen

### 10.1 Gewerke-Galerie

Startseite mit Karten, gruppiert nach „Bau & Außen“, „Ausbau & Hochbau“, „Dienstleistung & Sonstiges“. Suche, zuletzt verwendete Gewerke, Favoriten.

### 10.2 Kalkulation

Zweispaltig auf Desktop, einspaltig auf Mobil:

- Links: Eingaben, Faktoren, Preise (MwSt., Marge, Anfahrt).
- Rechts: Live-Ergebnis mit Positionen, Herleitung, Summen und Klartext.
- Sticky-Leiste auf Mobil mit Gesamtpreis.
- Aktionen: Speichern, Angebot drucken, Zurücksetzen, Duplizieren.

### 10.3 Maß-Assistent

- **Rechteck:** Länge × Breite.
- **L-Form:** zwei Rechtecke, Addition.
- **Dreieck:** Grundseite × Höhe ÷ 2.
- **Manuell:** direkte Fläche/Volumen-Eingabe.
- **GPS-Polygon:** Punkte sammeln, Polygonschluss, Fläche per Kugel-Shoelace (Erdradius), offline ohne Kartenkacheln; Genauigkeit und Punktzahl werden angezeigt.
- **Sprache:** Web Speech API (`de-DE`), Muster wie „zwölf Meter mal acht Meter“ oder „zwei Komma fünf Meter tief“; nur progressive Erweiterung, bei fehlender Unterstützung ausgeblendet.

### 10.4 Angebot, Rechnung, PDF

- Druckansicht DIN A4 mit Firmenkopf, Kunde, Baustelle, Positionsnummer, Menge, Einheit, Einzelpreis, Gesamtpreis, Summen, MwSt., Zahlungsziel und Hinweisen.
- Titel je Status: „Angebot“, „Auftragsbestätigung“, „Rechnung“.
- Nummernvergabe aus dem Zähler in `meta.json` (Präfixe aus den Einstellungen), Format `A-2026-0001` / `R-2026-0001`; der Zähler wird atomar erhöht.
- „Als PDF speichern“ über den Browser-Druckdialog (kein externes PDF-Paket).
- Rechnungsstatus setzt das Leistungsdatum und das Zahlungsziel.

### 10.5 Vorgänge (Jobs)

Liste mit Suche, Statusfilter und Sortierung nach Datum/Kunde/Summe. Aktionen: öffnen, duplizieren, löschen, Status wechseln, exportieren. Autosave des offenen Entwurfs, 10-Sekunden-Undo beim Löschen.

### 10.6 Preislisten

Lieferanten und Materialpositionen anlegen, bearbeiten, löschen; Preise in Ressourcenzeilen übernehmen. Stand-Datum und MwSt. je Position. Keine automatische Preisaktualisierung.

### 10.7 Vorlagen

Wiederverwendbare LKW-, Container-, Material- und Stunden-Sätze. Im Kalkulationsformular als Dropdown wählbar; Werte werden in die Kalkulation kopiert, nicht verlinkt.

### 10.8 Fotos

Bis zu 6 Fotos je Vorgang. Aufnahme über Kamera oder Dateiauswahl; clientseitige Verkleinerung auf max. 1280 px und JPEG-Qualität 0,7; Ablage als Datei unter `DATA_DIR/fotos/<jobId>/`. Anzeige in der Job-Detailansicht und im Druck optional.

### 10.9 Backup und Import

- Export aller Daten als JSON-Bundle (`GET /api/export`) inklusive Schema-Version und Zeitstempel.
- Import mit den Modi „zusammenführen“ und „ersetzen“; Validierung vor dem Schreiben, bei Fehlern keine Teilübernahme.
- Zusätzlich Download eines ZIP-freien JSON-Bundles; Fotos werden als Base64 eingebettet, solange das Bundle unter 20 MB bleibt. Wird es größer, werden die Fotos ausgelassen und im Export vermerkt; Textdaten sind immer enthalten.
- Dokumentierter manueller Weg: `DATA_DIR` kopieren.

### 10.10 Einstellungen

Firmendaten, Standard-MwSt., Dezimalstellen, Theme (hell/dunkel/System), reduzierte Bewegung, Autosave, Nummernkreise, Zahlungsziel. Alles serverseitig gespeichert.

### 10.11 PWA und Offline

`manifest.webmanifest` und Service Worker cachen die App-Shell. Kalkulieren funktioniert offline. Speichern versucht die API; schlägt sie fehl, wird der Entwurf in `localStorage` gesichert und ein klarer Hinweis angezeigt. Eine automatische Nachsynchronisation gibt es nicht – der Entwurf wird beim nächsten Öffnen angeboten.

## 11. UI und Design

- Klare, nüchterne Handwerker-Optik: hoher Kontrast, große Tap-Ziele (mind. 44 px), gut lesbare Zahlen, keine verspielten Illustrationen.
- Farbsystem: dunkles Anthrazit, Signalorange als Akzent, Weiß/Grau für Flächen; semantische Farben für Erfolg/Warnung/Fehler.
- Typografie: Systemschriften für maximale Offline-Kompatibilität; Zahlen tabellarisch.
- Jede Zahl trägt eine Einheit; keine nackten Werte.
- Fehler stehen am Feld, nicht nur als Toast.
- Druckansicht ohne Bedienelemente, mit Seitenumbruch-Schutz für Positionstabellen.
- Tastaturbedienung und sichtbare Fokusringe; `prefers-reduced-motion` wird respektiert.

## 12. Server-API

Alle Antworten JSON, UTF-8. Fehlerformat: `{"fehler": "…", "feld": "…"}` mit passendem HTTP-Status.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | `{ok, version, uptime, dataWritable}` |
| GET | `/api/version` | Version und Schema-Version |
| GET | `/api/trades` | Alle Trade-Packs |
| GET | `/api/jobs` | Vorgangsliste (ohne Fotos) |
| GET | `/api/jobs/:id` | Ein Vorgang |
| POST | `/api/jobs` | Vorgang anlegen |
| PUT | `/api/jobs/:id` | Vorgang aktualisieren |
| DELETE | `/api/jobs/:id` | Vorgang löschen |
| POST | `/api/jobs/:id/fotos` | Foto als Base64-JSON anhängen |
| GET | `/api/fotos/:jobId/:datei` | Foto ausliefern |
| DELETE | `/api/fotos/:jobId/:datei` | Foto löschen |
| GET | `/api/presets` | Vorlagen |
| PUT | `/api/presets` | Vorlagen speichern |
| GET | `/api/pricelists` | Preislisten |
| PUT | `/api/pricelists` | Preislisten speichern |
| GET | `/api/settings` | Einstellungen |
| PUT | `/api/settings` | Einstellungen speichern |
| GET | `/api/export` | Vollständiges JSON-Bundle |
| POST | `/api/import` | Bundle importieren |
| POST | `/api/nummern/:art` | Nächste Nummer vergeben (`angebot`/`rechnung`) |

- Request-Limit: 5 MB; Fotos max. 2 MB pro Bild.
- Statische Auslieferung aus `app/`, Pfad-Traversal wird abgewiesen.
- Keine CORS-Freigabe; gleiche Origin.
- Schreibvorgänge sind serialisiert (Promise-Queue) und atomar (`tmp` + `rename`).
- Security-Header: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.

## 13. Persistenz

```text
/var/lib/handwerker-kalkulator/
├── jobs.json
├── presets.json
├── pricelists.json
├── settings.json
├── meta.json          # Schema-Version, Nummernzähler
└── fotos/
    └── <jobId>/
        └── <uuid>.jpg
```

- Beim ersten Start werden fehlende Dateien mit leeren Grundwerten angelegt.
- Schema-Version in `meta.json`; unbekannte höhere Versionen werden nicht überschrieben, sondern gemeldet.
- Backup = `DATA_DIR` kopieren oder `GET /api/export`.
- Rechte: `handwerker:handwerker`, Verzeichnis `0750`, Dateien `0640`.

## 14. Proxmox-Installer

Datei: `install/handwerker-kalkulator.sh`, läuft als root auf dem Proxmox-Host. Stil und Aufbau wie die bestehenden `*-proxmox`-Repos.

- `set -euo pipefail`, farbiges Logging, `trap ERR` mit Befehl, Zeile und Exit-Code, Log unter `/tmp/handwerker-kalkulator-install-*.log`.
- Idempotent: existiert die CT-ID, wird aktualisiert statt neu erstellt.
- Nächste freie CT-ID über `pvesh get /cluster/nextid`, außer `--ctid` gesetzt.
- RootFS-Storage: `--storage` > `local-lvm` > erstes verfügbares.
- Template: neuestes `debian-12-standard` vom Template-Store (Fallback: neuestes Debian-Standard-Template).
- Container: unprivilegiert, `features=nesting=1`, `onboot=1`, DHCP, Hostname `handwerker-kalkulator`.
- Standardressourcen: 1 vCPU / 512 MB RAM / 4 GB Disk / 512 MB Swap.
- Im Container: Node.js 22 (NodeSource), User `handwerker`, `/opt/handwerker-kalkulator`, `/var/lib/handwerker-kalkulator`.
- App-Bezug: `--local-src VERZEICHNIS` (Host-Pfad, per `tar` + `pct push`) oder `git clone` von `REPO_URL`/`--repo` (Standard `https://github.com/HatchetMan111/HandwerkerKalkulator`), Branch `--branch` (Standard `main`).
- Im Container werden `curl`, `ca-certificates`, `git`, `tar` und Node.js 22 (NodeSource) installiert.
- systemd-Unit aus `systemd/handwerker-kalkulator.service` laden, Fallback Inline-Unit; `enable --now`.
- Verifikation: `systemctl is-active`, HTTP 200 auf `/api/health` und `/`.
- Abschlussausgabe: Endpoint, Health-URL, CT-ID, Ressourcen, Root-Passwort (nur einmal), Datenverzeichnis, Update-/Deinstallationshinweis, Logpfad.
- Reboot-Test im README dokumentiert.

Optionen: `--ctid`, `--hostname`, `--cores`, `--memory`, `--disk`, `--storage`, `--template-store`, `--bridge`, `--password`, `--ssh-key`, `--repo`, `--branch`, `--local-src`, `--debug`, `--help`.

## 15. Tests

`node --test tests/` mit eingebautem Test-Runner, keine Test-Abhängigkeiten.

- **engine.test.js:** Formel-Parser (Vorrang, Klammern, Funktionen, Fehler), Faktoren, Rundung, Transport-/Container-/Paletten-/Sack-Anzahl, MwSt., Marge, Mindestpreis, de-DE-Formatierung.
- **trades.test.js:** jede JSON-Datei lädt, Pflichtfelder vorhanden, IDs eindeutig, jede Formel parst, alle referenzierten Variablen existieren, `min <= standard <= max`, realistische Wertebereiche.
- **server.test.js:** Start auf freiem Port mit temporärem `DATA_DIR`, Health, CRUD für Jobs, Persistenz nach Neustart, atomarer Schreibvorgang, Import/Export-Roundtrip, Pfad-Traversal-Abwehr, Request-Limit.

Zusätzlich manueller Smoke-Test: Server starten, Startseite laden, ein Gewerk kalkulieren, Angebot drucken.

## 16. Sicherheit und Datenschutz

- Keine Telemetrie, keine Analytics, keine externen Requests im Normalbetrieb (Ausnahme: optionale Sprach-API des Browsers, die geräteabhängig sein kann – im UI kenntlich gemacht).
- Keine Konten; die App ist für ein vertrauenswürdiges LAN gedacht. README enthält einen klaren Sicherheitshinweis.
- Serverseitige Validierung aller Eingaben; keine Dateipfade aus Nutzereingaben; Upload nur JPEG/PNG/WebP bis 2 MB.
- Keine Secrets im Repo; Firmendaten und Fotos bleiben in `DATA_DIR`.
- systemd-Härtung: `NoNewPrivileges=true`, `PrivateTmp=true`, eigener Benutzer.

## 17. Roadmap (nicht Teil dieser Version)

- Optionale PIN-Sperre und Rollen (Büro vs. Baustelle).
- Lieferanten-Import per CSV.
- DATEV-/Lexware-Export.
- Native Android-App über Tauri.
- Mehrsprachigkeit (AT/CH: andere MwSt. und Begriffe).

## 18. Akzeptanzkriterien

- [ ] 20 Trade-Packs vorhanden, alle schema-valide und im UI wählbar.
- [ ] Rechenkern deckt alle sieben Ressourcentypen und den sicheren Formel-Parser ab.
- [ ] Live-Kalkulation, Speichern, Laden, Duplizieren, Löschen funktionieren.
- [ ] Angebot/Rechnung druckbar, Nummernkreis funktioniert.
- [ ] Preislisten, Vorlagen, Fotos, Export/Import funktionieren.
- [ ] Sprache (falls unterstützt), GPS-Polygon und Maß-Assistent funktionieren.
- [ ] `node --test` grün.
- [ ] Installer legt LXC an, startet den Dienst und verifiziert `/api/health` mit HTTP 200.
- [ ] README beschreibt Einzeiler, Optionen, Backup, Update, Deinstallation und Sicherheit.
- [ ] Keine externen Laufzeitabhängigkeiten außer Node.js.
