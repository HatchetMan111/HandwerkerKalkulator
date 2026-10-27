# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); die Versionierung
folgt [Semantic Versioning](https://semver.org/lang/de/).

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
