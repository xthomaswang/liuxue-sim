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
  # 阶段要对、页面上没有异常文字；游戏过程中不该有任何可展开的长文（结局页只允许“回看这次经历”一处）。
  if ! printf '%s' "$summary" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
limit = 1 if d["phase"] == "ENDING" else 0
ok = d["phase"] == sys.argv[1] and not d["problems"] and d["expandButtons"] <= limit
sys.exit(0 if ok else 1)' "$expect" 2>/dev/null; then
    echo "✗ $name：$summary"
    FAILED=1
    return
  fi
  printf '%s\n' "$summary" >"$OUT/$name.json"
  echo "✓ $name：$(printf '%s' "$summary" | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("screenText",None); print(json.dumps(d,ensure_ascii=False))')"
}

# 走到硕士路线需要“本科没有工作机会、学业够、钱够”。这套策略本科以休息为主、只学一次、不求职，
# 事件一律选 B（不做出可展示的成果），所以多半两种工作都没有申请资格；进硕士后再学习和求职。
TO_MASTERS='"focus":["REST","STUDY","REST","CAMPUS","REST","WORK","REST","CAMPUS","STUDY","CAREER","STUDY","CAREER"],"fallback":["REST","CAMPUS","WORK","STUDY","CAREER"],"choices":{"HS_01":"A"},"defaultChoice":"B"'

echo "==> 在真实 WebKit 中自动通关（$DIST）"
run setup-390-light   '{"seed":20261011,"stopAt":"SETUP"}' 390 light full SETUP
run offers-390-light  '{"seed":20261011,"stopAt":"SCHOOL_OFFERS"}' 390 light full SCHOOL_OFFERS
run plan-390-light    '{"seed":20261011,"stopAt":"FOCUS"}' 390 light full FOCUS
run event-390-dark    '{"seed":20261011,"stopAt":"CORE_EVENT"}' 390 dark full CORE_EVENT
run ug-390-dark       '{"seed":7,"after":"card"}' 390 dark "" ENDING
run ms1-560-light     "{\"seed\":100,$TO_MASTERS,\"masters\":\"MS_1Y\",\"requireMasters\":true,\"after\":\"lookback\"}" 560 light full ENDING
run ms2-390-light     "{\"seed\":300,$TO_MASTERS,\"masters\":\"MS_2Y\",\"requireMasters\":true,\"after\":\"card\"}" 390 light "" ENDING
run wide-1200-light   '{"seed":42}' 1200 light full ENDING
run gallery-390-dark  '{"seed":43,"after":"gallery"}' 390 dark full ENDING

# 关掉再打开：第一次运行停在一幕支线事件并写入持久化存储，第二次运行什么都不点，恢复出来的界面必须与第一次完全一样。
SNAP_PERSISTENT=1 run save-before '{"seed":13,"stopAt":"ARC_EVENT"}' 390 light "" ARC_EVENT
SNAP_PERSISTENT=1 run save-after '{"resume":true,"stopAt":"ARC_EVENT","after":"clear"}' 390 light "" ARC_EVENT
if [[ -f "$OUT/save-before.json" && -f "$OUT/save-after.json" ]] && python3 - "$OUT/save-before.json" "$OUT/save-after.json" <<'PY'
import json, sys
before, after = (json.load(open(path)) for path in sys.argv[1:3])
keys = ["phase", "stageTitle", "stats", "screenText"]
sys.exit(0 if all(before[k] == after[k] and before[k] for k in keys) else 1)
PY
then
  echo "✓ 存档恢复：重新打开后阶段、四属性与当前屏内容与关闭前一致"
else
  echo "✗ 存档恢复：重新打开后的界面与关闭前不一致"
  FAILED=1
fi

echo "    截图与脚本在：$OUT"
echo "    系统：macOS $(sw_vers -productVersion)（build $(sw_vers -buildVersion)）"
exit "$FAILED"
