#!/usr/bin/env bash
# scripts/rollback.sh — roll the checkout back to a known-good sha and redeploy.
#
#   usage: scripts/rollback.sh [<sha>]
#          FORCE=1        allow rollback with a dirty worktree (local changes discarded)
#          SKIP_PUBLIC=1  skip the public https://openfolio.uk check
#
# Target sha resolution: $1, else <repo>/.deploy/last-good.sha (the file written by
# scripts/ci-deploy.sh on success). Only that contract file is assumed.
set -euo pipefail

APP_NAME="zhihucopy"
HEALTH_URL="http://127.0.0.1:3030/zhihucopy/api/health"
PUBLIC_URL="https://openfolio.uk/zhihucopy"
HEALTH_TIMEOUT_S=30

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
DEPLOY_DIR="$ROOT/.deploy"
LAST_GOOD="$DEPLOY_DIR/last-good.sha"
HISTORY_LOG="$DEPLOY_DIR/history.log"

TO_SHA=""
FAILED_STEP="init"
LOGGED=0

MARK_NS=$(date +%s%N)

# "[rollback] <step> (<elapsed since previous step>)" — per-step timing.
step() {
  local name="$1" now delta_s delta_cs
  now=$(date +%s%N)
  delta_s=$(( (now - MARK_NS) / 1000000000 ))
  delta_cs=$(( ((now - MARK_NS) / 10000000) % 100 ))
  printf '[rollback] %s (%d.%02ds)\n' "$name" "$delta_s" "$delta_cs"
  MARK_NS=$now
}

record() { # record <event> [detail]
  local event="$1" detail="${2:-}" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$DEPLOY_DIR"
  if [ -n "$detail" ]; then
    printf '%s sha=%s event=%s %s\n' "$ts" "${TO_SHA:-unknown}" "$event" "$detail" >>"$HISTORY_LOG"
  else
    printf '%s sha=%s event=%s\n' "$ts" "${TO_SHA:-unknown}" "$event" >>"$HISTORY_LOG"
  fi
  LOGGED=1
}

fail() {
  local rc="${2:-1}"
  set +e
  printf '[rollback] ERROR: %s\n' "$1" >&2
  if [ "$LOGGED" = "0" ]; then
    record rollback-fail "step=${FAILED_STEP} rc=${rc}"
  fi
  printf '[rollback] FAILED at step: %s (rc=%s)\n' "$FAILED_STEP" "$rc" >&2
  exit "$rc"
}

on_err() {
  local rc=$?
  set +e
  [ "$rc" = "0" ] && exit 0
  fail "step '${FAILED_STEP}' failed" "$rc"
}
trap on_err ERR

# 1. resolve target sha -------------------------------------------------------
USAGE="usage: scripts/rollback.sh [<sha>]   (env: FORCE=1, SKIP_PUBLIC=1)"
if [ -n "${1:-}" ]; then
  SHA_RAW="$1"
  SHA_SRC="arg"
else
  if [ ! -f "$LAST_GOOD" ]; then
    printf '%s\n' "$USAGE" >&2
    fail "no sha argument and no $LAST_GOOD"
  fi
  # drop comments and blank lines, take the first whitespace-delimited token
  SHA_RAW="$(grep -v '^[[:space:]]*#' "$LAST_GOOD" | tr -s '[:space:]' '\n' | grep -v '^$' | head -n1 || true)"
  SHA_SRC="$LAST_GOOD"
  if [ -z "$SHA_RAW" ]; then
    printf '%s\n' "$USAGE" >&2
    fail "$LAST_GOOD contains no sha"
  fi
fi

# 2. validation (read-only, nothing destructive yet) ---------------------------
FAILED_STEP="validate-sha"
git cat-file -e "${SHA_RAW}^{commit}" 2>/dev/null \
  || fail "not a commit in this repo: '$SHA_RAW' (from $SHA_SRC)"

TO_SHA="$(git rev-parse --verify "${SHA_RAW}^{commit}")"
FROM_SHA="$(git rev-parse HEAD)"
step "resolve target sha ${TO_SHA:0:12} (source: $SHA_SRC)"

DIRTY="$(git status --porcelain -- . ':(exclude).deploy' || true)"
if [ -n "$DIRTY" ]; then
  if [ "${FORCE:-0}" != "1" ]; then
    printf '[rollback] dirty worktree:\n%s\n' "$DIRTY" >&2
    fail "refusing to reset a dirty worktree (re-run with FORCE=1 to discard local changes)"
  fi
  printf '[rollback] WARNING: FORCE=1 with dirty worktree, local changes will be discarded:\n%s\n' "$DIRTY" >&2
fi
step "worktree check (FORCE=${FORCE:-0})"

# 3. announce from/to before anything destructive ------------------------------
printf '[rollback] from=%s\n' "$FROM_SHA"
printf '[rollback] to=%s\n' "$TO_SHA"
if [ "$FROM_SHA" = "$TO_SHA" ]; then
  printf '[rollback] already at target sha; rebuild + restart only\n'
fi

FAILED_STEP="git-reset"
git reset --hard "$TO_SHA" >/dev/null
step "git reset --hard ${TO_SHA:0:12}"

FAILED_STEP="client-build"
npm --prefix client run build
step "npm --prefix client run build"

FAILED_STEP="pm2-restart"
if ! pm2 restart "$APP_NAME" --update-env >/dev/null; then
  fail "pm2 restart $APP_NAME failed"
fi
step "pm2 restart $APP_NAME"

# 4. local health gate --------------------------------------------------------
FAILED_STEP="health-check"
code=""
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
while :; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then break; fi
  sleep 1
done
if [ "$code" != "200" ]; then
  fail "health check did not return 200 within ${HEALTH_TIMEOUT_S}s (last: '${code:-no-response}') at $HEALTH_URL"
fi
step "health $HEALTH_URL -> 200"

# 5. optional public check — failure never masks the local success -------------
public_state="skipped"
pcode=""
if [ "${SKIP_PUBLIC:-0}" = "1" ]; then
  printf '[rollback] public check skipped (SKIP_PUBLIC=1)\n'
else
  for _ in 1 2 3; do
    pcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL" || true)"
    if [ "$pcode" = "200" ]; then break; fi
    sleep 2
  done
  if [ "$pcode" = "200" ]; then
    public_state="ok"
    step "public $PUBLIC_URL -> 200"
  else
    public_state="FAIL:${pcode:-no-response}"
    printf '[rollback] WARNING: public check FAIL %s (%s) — local rollback still OK\n' \
      "$PUBLIC_URL" "${pcode:-no-response}" >&2
    step "public ${PUBLIC_URL} -> ${pcode:-no-response} (FAIL, ignored)"
  fi
fi

# 6. record success -----------------------------------------------------------
FAILED_STEP="record-history"
record rollback-ok "from=${FROM_SHA} to=${TO_SHA} public=${public_state}"
FAILED_STEP=""
step "append history (event=rollback-ok)"
printf '[rollback] done: %s -> %s (public=%s)\n' "${FROM_SHA:0:12}" "${TO_SHA:0:12}" "$public_state"
