#!/usr/bin/env bash
# ci-deploy.sh — single deployment gate: build -> migrate check -> smoke -> pm2 restart -> recheck.
# Any step failure aborts; failures after pm2 restart trigger rollback.
#
# Env switches:
#   SKIP_SMOKE=1   skip the isolated smoke-server suite (not recommended)
#   SKIP_PUBLIC=1  skip the public https://openfolio.uk/zhihucopy check
#   SMOKE_PORT     port for the throwaway smoke server (default 3987)
set -euo pipefail

# Some launchers (pm2 --update-env chains, Hermes/CI wrappers) export
# NODE_CHANNEL_FD; a nested `node` then believes it is an IPC child process and
# SIGABRTs on exit. Strip those channel vars so every node call here is standalone.
unset NODE_CHANNEL_FD NODE_CHANNEL_SERIALIZATION_MODE

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PM2_APP="zhihucopy"
BASE="/zhihucopy/api"
PROD_URL="http://127.0.0.1:3030${BASE}"
PUBLIC_URL="https://openfolio.uk/zhihucopy"
SMOKE_PORT="${SMOKE_PORT:-3987}"
SMOKE_URL="http://127.0.0.1:${SMOKE_PORT}${BASE}"
DEPLOY_DIR=".deploy"

STEP="init"
STEP_START=$SECONDS
RESTARTED=0
SMOKE_PID=""
SMOKE_DB=""
SMOKE_LOG=""
RESP_FILE="$(mktemp /tmp/ci-deploy-resp.XXXXXX.json)"

log() { echo "[ci-deploy] $*"; }
step() { STEP="$1"; STEP_START=$SECONDS; log "$STEP"; }
end_step() { log "$STEP ok (${SECONDS}s elapsed, step took $((SECONDS - STEP_START))s)"; STEP=""; }

cleanup_smoke() {
  if [[ -n "$SMOKE_PID" ]] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
  SMOKE_PID=""
  if [[ -n "$SMOKE_LOG" ]]; then
    rm -f "$SMOKE_LOG"
    SMOKE_LOG=""
  fi
  if [[ -n "$SMOKE_DB" ]]; then
    rm -f "$SMOKE_DB" "$SMOKE_DB-wal" "$SMOKE_DB-shm" "$SMOKE_DB-journal"
    SMOKE_DB=""
  fi
}

history() { # event note
  mkdir -p "$DEPLOY_DIR"
  printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse HEAD 2>/dev/null || echo unknown)" "$1" "$2" >>"$DEPLOY_DIR/history.log"
}

on_exit() {
  local rc=$?
  cleanup_smoke
  rm -f "$RESP_FILE"
  if (( rc != 0 )); then
    log "FAIL ${STEP:-unknown} (exit $rc)"
    if (( RESTARTED )); then
      if [[ -f scripts/rollback.sh ]]; then
        log "invoking scripts/rollback.sh"
        bash scripts/rollback.sh
        exit $?
      else
        log "no scripts/rollback.sh — manual rollback:"
        log "  git checkout \$(cat .deploy/last-good.sha) && npm run build && pm2 restart $PM2_APP --update-env"
      fi
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT

# Extract a JSON field via node (guaranteed present); exits non-zero if missing.
json_get() { # json_get <expr>  (reads stdin; expr appended to parsed object, e.g. '.token')
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s)$1;if(v===undefined||v===null)process.exit(1);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){process.exit(1)}})"
}

# req <method> <url> [json-body] [token] -> writes body to stdout, asserts HTTP 2xx.
req() {
  local m="$1" u="$2" body="${3:-}" token="${4:-}" code
  local args=(-s -o "$RESP_FILE" -w '%{http_code}' -X "$m" --max-time 15)
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  code="$(curl "${args[@]}" "$u")" || code="000"
  if [[ ! "$code" =~ ^2 ]]; then
    log "smoke: $m $u -> HTTP $code"
    sed 's/.*/  resp: &/' "$RESP_FILE" 2>/dev/null || true
    return 1
  fi
  cat "$RESP_FILE"
}

# wait_http <url> <seconds> — poll until HTTP 200.
wait_http() {
  local url="$1" max="$2" i
  for ((i = 0; i < max; i++)); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)" == "200" ]] && return 0
    sleep 1
  done
  return 1
}

# --- a. preflight ------------------------------------------------------------
step "preflight"
for bin in node npm pm2 curl git; do
  command -v "$bin" >/dev/null || { log "missing binary: $bin"; exit 1; }
done
[[ -f server/index.js && -f package.json ]] || { log "not at repo root (server/index.js missing)"; exit 1; }
touch .ci-deploy-write-test && rm -f .ci-deploy-write-test || { log "repo dir not writable"; exit 1; }
if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  log "WARN: working tree not clean (continuing)"
  git status --porcelain | sed 's/^/  /'
fi
mkdir -p "$DEPLOY_DIR"
end_step

# --- b. build ----------------------------------------------------------------
step "build"
npm --prefix client run build
[[ -f client/dist/index.html ]] || { log "client/dist/index.html missing after build"; exit 1; }
end_step

# --- c. migrate check ---------------------------------------------------------
step "migrate-check"
node -e "const {getDb}=require('./server/db'); const d=getDb(); d.prepare('select 1').get(); d.close(); console.log('db ok')"
end_step

# --- d. smoke (isolated port + throwaway DB) ----------------------------------
step "smoke"
if [[ "${SKIP_SMOKE:-0}" == "1" ]]; then
  log "SKIP_SMOKE=1 — skipping smoke suite"
else
  SMOKE_DB="/tmp/zh-smoke-$$.db"
  SMOKE_LOG="/tmp/zh-smoke-$$.log"
  # Never smoke against a live listener: a port collision would leak writes into
  # the production DB (and the checks would pass against the wrong process).
  if [[ "$SMOKE_PORT" == "3030" ]]; then
    log "SMOKE_PORT must differ from the production port 3030"
    exit 1
  fi
  if curl -s -o /dev/null --max-time 2 "$SMOKE_URL/health" 2>/dev/null; then
    log "port $SMOKE_PORT is already serving — refusing to run smoke against a live service"
    exit 1
  fi
  rm -f "$SMOKE_DB" "$SMOKE_DB-wal" "$SMOKE_DB-shm"
  PORT="$SMOKE_PORT" DB_PATH="$SMOKE_DB" JWT_SECRET=smoke-secret node server/index.js >"$SMOKE_LOG" 2>&1 &
  SMOKE_PID=$!
  wait_http "$SMOKE_URL/health" 20 || { log "smoke server did not come up"; sed 's/^/  srv: /' "$SMOKE_LOG"; exit 1; }

  SMOKE_EMAIL="ci-$RANDOM-$RANDOM@example.com"
  TOKEN="$(req POST "$SMOKE_URL/auth/register" "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"ci-pass-123\",\"nickname\":\"ci-bot\"}" | json_get '.token')" \
    || { log "smoke: register failed"; exit 1; }
  TOKEN="$(req POST "$SMOKE_URL/auth/login" "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"ci-pass-123\"}" | json_get '.token')" \
    || { log "smoke: login failed"; exit 1; }
  UID_="$(req GET "$SMOKE_URL/auth/me" "" "$TOKEN" | json_get '.user.id')" \
    || { log "smoke: GET me failed"; exit 1; }
  QID="$(req POST "$SMOKE_URL/questions" '{"title":"CI smoke question?","detail_md":"auto"}' "$TOKEN" | json_get '.question.id')" \
    || { log "smoke: create question failed"; exit 1; }
  req GET "$SMOKE_URL/questions?tab=new" | json_get '.items[0].id' >/dev/null \
    || { log "smoke: question list failed"; exit 1; }
  req GET "$SMOKE_URL/questions/$QID" | json_get '.question.id' >/dev/null \
    || { log "smoke: question detail failed"; exit 1; }
  AID="$(req POST "$SMOKE_URL/questions/$QID/answers" '{"content_md":"CI smoke answer."}' "$TOKEN" | json_get '.answer.id')" \
    || { log "smoke: create answer failed"; exit 1; }
  req GET "$SMOKE_URL/questions/$QID/answers" | json_get '.items[0].id' >/dev/null \
    || { log "smoke: answer list failed"; exit 1; }
  log "smoke flow ok (uid=$UID_ qid=$QID aid=$AID)"
  log "SKIP: vote/comment/search/feed endpoints not implemented — not tested"

  cleanup_smoke
fi
end_step

# --- e. record rollback point --------------------------------------------------
step "record-deploy-start"
SHA="$(git rev-parse HEAD)"
echo "$SHA" >"$DEPLOY_DIR/last-good.sha"
history "deploy-start" "sha=$SHA"
end_step

# --- f. restart ---------------------------------------------------------------
step "pm2-restart"
# Never let test-time env leak into the production process: DB_PATH/LOG_PATH set by
# the smoke step (or an inherited shell) would make pm2 serve a throwaway database.
unset DB_PATH LOG_PATH SMOKE_PORT SMOKE_DB NODE_CHANNEL_FD NODE_CHANNEL_SERIALIZATION_MODE
pm2 restart "$PM2_APP" --update-env >/dev/null 2>&1 || true
restart_env_ok() {
  local pid
  pid="$(pm2 pid "$PM2_APP" 2>/dev/null | head -1)"
  [[ -n "$pid" && -r "/proc/$pid/environ" ]] || return 1
  ! tr '\0' '\n' <"/proc/$pid/environ" | grep -qE '^(DB_PATH|LOG_PATH)='
}
if ! restart_env_ok; then
  # pm2 remembered the polluted env from a previous --update-env: rebuild the app
  # from ecosystem.config.cjs so the process gets a clean environment.
  log "pm2 kept DB_PATH/LOG_PATH in the process env — recreating from ecosystem.config.cjs"
  pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs >/dev/null 2>&1 || { log "pm2 start ecosystem.config.cjs failed"; exit 1; }
  pm2 save >/dev/null 2>&1 || true
  sleep 2
  restart_env_ok || { log "process env still carries DB_PATH/LOG_PATH"; history "deploy-fail" "stage=env-leak"; exit 1; }
fi
RESTARTED=1
end_step

# --- g. recheck ---------------------------------------------------------------
step "recheck-local"
wait_http "$PROD_URL/health" 30 || { log "local health check failed after restart"; history "deploy-fail" "stage=local-health"; exit 1; }
end_step

if [[ "${SKIP_PUBLIC:-0}" == "1" ]]; then
  log "SKIP_PUBLIC=1 — skipping public check"
  history "public-check-skip" ""
else
  step "recheck-public"
  PUB_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo 000)"
  if [[ "$PUB_CODE" != "200" ]]; then
    log "public check failed: $PUBLIC_URL -> HTTP $PUB_CODE"
    history "deploy-fail" "stage=public-check http=$PUB_CODE"
    exit 1
  fi
  end_step
fi

# --- h. success ----------------------------------------------------------------
step "finalize"
echo "$SHA" >"$DEPLOY_DIR/last-good.sha"
history "deploy-ok" "sha=$SHA"
end_step

log "deploy complete: $SHA"
