#!/usr/bin/env bash
# report.sh — 生成一轮运行的验收报告到 docs/runs/<YYYY-MM-DD_HHMM>.md
#
# 内容：本轮合并的 commit 列表（last-good.sha..HEAD）、每条 FEATURES 的 verify 执行结果、
#       E2E 汇总（含截图路径）、部署健康（本地 + 公网）、风险等级统计。
# 纯 bash + node，无第三方依赖。
# 退出码：有 verify FAIL 或 E2E gate FAIL → 1（报告照常生成）。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
unset NODE_CHANNEL_FD NODE_CHANNEL_SERIALIZATION_MODE

TS="$(date +%Y-%m-%d_%H%M)"
OUT="docs/runs/${TS}.md"
mkdir -p docs/runs
TMP="$(mktemp -d /tmp/zh-report.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

LOCAL_HEALTH="http://127.0.0.1:3030/zhihucopy/api/health"
PUBLIC_URL="https://openfolio.uk/zhihucopy"

# ---- 1. commits in this round ----
LAST_GOOD="$(cat .deploy/last-good.sha 2>/dev/null || true)"
if [[ -n "$LAST_GOOD" ]] && git cat-file -e "${LAST_GOOD}^{commit}" 2>/dev/null; then
  RANGE="${LAST_GOOD}..HEAD"
else
  RANGE="HEAD~10..HEAD"
fi
git log --oneline --no-decorate "$RANGE" >"$TMP/commits.txt" 2>/dev/null || git log --oneline -10 >"$TMP/commits.txt"

# ---- 2. parse FEATURES.md: fid \t done|todo \t verify \t risk ----
awk '
  /^- \[[ xX]\]/ {
    if (fid != "") print fid "\t" state "\t" verify "\t" risk
    fid=""; state=""; verify=""; risk=""
    state=($0 ~ /^- \[[xX]\]/) ? "done" : "todo"
    line=$0; sub(/^- \[[ xX]\][ ]*/, "", line)
    match(line, /^[A-Za-z]*[0-9]+[a-z]*/); fid=substr(line, RSTART, RLENGTH)
    next
  }
  fid != "" && /^[ \t]+verify:[ \t]*/ { v=$0; sub(/^[ \t]+verify:[ \t]*/, "", v); if (verify=="") verify=v; next }
  fid != "" && /^[ \t]+risk:[ \t]*/   { r=$0; sub(/^[ \t]+risk:[ \t]*/, "", r); if (risk=="") risk=r; next }
  END { if (fid != "") print fid "\t" state "\t" verify "\t" risk }
' docs/FEATURES.md >"$TMP/entries.tsv"

# ---- 3. verify each FID that has an assertion ----
echo "[report] running verify for all FIDs..."
: >"$TMP/verify.tsv"
FAILS=0
while IFS=$'\t' read -r fid state verify risk; do
  [[ -z "$fid" ]] && continue
  if [[ -z "$verify" ]]; then
    printf '%s\t%s\t0\t%s\t%s\n' "$fid" "—" "${risk:-—}" "(缺验收断言)" >>"$TMP/verify.tsv"
    continue
  fi
  t0=$(date +%s%N)
  bash -c "$verify" >"$TMP/v_$fid.log" 2>&1
  rc=$?
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  st="PASS"; [[ $rc -ne 0 ]] && { st="FAIL"; FAILS=$((FAILS+1)); }
  printf '%s\t%s\t%d.%d\t%s\t%s\n' "$fid" "$st" $((ms/1000)) $(( (ms%1000)/100 )) "${risk:-—}" "$verify" >>"$TMP/verify.tsv"
  echo "  $fid $st"
done <"$TMP/entries.tsv"

# ---- 4. e2e suite ----
echo "[report] running e2e suite..."
node scripts/e2e/run-all.mjs --json "$TMP/e2e.json" >"$TMP/e2e.log" 2>&1
E2E_RC=$?

# ---- 5. deploy health ----
LOCAL_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$LOCAL_HEALTH" 2>/dev/null || echo 000)"
LOCAL_BODY="$(curl -s --max-time 10 "$LOCAL_HEALTH" 2>/dev/null | head -c 200)"
PUBLIC_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo 000)"

# ---- 6. risk stats (all entries that declare risk) ----
awk -F'\t' '$4 ~ /^(low|med|high)$/ {tot[$4]++} END {for(k in tot) printf "%s %d\n", k, tot[k]}' "$TMP/entries.tsv" >"$TMP/risk.txt"
awk -F'\t' '$2=="FAIL" {fail[$4]++} END {for(k in fail) printf "%s %d\n", k, fail[k]}' "$TMP/verify.tsv" >"$TMP/riskfail.txt"

# ---- emit ----
{
  echo "# 运行报告 $TS"
  echo
  echo "- HEAD: \`$(git rev-parse --short HEAD)\`  分支: $(git branch --show-current)"
  echo "- 区间: \`$RANGE\`"
  echo
  echo "## 本轮合并的 commit"
  echo '```'
  cat "$TMP/commits.txt"
  echo '```'
  echo
  echo "## FEATURES verify 结果"
  echo
  echo '| FID | 结果 | 耗时(s) | risk | verify |'
  echo '|-----|------|--------|------|--------|'
  while IFS=$'\t' read -r fid st secs risk verify; do
    printf '| %s | %s | %s | %s | `%s` |\n' "$fid" "$st" "$secs" "$risk" "${verify:0:80}"
  done <"$TMP/verify.tsv"
  echo
  PASS_N=$(awk -F'\t' '$2=="PASS"' "$TMP/verify.tsv" | wc -l)
  FAIL_N=$(awk -F'\t' '$2=="FAIL"' "$TMP/verify.tsv" | wc -l)
  MISS_N=$(awk -F'\t' '$2=="—"' "$TMP/verify.tsv" | wc -l)
  echo "汇总：**$PASS_N PASS / $FAIL_N FAIL / $MISS_N 无断言**"
  echo
  echo "## E2E 结果"
  echo
  echo '```'
  cat "$TMP/e2e.log"
  echo '```'
  if [[ -f "$TMP/e2e.json" ]]; then
    echo
    echo '| 脚本 | 结果 | 耗时 | 截图 |'
    echo '|------|------|------|------|'
    node -e '
      const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      for(const t of r.results){
        console.log(`| ${t.script} | ${t.pass?"PASS":(t.required?"FAIL":"PENDING")} | ${t.secs}s | ${t.shot||"—"} |`);
      }' "$TMP/e2e.json"
  fi
  echo
  echo "## 部署健康"
  echo
  echo "- 本地 health: $LOCAL_HEALTH → HTTP $LOCAL_CODE  \`$LOCAL_BODY\`"
  echo "- 公网入口:   $PUBLIC_URL → HTTP $PUBLIC_CODE"
  echo
  echo "## 风险等级统计"
  echo
  echo '| risk | 条目数 | 其中 verify FAIL |'
  echo '|------|--------|------------------|'
  for k in low med high; do
    n=$(awk -v k="$k" '$1==k{print $2}' "$TMP/risk.txt"); n=${n:-0}
    f=$(awk -v k="$k" '$1==k{print $2}' "$TMP/riskfail.txt"); f=${f:-0}
    echo "| $k | $n | $f |"
  done
  echo
  echo "_generated by scripts/report.sh_"
} >"$OUT"

echo "[report] written: $OUT (verify fails=$FAILS e2e_rc=$E2E_RC)"
[[ $FAILS -eq 0 && $E2E_RC -eq 0 ]]
