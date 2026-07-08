#!/usr/bin/env bash
# Cadence control script — thin wrapper over docker compose.
# Usage: ./run.sh {start|stop|restart|logs|status}
set -euo pipefail
cd "$(dirname "$0")"

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then return; fi
  echo "Docker not found — installing via get.docker.com (needs sudo)."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  echo "Docker installed. If 'permission denied' follows, log out/in (or run: newgrp docker)."
}

case "${1:-}" in
  start)
    ensure_docker
    if [ ! -f .env ]; then
      echo "No .env found — creating one with a random AUTH_SECRET."
      printf 'AUTH_SECRET=%s\nAUTH_URL=http://localhost:3000\n' "$(openssl rand -base64 32)" > .env
    fi
    docker compose up -d
    echo "Cadence up → http://localhost:3000"
    ;;
  stop)    docker compose down ;;
  restart) docker compose down && docker compose up -d ;;
  logs)    docker compose logs -f "${2:-app}" ;;   # ./run.sh logs [service]
  status)  docker compose ps ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs|status}"
    exit 1
    ;;
esac
