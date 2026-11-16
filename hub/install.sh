#!/bin/sh
# Installs the Lookabout hub with Docker on a 64-bit Raspberry Pi OS, Debian or Ubuntu machine.
#
#   ./install.sh                         ask nothing, use the defaults
#   ./install.sh --name "Home hub" --port 8787 --usb /dev/video0
#   ./install.sh --print                 show what it would write and run, change nothing
#   ./install.sh --dry-run               write .env and the USB override, but don't run Docker
#
# Contacts, only when it runs: get.docker.com (only if Docker is missing, and only with --install-docker),
# and the registries Docker pulls the base images from (Docker Hub, Google Cloud Storage for the cry model,
# the Go module proxy for go2rtc). It sends nothing about you.
set -eu
cd "$(dirname "$0")"

NAME="lookabout-hub"; PORT="8787"; PRINT=0; DRY=0; INSTALL_DOCKER=0; USB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --usb) USB="$USB $2"; shift 2 ;;
    --print) PRINT=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

case "$PORT" in ''|*[!0-9]*) echo "The port should be a number, such as 8787." >&2; exit 2 ;; esac
case "$NAME" in *[\"\'\$\`\\]*|'') echo "The name can't be empty or contain quotes, \$ or backslashes." >&2; exit 2 ;; esac
for dev in $USB; do
  case "$dev" in /dev/video[0-9]*) ;; *) echo "A USB webcam looks like /dev/video0, not: $dev" >&2; exit 2 ;; esac
done

env_file() { printf 'LOOKABOUT_HUB_NAME=%s\nLOOKABOUT_HUB_PORT=%s\n' "$NAME" "$PORT"; }
override_file() {
  [ -n "$USB" ] || return 0
  printf 'services:\n  hub:\n    devices:\n'
  for dev in $USB; do printf '      - %s:%s\n' "$dev" "$dev"; done
}

if [ "$PRINT" = 1 ]; then
  echo "# .env"; env_file
  if [ -n "$USB" ]; then echo; echo "# docker-compose.override.yml"; override_file; fi
  echo; echo "# then:"; echo "docker compose up -d --build"
  exit 0
fi

case "$(uname -m)" in
  aarch64|arm64|x86_64|amd64) ;;
  *) echo "This needs a 64-bit system (found $(uname -m)). On a Raspberry Pi, install the 64-bit Raspberry Pi OS." >&2; exit 1 ;;
esac

if [ "$DRY" = 0 ] && ! command -v docker >/dev/null 2>&1; then
  if [ "$INSTALL_DOCKER" = 1 ]; then
    echo "Docker is missing. Installing it from get.docker.com (needs sudo)…"
    curl -fsSL https://get.docker.com | sh
  else
    echo "Docker isn't installed. Run again with --install-docker to install it from get.docker.com," >&2
    echo "or install it yourself first: https://docs.docker.com/engine/install/" >&2
    exit 1
  fi
fi

env_file > .env
echo "Wrote .env (name: $NAME, port: $PORT)"
if [ -n "$USB" ]; then override_file > docker-compose.override.yml; echo "Wrote docker-compose.override.yml for:$USB"; fi
[ "$DRY" = 1 ] && { echo "Dry run: not starting Docker."; exit 0; }

if [ ! -f web/index.html ]; then
  echo "Note: no web/ folder, so the hub will show a status page until you add the web app (npm run hub:web)."
fi
docker compose up -d --build

echo "Waiting for the hub to answer…"
i=0
until curl -fsS "http://127.0.0.1:$PORT/api/hub" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -le 60 ] || { echo "The hub didn't answer in 2 minutes. See: docker compose logs hub" >&2; exit 1; }
  sleep 2
done

HOST="$(hostname).local"
echo
echo "The hub is running."
echo "  Open:        http://$HOST:$PORT   (or http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT)"
CODE="$(docker compose logs hub 2>/dev/null | sed -n 's/.*Setup code for the first admin: //p' | tail -n 1)"
if [ -n "$CODE" ]; then echo "  Setup code:  $CODE   (type it where Lookabout asks, then make the first admin)"; fi
