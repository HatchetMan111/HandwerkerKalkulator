# Handwerker-Kalkulator

Ein lokaler Angebots- und Mengenrechner für Handwerksbetriebe – als schlanke
Web-App im Proxmox-LXC. Keine Cloud, kein Konto, keine Datenbank: Jobs,
Preislisten und Fotos bleiben auf dem eigenen Server.

Die App rechnet Positionen für 20 Gewerke, speichert Vorgänge, erzeugt
Angebote und Rechnungen im DIN-A4-Layout und funktioniert nach dem ersten
Aufruf auch offline im Browser.

## Installation auf Proxmox

Voraussetzungen:

- Proxmox VE 8.x mit root-Zugriff
- Internetzugang für Template, Node.js und GitHub
- ein RootFS-Storage (bevorzugt `local-lvm`, alternativ z. B. `local`)
- ein Debian-12-LXC-Template (der Installer lädt es bei Bedarf)

Einzeiler auf dem **Proxmox-Host**:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerKalkulator/main/install/handwerker-kalkulator.sh)"
```

Alternativ herunterladen und mit Optionen starten:

```bash
wget -O handwerker-kalkulator.sh \
  https://raw.githubusercontent.com/HatchetMan111/HandwerkerKalkulator/main/install/handwerker-kalkulator.sh
bash handwerker-kalkulator.sh --ctid 150 --cores 2 --memory 1024 --disk 8 --bridge vmbr0
```

Der Installer legt einen unprivilegierten LXC mit `nesting=1` und
`onboot=1` an, installiert Node.js 22, kopiert die App, richtet den
systemd-Service ein und prüft Startseite und `/api/health`.

### Optionen

| Option | Default | Bedeutung |
|---|---|---|
| `--ctid ID` | nächste freie ID | Container-ID |
| `--hostname NAME` | `handwerker-kalkulator` | Hostname des Containers |
| `--cores N` | `1` | vCPUs |
| `--memory MB` | `512` | RAM in MB |
| `--disk GB` | `4` | RootFS-Größe in GB |
| `--storage NAME` | automatisch | RootFS-Storage, bevorzugt `local-lvm` |
| `--template-store NAME` | `local` | Storage für LXC-Templates |
| `--bridge NAME` | `vmbr0` | Netzwerk-Bridge |
| `--password PW` | zufällig | Root-Passwort; wird nur bei Neuerstellung angezeigt |
| `--ssh-key PATH` | – | öffentlicher SSH-Key für root |
| `--repo URL` | GitHub-Repo | alternatives Git-Repository |
| `--branch NAME` | `main` | Git-Branch |
| `--local-src PATH` | – | lokales Quellverzeichnis statt Git-Clone |
| `--debug` | aus | ausführliche Shell-Diagnose |
| `-h`, `--help` | – | Hilfe |

Alle Werte lassen sich auch über Umgebungsvariablen setzen:
`CT_ID`, `CORES`, `RAM`, `DISK`, `BRIDGE`, `STORAGE`, `PASSWORD`,
`SSH_KEY`, `REPO_URL`, `BRANCH`, `LOCAL_SRC`, `TEMPLATE_STORE`, `DEBUG`.

### Ressourcen

Die Defaults (1 vCPU, 512 MB RAM, 4 GB Disk) reichen für normale Nutzung.
Für viele Fotos oder mehrere parallele Nutzer sind 2 vCPU und 1 GB RAM
empfohlen. Fotos werden im Datenverzeichnis gespeichert; pro Vorgang sind
maximal 6 Fotos mit je 2 MB möglich.

## Nutzung

Nach der Installation:

```text
http://<container-ip>:8090
```

Die IP und alle Zugangsdaten zeigt der Installer am Ende an. Ein Login gibt
es bewusst nicht – die App ist für ein vertrauenswürdiges LAN oder VPN
gedacht.

Wichtige Funktionen:

- 20 Gewerke mit eigenen Positionen, Einheiten und Formeln
- Mengen- und Materialberechnung, Ressourcen-Overrides pro Vorgang
- Kunden-, Objekt- und Notizfelder
- Angebote und Rechnungen als DIN-A4-Druckansicht
- fortlaufende Nummernkreise für Angebote und Rechnungen
- Vorgänge speichern, duplizieren, löschen und wieder öffnen
- eigene Preislisten, Vorlagen und Einstellungen
- Fotos je Vorgang (JPEG, PNG, WebP)
- JSON-Export/-Import für Jobs, Vorlagen, Preislisten und Einstellungen
- PWA mit Offline-Cache und lokalem Offline-Entwurf

### Gewerke

3D-Druck, Abbruch & Entsorgung, Baumfällung & Grünpflege,
Baustelleneinrichtung, Betonbau, Catering, Dachdecker, Erdbau & Aushub,
Event & Vermietung, Fliesenleger, Fotografie, Garten- & Landschaftsbau,
Landwirtschaft, Maler & Lackierer, Pflasterarbeiten, Reinigung,
Tiefbau & Kanalbau, Trockenbau, Umzug & Transport, Zaunbau.

### Offline

Der Service Worker cached die App-Shell, Assets und alle Gewerke. Im
Browser werden API-Antworten zusätzlich in `localStorage` gespiegelt. Ist
der Server nicht erreichbar, kann ein Vorgang als lokaler Entwurf
gespeichert und nach Rückkehr der Verbindung wieder geöffnet werden.

Hinweise:

- Offline-Entwürfe liegen nur im jeweiligen Browser, nicht auf dem Server.
- Fotos werden nicht offline zwischengespeichert.
- Browserdaten löschen entfernt auch lokale Entwürfe und den PWA-Cache.
- Bei Änderungen an gecachten App-Dateien muss `VERSION` in
  `app/sw.js` erhöht werden, damit Clients die neue Version laden.

## Daten und Backup

Alle dauerhaften Daten liegen unter:

```text
/var/lib/handwerker-kalkulator/
├── jobs.json
├── presets.json
├── pricelists.json
├── settings.json
├── meta.json          # Nummernkreise, Schema
└── fotos/             # Foto-Dateien der Vorgänge
```

Der JSON-Export in den Einstellungen enthält Jobs, Vorlagen, Preislisten,
Einstellungen und den Nummernstand aus `meta.json`. **Fotos sind nicht im
JSON-Export enthalten.** Für ein vollständiges Backup inklusive Fotos daher
das gesamte Datenverzeichnis sichern:

```bash
pct exec 150 -- tar -czf /root/handwerker-kalkulator-backup.tar.gz \
  -C /var/lib handwerker-kalkulator
pct pull 150 /root/handwerker-kalkulator-backup.tar.gz \
  ./handwerker-kalkulator-backup.tar.gz
```

Wiederherstellen:

```bash
pct push 150 ./handwerker-kalkulator-backup.tar.gz /tmp/hk-backup.tar.gz
pct exec 150 -- systemctl stop handwerker-kalkulator
pct exec 150 -- tar -xzf /tmp/hk-backup.tar.gz -C /var/lib
pct exec 150 -- chown -R handwerker:handwerker /var/lib/handwerker-kalkulator
pct exec 150 -- systemctl start handwerker-kalkulator
```

Vor jedem Update und vor dem Löschen des Containers ein Backup anlegen.

## Update

Der Installer ist idempotent. Für ein Update den gleichen Befehl mit der
bestehenden CT-ID erneut ausführen:

```bash
bash handwerker-kalkulator.sh --ctid 150
```

Der Installer aktualisiert die App aus dem konfigurierten Branch, lässt
`/var/lib/handwerker-kalkulator` unangetastet und startet den Service neu.
Beim Update aus einem lokalen Arbeitsverzeichnis:

```bash
bash handwerker-kalkulator.sh --ctid 150 --local-src /root/HandwerkerKalkulator
```

Nach einem App-Update gegebenenfalls den Browser-Cache bzw. den
Service-Worker-Cache leeren, falls noch eine alte Version erscheint.

## Betrieb und Fehlersuche

```bash
pct enter 150
systemctl status handwerker-kalkulator
journalctl -u handwerker-kalkulator -n 100 --no-pager
curl -i http://127.0.0.1:8090/api/health
curl -i http://127.0.0.1:8090/api/version
```

Häufige Probleme:

- **Service startet nicht:** `journalctl -u handwerker-kalkulator` prüfen;
  meist fehlt Node.js oder `/opt/handwerker-kalkulator/server/server.js`.
- **Keine IP:** Bridge und DHCP im Container prüfen (`ip -4 addr`).
- **Port 8090 belegt:** In der Unit `Environment=PORT=` ändern und
  `systemctl daemon-reload && systemctl restart handwerker-kalkulator`.
- **Node-Installation scheitert:** DNS/Internetzugang des Containers prüfen.
- **Alte App-Version im Browser:** Service Worker deregistrieren oder
  `app/sw.js`-`VERSION` erhöhen und neu deployen.

### Reboot-Test

```bash
pct reboot 150
sleep 30
curl -fsS http://<container-ip>:8090/api/health
```

Der Container ist auf `onboot=1` gesetzt; der Service startet automatisch.

## Deinstallation

```bash
pct stop 150
pct destroy 150
```

Das löscht den Container und damit auch alle Daten unter
`/var/lib/handwerker-kalkulator`. Vorher ein Backup anlegen. Auf dem Host
bleiben nur das Installer-Skript und das Log unter `/tmp` zurück.

## Sicherheit

- Die App hat keine Authentifizierung und keine Benutzerverwaltung.
- Nur im vertrauenswürdigen LAN oder über VPN betreiben.
- Nicht direkt ins Internet stellen. Falls Fernzugriff nötig ist, einen
  Reverse Proxy mit Authentifizierung und TLS davorschalten.
- Das Root-Passwort des Containers nach der Installation ändern, wenn es
  nicht ohnehin zufällig erzeugt wurde.
- Das Installationslog unter `/tmp` kann das erzeugte Root-Passwort enthalten;
  nach dem Notieren löschen.
- Regelmäßige Backups des Datenverzeichnisses erstellen.

## Entwicklung

Voraussetzungen: Node.js 22.

```bash
npm start
# oder mit lokalem Datenverzeichnis:
PORT=8090 DATA_DIR=./data npm start
```

Tests:

```bash
npm test
# oder direkt:
node --test
```

Die App liegt unter `app/`, der Server unter `server/`, die Tests unter
`tests/`. Es gibt keine externen Laufzeit-Abhängigkeiten.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
