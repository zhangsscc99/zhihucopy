#!/usr/bin/env bash
# verify.sh — FEATURES.md 验收断言执行器。
#
#   scripts/verify.sh <FID>     执行该条目的 verify: 命令；退出码即断言结果
#   scripts/verify.sh --list    列出所有条目：状态 / verify / risk
#
# 规则：在 docs/FEATURES.md 找到 `- [x|-[ ] <FID> ` 条目，取其下方缩进块里
#       第一行 `verify:` 的内容，交给 bash -c 执行。
#       无 verify 行 → 输出「缺验收断言」并退出 2。
# 输出：`[VERIFY] <FID> PASS|FAIL (<耗时>)`
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
FEATURES="docs/FEATURES.md"

[[ -f "$FEATURES" ]] || { echo "[VERIFY] $FEATURES not found" >&2; exit 2; }

# Emit TSV per entry: fid \t done|todo \t verify \t risk
parse() {
  awk '
    /^- \[[ xX]\]/ {
      # close previous entry
      if (fid != "") print fid "\t" state "\t" verify "\t" risk
      fid=""; state=""; verify=""; risk=""
      state=($0 ~ /^- \[[xX]\]/) ? "done" : "todo"
      line=$0; sub(/^- \[[ xX]\][ ]*/, "", line)
      match(line, /^[A-Za-z]*[0-9]+[a-z]*/)
      fid=substr(line, RSTART, RLENGTH)
      next
    }
    fid != "" && /^[ \t]+verify:[ \t]*/ {
      v=$0; sub(/^[ \t]+verify:[ \t]*/, "", v); if (verify=="") verify=v; next
    }
    fid != "" && /^[ \t]+risk:[ \t]*/ {
      r=$0; sub(/^[ \t]+risk:[ \t]*/, "", r); if (risk=="") risk=r; next
    }
    END { if (fid != "") print fid "\t" state "\t" verify "\t" risk }
  ' "$FEATURES"
}

if [[ "${1:-}" == "--list" ]]; then
  parse | while IFS=$'\t' read -r fid state verify risk; do
    mark=$([[ "$state" == "done" ]] && echo "x" || echo " ")
    printf -- '- [%s] %-6s risk=%-4s verify=%s\n' "$mark" "$fid" "${risk:-—}" "${verify:-<缺验收断言>}"
  done
  exit 0
fi

FID="${1:-}"
if [[ -z "$FID" ]]; then
  echo "usage: scripts/verify.sh <FID> | --list" >&2
  exit 2
fi

ROW="$(parse | awk -F'\t' -v f="$FID" '$1==f{print; exit}')"
if [[ -z "$ROW" ]]; then
  echo "[VERIFY] $FID not found in $FEATURES" >&2
  exit 2
fi
VERIFY="$(printf '%s' "$ROW" | cut -f3)"
if [[ -z "$VERIFY" ]]; then
  echo "[VERIFY] $FID 缺验收断言（FEATURES.md 该条目下无 verify: 行）" >&2
  exit 2
fi

echo "[VERIFY] $FID -> $VERIFY"
START=$(date +%s%N)
bash -c "$VERIFY"
RC=$?
MS=$(( ($(date +%s%N) - START) / 1000000 ))
if [[ $RC -eq 0 ]]; then
  printf '[VERIFY] %s PASS (%d.%02ds)\n' "$FID" $((MS/1000)) $(( (MS%1000)/10 ))
else
  printf '[VERIFY] %s FAIL (%d.%02ds)\n' "$FID" $((MS/1000)) $(( (MS%1000)/10 ))
fi
exit "$RC"
