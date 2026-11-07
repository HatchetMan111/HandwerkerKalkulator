# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); die Versionierung
folgt [Semantic Versioning](https://semver.org/lang/de/).

## [1.1.0] - 2026-11-07

### Added

- 5 neue Gewerke: Elektroinstallation, Sanitär & Heizung, Bodenleger,
  Zimmerer & Holzbau und Gerüstbau (jetzt 25 Gewerke)
- Rabatt in Prozent je Vorgang, in Ergebnis, Summen und Druckansicht
- Nutzbringende Hinweise im Ergebnis (z. B. Anfahrt über 50 km,
  Mindestpreis-Ausgleich, nicht kalkulierbare Ressourcen)
- Gewerke-Zähler auf der Startseite zählt die tatsächlich geladenen
  Gewerke statt einer festen Zahl
- Ergebnis-Überschrift zeigt Titel und Menge aus der Gewerk-Definition
  (z. B. „Installationspunkte: 10 Stk“)

### Fixed

- Marge wird nur noch auf Material und Arbeit berechnet, nicht mehr auf
  die Anfahrt
- Overrides mit 0 als Ladegrenze (Vorlage/Preisliste) erzeugen keine
  unendlichen Summen mehr; betroffene Ressourcen werden auf 0 gesetzt
  und im Ergebnis erwähnt
- Vorgänge im Status „Bezahlt“ drucken wieder als Rechnung mit
  Rechnungsnummer statt als Angebot mit Angebotsnummer
- Eingabe „Aushubtiefe“ im Erdbau als Länge statt Volumen klassifiziert
- Betonbau und Umzug & Transport in der Gruppe „Bau & Außen“ statt
  „Ausbau & Hochbau“
- Druckansicht zeigt fehlende Summen als 0,00 € statt „– €“
- Einstellungen prüfen Präfixe (max. 8 Zeichen) und das Zahlungsziel
  (ganze Tage); kaputte Nummernformate wie „5-2026-0001“ sind damit
  ausgeschlossen

## [1.0.0] - 2026-10-27

### Added

- Proxmox-LXC-Installer mit automatischer Template-, Node.js-22- und
  systemd-Einrichtung
- 20 Gewerke mit Positionen, Einheiten, Ressourcen und Rechenformeln
- Mengen-, Material- und Ressourcenberechnung mit Overrides pro Vorgang
- Vorgangsverwaltung mit Speichern, Duplizieren, Löschen und Wiederöffnen
- Angebots- und Rechnungsansicht mit DIN-A4-Drucklayout
- Fortlaufende Nummernkreise für Angebote und Rechnungen
- Kunden-, Objekt- und Notizfelder
- Eigene Preislisten, Vorlagen und Einstellungen
- Foto-Upload, Anzeige und Löschung pro Vorgang
- JSON-Export und -Import für Jobs, Vorlagen, Preislisten und Einstellungen
- PWA-Manifest, Service Worker, Offline-Cache und lokaler Offline-Entwurf
- Responsive Oberfläche mit hellem/dunklem Design, Akzentfarbe und
  reduzierter Bewegung
- README, MIT-Lizenz, CHANGELOG und VERSION

### Notes

- Der JSON-Export enthält keine Fotos und nicht den Nummernstand aus
  `meta.json`; für vollständige Backups das Datenverzeichnis sichern.
- Die App besitzt keine Authentifizierung und ist für LAN/VPN gedacht.
