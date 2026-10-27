#!/usr/bin/env bash
#
# Handwerker-Kalkulator – Proxmox LXC Installer
#
# App:      Handwerker-Kalkulator (Angebots- und Mengenrechner)
# Repo:     https://github.com/HatchetMan111/HandwerkerKalkulator
# Stack:    Node.js 22 + systemd, keine Datenbank, keine Cloud
# Läuft:    vollständig lokal im LXC, Port 8090
# Host:     DIESES SKRIPT LÄUFT AUF DEM PROXMOX-HOST (nicht im Container!)
#
# Usage:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerKalkulator/main/install/handwerker-kalkulator.sh)"
#   bash handwerker-kalkulator.sh --ctid 150 --cores 2 --memory 1024 --disk 8 --bridge vmbr0
#   bash handwerker-kalkulator.sh --local-src /root/HandwerkerKalkulator --ctid 150
#   bash handwerker-kalkulator.sh --help
#
set -euo pipefail
umask 077

# ---------------------------------------------------------------------------
# Variablen
# ---------------------------------------------------------------------------
APP="handwerker-kalkulator"
APP_PORT="8090"
DEFAULT_REPO_URL="https://github.com/HatchetMan111/HandwerkerKalkulator"
DEFAULT_BRANCH="main"
DEFAULT_CORES="1"
DEFAULT_RAM="512"
DEFAULT_SWAP="512"
DEFAULT_DISK="4"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_TEMPLATE_STORE="local"
DEFAULT_OS="debian-12-standard"
UNPRIVILEGED="1"
FEATURES="nesting=1"

APP_USER="handwerker"
APP_DIR="/opt/handwerker-kalkulator"
DATA_DIR="/var/lib/handwerker-kalkulator"

CT_ID="${CT_ID:-${CTID:-}}"
CORES="${CORES:-$DEFAULT_CORES}"
RAM="${RAM:-$DEFAULT_RAM}"
DISK="${DISK:-$DEFAULT_DISK}"
BRIDGE="${BRIDGE:-$DEFAULT_BRIDGE}"
TEMPLATE_STORE="${TEMPLATE_STORE:-$DEFAULT_TEMPLATE_STORE}"
STORAGE_ARG="${STORAGE:-}"
PASSWORD_ARG="${PASSWORD:-}"
SSH_KEY_ARG="${SSH_KEY:-}"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
LOCAL_SRC="${LOCAL_SRC:-}"
CT_HOSTNAME="${CT_HOSTNAME:-$APP}"
DNS_ARG="${DNS:-}"
DEBUG="${DEBUG:-0}"
LOG_FILE="/tmp/${APP}-install-$(date +%F-%H%M%S).log"

# ---------------------------------------------------------------------------
# Logging / Farben
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' \
  C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi

msg_info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
msg_ok()    { echo -e "${C_GREEN}[OK]${C_RESET}    $*"; }
msg_warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
msg_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

exec > >(tee -i "$LOG_FILE") 2>&1
msg_info "Logdatei: $LOG_FILE"

ec=0
trap 'ec=$?; msg_error "FEHLER: Befehl »${BASH_COMMAND}« scheiterte in Zeile ${LINENO} (Exit ${ec})."; msg_error "Vollständiges Log: ${LOG_FILE}"; exit ${ec}' ERR

usage() {
  cat <<EOF
${APP} Proxmox LXC Installer (Port ${APP_PORT})

Usage:
  bash handwerker-kalkulator.sh [OPTIONEN]
  bash -c "\$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerKalkulator/main/install/handwerker-kalkulator.sh)"

Optionen:
  --ctid ID             Container-ID (Default: nächste freie ID)
  --hostname NAME       Hostname (Default: ${APP})
  --cores N             vCPU (Default: ${DEFAULT_CORES})
  --memory MB           RAM in MB (Default: ${DEFAULT_RAM})
  --disk GB             Disk in GB (Default: ${DEFAULT_DISK})
  --storage NAME        RootFS-Storage (Default: auto, bevorzugt local-lvm)
  --template-store NAME Template-Storage (Default: ${DEFAULT_TEMPLATE_STORE})
  --bridge NAME         Netzwerk-Bridge (Default: ${DEFAULT_BRIDGE})
  --dns IP              DNS-Server im Container (Default: automatisch)
  --password PW         Root-Passwort (Default: zufällig, wird angezeigt)
  --ssh-key PATH        SSH Public Key für root (optional)
  --repo URL            Git-Repository (Default: ${DEFAULT_REPO_URL})
  --branch NAME         Git-Branch (Default: ${DEFAULT_BRANCH})
  --local-src PATH      Lokales Quellverzeichnis statt Git-Clone
  --debug               bash -x und ausführliche Fehlerkette
  -h, --help            diese Hilfe

Umgebung:
  CT_ID, CORES, RAM, DISK, BRIDGE, DNS, STORAGE, PASSWORD, SSH_KEY,
  REPO_URL, BRANCH, LOCAL_SRC, TEMPLATE_STORE, DEBUG
EOF
}

require_value() {
  if [[ $# -lt 2 || -z "${2:-}" ]]; then
    msg_error "Option $1 benötigt einen Wert."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Argumente
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid)          require_value "$1" "${2:-}"; CT_ID="$2"; shift 2;;
    --hostname)      require_value "$1" "${2:-}"; CT_HOSTNAME="$2"; shift 2;;
    --cores)         require_value "$1" "${2:-}"; CORES="$2"; shift 2;;
    --memory)        require_value "$1" "${2:-}"; RAM="$2"; shift 2;;
    --disk)          require_value "$1" "${2:-}"; DISK="$2"; shift 2;;
    --storage)       require_value "$1" "${2:-}"; STORAGE_ARG="$2"; shift 2;;
    --template-store) require_value "$1" "${2:-}"; TEMPLATE_STORE="$2"; shift 2;;
    --bridge)        require_value "$1" "${2:-}"; BRIDGE="$2"; shift 2;;
    --dns)           require_value "$1" "${2:-}"; DNS_ARG="$2"; shift 2;;
    --password)      require_value "$1" "${2:-}"; PASSWORD_ARG="$2"; shift 2;;
    --ssh-key)       require_value "$1" "${2:-}"; SSH_KEY_ARG="$2"; shift 2;;
    --repo)          require_value "$1" "${2:-}"; REPO_URL="$2"; shift 2;;
    --branch)        require_value "$1" "${2:-}"; BRANCH="$2"; shift 2;;
    --local-src)     require_value "$1" "${2:-}"; LOCAL_SRC="$2"; shift 2;;
    --debug)         DEBUG="1"; shift;;
    -h|--help)       usage; exit 0;;
    *)               msg_error "Unbekannte Option: $1"; usage; exit 1;;
  esac
done

if [[ "$DEBUG" == "1" ]]; then
  export PS4='+ ${BASH_SOURCE##*/}:${LINENO}: '
  set -x
fi

# ---------------------------------------------------------------------------
# Host-Prüfung / Validierung
# ---------------------------------------------------------------------------
[[ "$(id -u)" -eq 0 ]] || { msg_error "Bitte als root auf dem Proxmox-Host ausführen."; exit 1; }
for cmd in pct pvesh pveam pvesm openssl; do
  command -v "$cmd" >/dev/null 2>&1 || { msg_error "$cmd nicht gefunden – ist das ein Proxmox-Host?"; exit 1; }
done

[[ "$CORES" =~ ^[0-9]+$ && "$CORES" -ge 1 ]] || { msg_error "--cores muss eine positive Zahl sein."; exit 1; }
[[ "$RAM" =~ ^[0-9]+$ && "$RAM" -ge 256 ]] || { msg_error "--memory muss mindestens 256 MB sein."; exit 1; }
[[ "$DISK" =~ ^[0-9]+$ && "$DISK" -ge 2 ]] || { msg_error "--disk muss mindestens 2 GB sein."; exit 1; }
[[ "$CT_HOSTNAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || { msg_error "Ungültiger Hostname: $CT_HOSTNAME"; exit 1; }
if [[ -n "$DNS_ARG" && ! "$DNS_ARG" =~ ^[0-9A-Fa-f:.]+$ ]]; then
  msg_error "Ungültiger DNS-Server: $DNS_ARG"
  exit 1
fi

if [[ -n "$LOCAL_SRC" ]]; then
  if ! LOCAL_SRC="$(cd "$LOCAL_SRC" && pwd)"; then
    msg_error "Lokales Quellverzeichnis nicht gefunden."
    exit 1
  fi
  [[ -f "$LOCAL_SRC/package.json" && -f "$LOCAL_SRC/server/server.js" ]] \
    || { msg_error "--local-src zeigt nicht auf das Handwerker-Kalkulator-Repo: $LOCAL_SRC"; exit 1; }
fi

if [[ -z "$CT_ID" ]]; then
  CT_ID="$(pvesh get /cluster/nextid | tr -d '[:space:]"')"
  msg_info "Nächste freie CT-ID: $CT_ID"
fi
[[ "$CT_ID" =~ ^[0-9]+$ ]] || { msg_error "Ungültige CT-ID: $CT_ID"; exit 1; }

if [[ -z "$STORAGE_ARG" ]]; then
  if pvesm status --storage local-lvm >/dev/null 2>&1; then
    STORAGE_ARG="local-lvm"
  else
    STORAGE_ARG="$(pvesm status -content rootdir | awk 'NR>1 {print $1; exit}')"
  fi
fi
[[ -n "$STORAGE_ARG" ]] || { msg_error "Kein RootFS-Storage gefunden."; exit 1; }

msg_info "Storage: $STORAGE_ARG | Template-Store: $TEMPLATE_STORE | Bridge: $BRIDGE"
msg_info "Quelle: ${LOCAL_SRC:-$REPO_URL ($BRANCH)}"

# ---------------------------------------------------------------------------
# Template sicherstellen
# ---------------------------------------------------------------------------
msg_info "Prüfe LXC-Template ..."
pveam update >/dev/null 2>&1 || msg_warn "pveam update scheiterte – nutze vorhandene Templates."
AVAILABLE_TEMPLATES="$(pveam available --section system 2>/dev/null || true)"
TEMPLATE="$(printf '%s\n' "$AVAILABLE_TEMPLATES" | grep -oP "${DEFAULT_OS}[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" | sort -V | tail -n1 || true)"
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_warn "Kein ${DEFAULT_OS}-Template – suche neuestes Debian-Standard-Template als Fallback ..."
  TEMPLATE="$(printf '%s\n' "$AVAILABLE_TEMPLATES" | grep -oP "debian-[0-9]+-standard[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" | sort -V | tail -n1 || true)"
fi
[[ -n "${TEMPLATE:-}" ]] || { msg_error "Kein Debian-Standard-Template gefunden. Bitte 'pveam update' prüfen."; exit 1; }
if ! pveam list "$TEMPLATE_STORE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg_info "Lade Template $TEMPLATE ..."
  pveam download "$TEMPLATE_STORE" "$TEMPLATE"
fi
msg_ok "Template bereit: ${TEMPLATE_STORE}:vztmpl/${TEMPLATE}"

# ---------------------------------------------------------------------------
# Container erstellen
# ---------------------------------------------------------------------------
CT_CREATED="0"
if pct status "$CT_ID" >/dev/null 2>&1; then
  msg_warn "CT $CT_ID existiert – Update-Modus (keine Neuerstellung)."
else
  CT_CREATED="1"
  if [[ -z "$PASSWORD_ARG" ]]; then
    if [[ "$DEBUG" == "1" ]]; then set +x; fi
    PASSWORD_ARG="$(openssl rand -hex 12)"
  fi
  msg_info "Erstelle CT $CT_ID ($CT_HOSTNAME): $CORES vCPU / $RAM MB / ${DISK} GB ..."
  if [[ "$DEBUG" == "1" ]]; then set +x; fi
  pct create "$CT_ID" "${TEMPLATE_STORE}:vztmpl/${TEMPLATE}" \
    --hostname "$CT_HOSTNAME" \
    --cores "$CORES" --memory "$RAM" --swap "$DEFAULT_SWAP" \
    --rootfs "${STORAGE_ARG}:${DISK}" \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
    --unprivileged "$UNPRIVILEGED" --features "$FEATURES" \
    --onboot 1 \
    --password "$PASSWORD_ARG"
  if [[ "$DEBUG" == "1" ]]; then set -x; fi
  msg_ok "CT $CT_ID erstellt (unprivilegiert, nesting, onboot=1)."
fi

if [[ "$(pct status "$CT_ID" | awk '{print $2}')" != "running" ]]; then
  pct start "$CT_ID"
fi

msg_info "Warte auf Container-Netz ..."
CT_IP=""
for _ in $(seq 1 30); do
  sleep 2
  CT_IP="$(pct exec "$CT_ID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk 'NR==1 {split($4,a,"/"); print a[1]}' || true)"
  [[ -n "$CT_IP" ]] || CT_IP="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "$CT_IP" ]] && break
done
[[ -n "$CT_IP" ]] || { msg_error "Keine Container-IP – Netzwerk/Bridge prüfen."; exit 1; }
msg_ok "Container-IP: $CT_IP"

if [[ -n "$SSH_KEY_ARG" ]]; then
  [[ -f "$SSH_KEY_ARG" ]] || { msg_error "SSH-Key nicht gefunden: $SSH_KEY_ARG"; exit 1; }
  pct exec "$CT_ID" -- mkdir -p /root/.ssh
  pct push "$CT_ID" "$SSH_KEY_ARG" /root/.ssh/authorized_keys
  pct exec "$CT_ID" -- chmod 700 /root/.ssh
  pct exec "$CT_ID" -- chmod 600 /root/.ssh/authorized_keys
  msg_ok "SSH-Key installiert."
fi

if [[ "$CT_CREATED" == "0" ]]; then
  msg_info "Stoppe bestehenden Dienst für das Update ..."
  pct exec "$CT_ID" -- systemctl stop "$APP" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Node.js 22 und Systembenutzer im Container
# ---------------------------------------------------------------------------
# Node.js 22 + Appquelle werden auf dem Host geladen und in den Container
# geschoben. So ist die Installation unabhängig von DNS/apt im Container.
fetch_file() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-delay 2 -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    msg_error "Weder curl noch wget auf dem Host gefunden."
    return 1
  fi
}

msg_info "Installiere Node.js 22 im Container (Host-seitige Quelle) ..."
NODE_DIST_URL="https://nodejs.org/dist/latest-v22.x/"
NODE_TARBALL_NAME="$(fetch_file "$NODE_DIST_URL" - | sed -n 's/.*\(node-v22\.[0-9][0-9]*\.[0-9][0-9]*-linux-x64\.tar\.gz\).*/\1/p' | head -n1)"
[[ -n "$NODE_TARBALL_NAME" ]] || { msg_error "Node.js-Tarball konnte nicht ermittelt werden."; exit 1; }
NODE_TARBALL="$(mktemp "/tmp/${APP}-node-XXXXXX.tar.gz")"
fetch_file "${NODE_DIST_URL}${NODE_TARBALL_NAME}" "$NODE_TARBALL"
pct push "$CT_ID" "$NODE_TARBALL" "/tmp/${APP}-node.tar.gz"
rm -f "$NODE_TARBALL"

if [[ -n "$LOCAL_SRC" ]]; then
  msg_info "Übertrage lokale Quelle nach ${APP_DIR} ..."
  APP_TARBALL="$(mktemp "/tmp/${APP}-src-XXXXXX.tar.gz")"
  tar -C "$LOCAL_SRC" \
    --exclude=.git --exclude=node_modules --exclude=.superpowers --exclude=data \
    -czf "$APP_TARBALL" .
else
  msg_info "Hole App aus ${REPO_URL} (${BRANCH}) ..."
  REPO_URL="${REPO_URL%/}"
  REPO_URL="${REPO_URL%.git}"
  APP_TARBALL="$(mktemp "/tmp/${APP}-src-XXXXXX.tar.gz")"
  fetch_file "${REPO_URL}/archive/refs/heads/${BRANCH}.tar.gz" "$APP_TARBALL"
fi
pct push "$CT_ID" "$APP_TARBALL" "/tmp/${APP}-src.tar.gz"
rm -f "$APP_TARBALL"

pct exec "$CT_ID" -- tar --version >/dev/null 2>&1 \
  || { msg_error "tar fehlt im Container."; exit 1; }

pct exec "$CT_ID" -- bash -c '
  set -euo pipefail
  rm -rf /opt/node
  mkdir -p /opt/node
  tar -xzf /tmp/handwerker-kalkulator-node.tar.gz -C /opt/node --strip-components=1
  ln -sfn /opt/node/bin/node /usr/bin/node
  chmod +x /opt/node/bin/node
  rm -f /tmp/handwerker-kalkulator-node.tar.gz
  node --version
'
msg_ok "Node.js $(pct exec "$CT_ID" -- node --version) installiert."

pct exec "$CT_ID" -- bash -c '
  set -euo pipefail
  getent group handwerker >/dev/null 2>&1 || groupadd --system handwerker
  id -u handwerker >/dev/null 2>&1 || useradd --system --gid handwerker --home-dir /var/lib/handwerker-kalkulator --shell /usr/sbin/nologin handwerker
  mkdir -p /opt/handwerker-kalkulator /var/lib/handwerker-kalkulator
  chown -R handwerker:handwerker /var/lib/handwerker-kalkulator
  chmod 750 /var/lib/handwerker-kalkulator
'

pct exec "$CT_ID" -- bash -c '
  set -euo pipefail
  rm -rf /opt/handwerker-kalkulator
  mkdir -p /opt/handwerker-kalkulator
  tar -xzf /tmp/handwerker-kalkulator-src.tar.gz -C /opt/handwerker-kalkulator --strip-components=1
  rm -f /tmp/handwerker-kalkulator-src.tar.gz
  test -f /opt/handwerker-kalkulator/server/server.js
  test -f /opt/handwerker-kalkulator/app/index.html
  chown -R root:handwerker /opt/handwerker-kalkulator
  find /opt/handwerker-kalkulator -type d -exec chmod 755 {} +
  find /opt/handwerker-kalkulator -type f -exec chmod 644 {} +
'
msg_ok "App-Quelle bereit: ${APP_DIR}"

# ---------------------------------------------------------------------------
# systemd-Unit
# ---------------------------------------------------------------------------
UNIT_PATH="/etc/systemd/system/${APP}.service"
if pct exec "$CT_ID" -- test -f "${APP_DIR}/systemd/${APP}.service"; then
  pct exec "$CT_ID" -- install -m 0644 "${APP_DIR}/systemd/${APP}.service" "$UNIT_PATH"
  msg_ok "systemd-Unit aus dem Repo übernommen."
else
  msg_warn "Unit nicht im Repo gefunden – schreibe Inline-Unit."
  pct push "$CT_ID" /dev/stdin "$UNIT_PATH" <<UNIT
[Unit]
Description=Handwerker-Kalkulator – Angebots- und Mengenrechner
Documentation=https://github.com/HatchetMan111/HandwerkerKalkulator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=DATA_DIR=${DATA_DIR}
ExecStart=/opt/node/bin/node ${APP_DIR}/server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
fi

pct exec "$CT_ID" -- systemctl daemon-reload
pct exec "$CT_ID" -- systemctl enable --now "$APP"
pct exec "$CT_ID" -- systemctl restart "$APP"
msg_ok "Service ${APP} aktiviert und (neu) gestartet."

# ---------------------------------------------------------------------------
# Verifikation
# ---------------------------------------------------------------------------
msg_info "Verifiziere Installation ..."
pct exec "$CT_ID" -- systemctl is-active --quiet "$APP" \
  || { msg_error "Service ${APP} ist nicht active."; pct exec "$CT_ID" -- systemctl status "$APP" --no-pager || true; exit 1; }

HEALTH_CODE="000"
ROOT_CODE="000"
for _ in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1; then
    HEALTH_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "http://${CT_IP}:${APP_PORT}/api/health" 2>/dev/null || true)"
    ROOT_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "http://${CT_IP}:${APP_PORT}/" 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    HEALTH_CODE="$(wget -qO /dev/null -S "http://${CT_IP}:${APP_PORT}/api/health" 2>&1 | awk '/HTTP\// {print $2; exit}')"
    ROOT_CODE="$(wget -qO /dev/null -S "http://${CT_IP}:${APP_PORT}/" 2>&1 | awk '/HTTP\// {print $2; exit}')"
  fi
  HEALTH_CODE="${HEALTH_CODE:-000}"
  ROOT_CODE="${ROOT_CODE:-000}"
  if [[ "$HEALTH_CODE" == "200" && "$ROOT_CODE" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "$HEALTH_CODE" != "200" || "$ROOT_CODE" != "200" ]]; then
  msg_error "App antwortet nicht (Health: ${HEALTH_CODE}, Startseite: ${ROOT_CODE})."
  pct exec "$CT_ID" -- systemctl status "$APP" --no-pager || true
  pct exec "$CT_ID" -- journalctl -u "$APP" --no-pager -n 100 || true
  pct exec "$CT_ID" -- ss -ltn || true
  exit 1
fi

msg_ok "Service läuft (systemctl is-active ${APP} = active)."
msg_ok "Health-Endpunkt: HTTP ${HEALTH_CODE} | Startseite: HTTP ${ROOT_CODE}."

if [[ "$DEBUG" == "1" ]]; then set +x; fi
echo ""
echo "════════════════ INSTALLATION ERFOLGREICH ════════════════"
echo "  App           : Handwerker-Kalkulator"
echo "  Repo          : ${REPO_URL}"
echo "  Container     : CT ${CT_ID} (${CT_HOSTNAME}, unprivilegiert, onboot=1)"
echo "  Ressourcen    : ${CORES} vCPU / ${RAM} MB RAM / ${DISK} GB Disk"
echo "  Endpoint      : http://${CT_IP}:${APP_PORT}"
echo "  Health        : http://${CT_IP}:${APP_PORT}/api/health"
echo "  Daten         : ${DATA_DIR}"
if [[ "$CT_CREATED" == "1" ]]; then
  echo "  Root-Passwort : ${PASSWORD_ARG} (nur jetzt angezeigt!)"
else
  echo "  Root-Passwort : <bestehender CT, unverändert>"
fi
echo "  Service       : systemctl status ${APP}  (im Container: pct enter ${CT_ID})"
echo "  Update        : Installer erneut mit --ctid ${CT_ID} ausführen"
echo "  Reboot-Test   : pct reboot ${CT_ID} && sleep 30 && curl -fsS http://${CT_IP}:${APP_PORT}/api/health"
echo "  Deinstall     : pct stop ${CT_ID} && pct destroy ${CT_ID}   (löscht auch ${DATA_DIR}!)"
echo "  Log           : ${LOG_FILE}"
echo "══════════════════════════════════════════════════════════"
echo ""
msg_warn "Kein Login: nur im vertrauenswürdigen LAN/VPN betreiben, nicht ins Internet stellen."
