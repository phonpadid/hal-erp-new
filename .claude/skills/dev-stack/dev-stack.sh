#!/usr/bin/env bash
# dev-stack.sh — bring the local ERP dev stack up, look at it, run the e2e suite, take it down.
#
# Everything here is idempotent: `up` twice starts nothing twice, it just reports what is
# already answering. Long-running servers are detached with setsid so this script can exit
# while they keep running, and their process-group id is what `down` kills.
#
#   ./dev-stack.sh up [--web-only|--api-only]   start infra + API + web, wait until each answers
#   ./dev-stack.sh status                       what is running, on which port, under which pid
#   ./dev-stack.sh e2e [playwright args...]     back/ Playwright API suite (starts the API first)
#   ./dev-stack.sh logs [api|web] [lines]       tail a dev-server log
#   ./dev-stack.sh restart [api|web]            stop one server and start it again
#   ./dev-stack.sh down [--all]                 stop API + web (--all also stops the containers)
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
LOG_DIR="$ROOT/logs"
RUN_DIR="$LOG_DIR/.run"
mkdir -p "$RUN_DIR"

# back/.env is the single source of truth for the API port — playwright.config.ts and
# e2e/support/api.ts both derive their base URL from it, so reading it here keeps all
# three in agreement instead of hardcoding a fourth default.
env_get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/back/.env" 2>/dev/null | head -1 | tr -d '"' | tr -d '\r'; }

API_PORT=${PORT:-$(env_get PORT)}
API_PORT=${API_PORT:-3000}
WEB_PORT=${WEB_PORT:-5173}
API_URL="http://localhost:$API_PORT/api-new"
# vite's `base` is /new/ (nginx serves the SPA from a sub-path), so the app is NOT at the root.
WEB_URL="http://localhost:$WEB_PORT/new/"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_dim=$'\033[90m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad()  { printf '%s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
dim()  { printf '%s%s%s\n' "$c_dim" "$*" "$c_off"; }

api_up() { curl -fs -o /dev/null --max-time 3 "$API_URL"; }
web_up() { curl -fs -o /dev/null --max-time 3 "$WEB_URL"; }
docker_ready() { docker info >/dev/null 2>&1; }
# `ss` is Linux-only; on macOS fall back to lsof so a native postgres on :5433 is seen.
port_busy() {
  if command -v ss >/dev/null 2>&1; then ss -ltnH "sport = :$1" 2>/dev/null | grep -q .;
  else lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; fi
}

# Wait for a predicate, printing a dot a second so a slow first compile does not look like a hang.
wait_for() { # wait_for <fn> <seconds> <label>
  local fn=$1 limit=$2 label=$3 i=0
  while ! "$fn"; do
    i=$((i + 1))
    if [ "$i" -ge "$limit" ]; then printf '\n'; return 1; fi
    printf '.'
    sleep 1
  done
  [ "$i" -gt 0 ] && printf '\n'
  return 0
}

pidfile() { echo "$RUN_DIR/$1.pid"; }
live_pid() { # echo the recorded pid if that process group is still alive
  local f; f=$(pidfile "$1")
  [ -f "$f" ] || return 1
  local p; p=$(cat "$f")
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null && { echo "$p"; return 0; }
  rm -f "$f"; return 1
}

# setsid puts the server in its own process group, so `kill -- -PID` reaches nest/vite AND the
# node children they spawn. Killing the pnpm pid alone orphans the actual server on the port.
spawn() { # spawn <name> <logfile> <cmd...>
  local name=$1 log=$2; shift 2
  : > "$log"
  # macOS has no setsid; `set -m` gives the background job its own process group instead.
  if command -v setsid >/dev/null 2>&1; then setsid "$@" >>"$log" 2>&1 < /dev/null &
  else (set -m; exec "$@" >>"$log" 2>&1 < /dev/null) &
  fi
  echo $! > "$(pidfile "$name")"
}

stop_one() { # stop_one <name> <port> <label>
  local name=$1 port=$2 label=$3 p
  if p=$(live_pid "$name"); then
    kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
    for _ in $(seq 1 10); do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$p" 2>/dev/null
    rm -f "$(pidfile "$name")"
    ok "$label stopped (pid $p)"
  elif port_busy "$port"; then
    # Started outside this script (a terminal tab, a previous session). Only ever kill node —
    # never whatever else happens to hold the port.
    local pids; pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null)
    local killed=0 pid
    for pid in $pids; do
      case "$(ps -p "$pid" -o comm= 2>/dev/null)" in
        node|*node*) kill -TERM "$pid" 2>/dev/null && killed=1 ;;
      esac
    done
    if [ "$killed" = 1 ]; then ok "$label stopped (port $port, started outside this script)"
    else bad "port $port is held by a non-node process — left alone:"; lsof -i "tcp:$port" -sTCP:LISTEN 2>/dev/null | sed 1d; fi
  else
    dim "$label was not running"
  fi
}

ensure_deps() {
  [ -d "$ROOT/node_modules" ] || { say "pnpm install…"; (cd "$ROOT" && pnpm install) || return 1; }
  # The backend imports @erp/shared from its CommonJS dist build; vite aliases the TS source.
  # So a missing dist breaks the API only — and breaks it at import time, before any log line.
  [ -f "$ROOT/shared/dist/index.js" ] || { say "building @erp/shared…"; (cd "$ROOT" && pnpm --filter @erp/shared build) || return 1; }
}

ensure_infra() {
  local db_host db_port
  db_host=$(env_get DB_HOST); db_host=${db_host:-localhost}
  db_port=$(env_get DB_PORT); db_port=${db_port:-5432}

  # back/.env decides where the data is. Pointed at another machine, the local containers are
  # beside the point — starting them would only mask which database the API actually talks to.
  case "$db_host" in
    localhost|127.0.0.1|0.0.0.0|::1) ;;
    *) dim "DB_HOST=$db_host is remote — leaving docker alone"; return 0 ;;
  esac

  # A postgres already answering on that port is the one the API will use, container or not.
  if port_busy "$db_port"; then
    ok "postgres reachable on :$db_port"
    port_busy 9000 || dim "note: MinIO (:9000) is down — attachment upload/preview will fail"
    return 0
  fi

  if ! docker_ready; then
    bad "nothing is listening on :$db_port and the Docker daemon is not running."
    say "  start it, then re-run:  sudo systemctl start docker"
    say "  (or point back/.env at a postgres you already run)"
    return 1
  fi

  say "starting postgres + minio…"
  (cd "$ROOT" && docker compose up -d) || { bad "docker compose up failed"; return 1; }
  local i=0
  while [ "$(docker inspect -f '{{.State.Health.Status}}' erp-postgres 2>/dev/null)" != healthy ]; do
    i=$((i + 1)); [ "$i" -ge 60 ] && { bad "postgres never became healthy — docker compose logs postgres"; return 1; }
    printf '.'; sleep 1
  done
  [ "$i" -gt 0 ] && printf '\n'
  ok "postgres + minio healthy"
}

ensure_api() {
  if api_up; then ok "API already up — $API_URL"; return 0; fi
  if port_busy "$API_PORT"; then
    bad "port $API_PORT is busy but $API_URL does not answer — check what is on it:"
    lsof -i "tcp:$API_PORT" -sTCP:LISTEN 2>/dev/null | sed 1d
    return 1
  fi
  ensure_infra || return 1
  say "starting API (nest start --watch) → logs/api.log"
  spawn api "$LOG_DIR/api.log" pnpm --dir "$ROOT/back" run start:dev
  if wait_for api_up 120 API; then
    ok "API up — $API_URL  (pid $(cat "$(pidfile api)"))"
  else
    bad "API did not answer within 120s. Last 40 lines of logs/api.log:"
    tail -40 "$LOG_DIR/api.log"
    return 1
  fi
}

ensure_web() {
  if web_up; then ok "web already up — $WEB_URL"; return 0; fi
  if port_busy "$WEB_PORT"; then
    bad "port $WEB_PORT is busy but $WEB_URL does not answer:"
    lsof -i "tcp:$WEB_PORT" -sTCP:LISTEN 2>/dev/null | sed 1d
    return 1
  fi
  say "starting web (vite) → logs/web.log"
  # --strictPort: vite would otherwise slide to 5174, and .auth/*.json storage states are
  # bound to origin http://localhost:5173, so a drifting port silently logs the browser out.
  spawn web "$LOG_DIR/web.log" pnpm --dir "$ROOT/front-end" run dev -- --port "$WEB_PORT" --strictPort
  if wait_for web_up 90 web; then
    ok "web up — $WEB_URL  (pid $(cat "$(pidfile web)"))"
  else
    bad "web did not answer within 90s. Last 40 lines of logs/web.log:"
    tail -40 "$LOG_DIR/web.log"
    return 1
  fi
}

cmd_status() {
  say "API  $API_URL"
  if api_up; then ok "  answering$(live_pid api >/dev/null && echo " (pid $(live_pid api))")"; else bad "  down$(port_busy "$API_PORT" && echo " (port $API_PORT busy)")"; fi
  say "web  $WEB_URL"
  if web_up; then ok "  answering$(live_pid web >/dev/null && echo " (pid $(live_pid web))")"; else bad "  down$(port_busy "$WEB_PORT" && echo " (port $WEB_PORT busy)")"; fi
  say "infra"
  if docker_ready; then
    docker compose -f "$ROOT/docker-compose.yml" ps --format '  {{.Service}}\t{{.Status}}'
  else
    bad "  Docker daemon not running (sudo systemctl start docker)"
    port_busy "$(env_get DB_PORT)" && ok "  but postgres answers on :$(env_get DB_PORT) — a non-docker instance"
  fi
  dim "DB_NAME=$(env_get DB_NAME)@$(env_get DB_HOST):$(env_get DB_PORT)  ·  logs: logs/api.log logs/web.log"
}

cmd_up() {
  case "${1:-}" in
    --api-only) ensure_deps && ensure_api ;;
    --web-only) ensure_deps && ensure_web ;;
    *)          ensure_deps && ensure_api && ensure_web ;;
  esac || return 1
  dim "login page: $WEB_URL  ·  credentials live in back/.env (BOOTSTRAP_USERNAME / BOOTSTRAP_PASSWORD)"
}

cmd_e2e() {
  ensure_deps || return 1
  # playwright.config.ts has its own webServer with reuseExistingServer, but it runs `pnpm start`
  # (no watch, and it dies with the run). Starting the API here means the suite attaches to the
  # same server the browser and the rest of the session are using.
  ensure_api || return 1
  say "running back/ e2e against $API_URL — this WRITES to $(env_get DB_NAME) (idempotent E2E-SBX sandbox)"
  (cd "$ROOT/back" && pnpm exec playwright test "$@")
}

cmd_down() {
  stop_one api "$API_PORT" API
  stop_one web "$WEB_PORT" web
  if [ "${1:-}" = "--all" ]; then
    docker_ready && (cd "$ROOT" && docker compose stop) && ok "postgres + minio stopped"
  fi
}

cmd_logs() {
  local which=${1:-api} n=${2:-60}
  case "$which" in
    api|web) tail -n "$n" "$LOG_DIR/$which.log" ;;
    *) bad "usage: logs [api|web] [lines]"; return 1 ;;
  esac
}

cmd_restart() {
  case "${1:-}" in
    api) stop_one api "$API_PORT" API; ensure_api ;;
    web) stop_one web "$WEB_PORT" web; ensure_web ;;
    *)   cmd_down; cmd_up ;;
  esac
}

case "${1:-up}" in
  up)      shift; cmd_up "$@" ;;
  status)  cmd_status ;;
  e2e)     shift; cmd_e2e "$@" ;;
  down)    shift; cmd_down "$@" ;;
  logs)    shift; cmd_logs "$@" ;;
  restart) shift; cmd_restart "$@" ;;
  *)       sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
