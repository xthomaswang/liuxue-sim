#!/usr/bin/env bash
# 真实 WebKit 端到端冒烟：用离屏 WKWebView 加载构建产物，自动点完几条完整路线并截图。
# WKWebView 与 iOS / macOS 外壳是同一个引擎，所以这也是对两个外壳里网页部分的检查。
#
# 用法：scripts/e2e-webkit.sh [输出目录，默认 build/e2e]
# 需要先有网页构建产物（npm run build）；本脚本不运行 npm。需要 macOS 与 Xcode 命令行工具（swiftc）。
# 环境变量：LIUXUE_WEB_DIST  网页构建目录，默认 <项目根>/dist
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${LIUXUE_WEB_DIST:-$ROOT/dist}"
OUT="${1:-$ROOT/build/e2e}"

if [[ ! -f "$DIST/index.html" ]]; then
  echo "找不到网页构建产物：$DIST/index.html，先运行 npm run build。" >&2
  exit 1
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
rm -f "$OUT"/*.json "$OUT"/*.png "$OUT"/*.js

BIN="$OUT/snap"
if [[ ! -x "$BIN" || "$ROOT/scripts/e2e/snap.swift" -nt "$BIN" ]]; then
  echo "==> 编译截图工具"
  swiftc -O "$ROOT/scripts/e2e/snap.swift" -o "$BIN"
fi

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIST" >"$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break
  sleep 0.1
done

FAILED=0
# run <名字> <CONFIG 的 JSON> <宽> <light|dark> <full 或空> <期望停在的阶段>
run() {
  local name="$1" config="$2" width="$3" theme="$4" full="$5" expect="$6"
  local script="$OUT/$name.js" png="$OUT/$name.png" output summary
  { printf 'const CONFIG = %s;\n' "$config"; cat "$ROOT/scripts/e2e/pilot.js"; } >"$script"
  if ! output="$("$BIN" "http://127.0.0.1:$PORT/index.html" "$width" 844 "$png" "$script" "$theme" $full 2>&1)"; then
    echo "✗ $name：$output"
    FAILED=1
    return
  fi
  summary="$(printf '%s\n' "$output" | sed -n 's/^script -> //p')"
  # 停在预期的那一屏、页面上没有异常文字、没有任何可展开的长文。
  if ! printf '%s' "$summary" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
ok = d["phase"] == sys.argv[1] and not d["problems"] and d["expandButtons"] == 0
sys.exit(0 if ok else 1)' "$expect" 2>/dev/null; then
    echo "✗ $name：$summary"
    FAILED=1
    return
  fi
  printf '%s\n' "$summary" >"$OUT/$name.json"
  echo "✓ $name：$(printf '%s' "$summary" | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("screenText",None); print(json.dumps(d,ensure_ascii=False))')"
}

echo "==> 在真实 WebKit 中自动通关（$DIST）"
run home-390-light     '{"seed":1,"stopAt":"HOME"}' 390 light full HOME
run talents-390-light  '{"seed":20261012,"stopAt":"TALENTS"}' 390 light full TALENTS
run allocate-390-light '{"seed":20261012,"stopAt":"ALLOCATE","points":{"family":3,"academics":8,"career":5,"wellbeing":4}}' 390 light full ALLOCATE
run timeline-390-dark  '{"seed":20261012,"stopAt":"TIMELINE"}' 390 dark full TIMELINE
# 第四版：一直点到毕业后的几年，截一张长图看暑假、GPA、毕业后每一年的样子。
run years-390-light    '{"seed":20261012,"stopAt":"TIMELINE","reveal":40}' 390 light full TIMELINE
run life-390-light     '{"seed":20261012}' 390 light full SUMMARY
run life-560-dark      '{"seed":7,"points":{"family":9,"academics":3,"career":4,"wellbeing":4},"after":"card"}' 560 dark "" SUMMARY
run wide-1200-light    '{"seed":42,"mode":"skip","after":"rewards"}' 1200 light "" SUMMARY
# 连续十二局：成就、解锁的天赋和图册进度要能跨局累计。
run marathon-390-light '{"seed":100,"runs":12,"mode":"skip","after":"gallery"}' 390 light full SUMMARY
if [[ -f "$OUT/marathon-390-light.json" ]] && python3 - "$OUT/marathon-390-light.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
runs = d["runs"]
ok = len(runs) == 12 and all(r["tier"] and r["combo"] and r["life"] for r in runs) and sum(r["newAchievements"] for r in runs) >= 3
sys.exit(0 if ok else 1)
PY
then
  echo "✓ 连续十二局：每局都有结局卡和五年后的结局，成就在累计"
else
  echo "✗ 连续十二局：结局卡、五年后的结局或成就累计不对"
  FAILED=1
fi

# 关掉再打开：第一次运行停在人生轨迹中途并写入持久化存储，第二次运行什么都不点，恢复出来的界面必须与第一次完全一样。
SNAP_PERSISTENT=1 run save-before '{"seed":13,"stopAt":"TIMELINE"}' 390 light "" TIMELINE
SNAP_PERSISTENT=1 run save-after '{"resume":true,"stopAt":"TIMELINE","after":"clear"}' 390 light "" TIMELINE
if [[ -f "$OUT/save-before.json" && -f "$OUT/save-after.json" ]] && python3 - "$OUT/save-before.json" "$OUT/save-after.json" <<'PY'
import json, sys
before, after = (json.load(open(path)) for path in sys.argv[1:3])
keys = ["phase", "stats", "screenText"]
sys.exit(0 if all(before[k] == after[k] and before[k] for k in keys) else 1)
PY
then
  echo "✓ 存档恢复：重新打开后是同一局、同一进度"
else
  echo "✗ 存档恢复：重新打开后的界面与关闭前不一致"
  FAILED=1
fi

echo "    截图与脚本在：$OUT"
echo "    系统：macOS $(sw_vers -productVersion)（build $(sw_vers -buildVersion)）"
exit "$FAILED"
