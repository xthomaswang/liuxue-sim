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

# docs/09 第 3 节那条可复核路线：seed 13、LOW 家庭，本科拿到博士机会且两个硕士方案都可选。
ROUTE_13='"seed":13,"economy":"LOW","aspiration":"DISCOVERY","focus":["WORK","STUDY","WORK","STUDY","WORK","STUDY","WORK","WORK","STUDY","REST","STUDY","REST"],"choices":{"HS_01":"A","HS_02":"B","CORE_01":"B","CORE_02":"B","ARC_CREATIVE_1":"B","CORE_03":"B","ARC_RESEARCH_1":"B","CORE_04":"B","ARC_CREATIVE_2":"B","CORE_05":"B","ARC_RESEARCH_2":"A","CORE_06":"A","ARC_CREATIVE_3":"B","CORE_07":"A","ARC_RESEARCH_3":"A","CORE_08":"A"}'

FAILED=0
run() {
  local name="$1" config="$2" width="$3" theme="$4" full="$5" expect="$6"
  local script="$OUT/$name.js" png="$OUT/$name.png" output
  { printf 'const CONFIG = %s;\n' "$config"; cat "$ROOT/scripts/e2e/pilot.js"; } >"$script"
  if ! output="$("$BIN" "http://127.0.0.1:$PORT/index.html" "$width" 844 "$png" "$script" "$theme" $full 2>&1)"; then
    echo "✗ $name：$output"
    FAILED=1
    return
  fi
  local summary
  summary="$(printf '%s\n' "$output" | sed -n 's/^script -> //p')"
  if [[ "$summary" != *"\"phase\":\"$expect\""* || "$summary" != *'"problems":[]'* ]]; then
    echo "✗ $name：$summary"
    FAILED=1
    return
  fi
  echo "✓ $name：$summary"
}

echo "==> 在真实 WebKit 中自动通关（$DIST）"
run setup-390-light     '{"seed":20261011,"economy":"MID","aspiration":"BELONGING","stopAt":"SETUP"}' 390 light full SETUP
run offers-390-light    '{"seed":20261011,"economy":"MID","aspiration":"BELONGING","stopAt":"SCHOOL_OFFERS"}' 390 light full SCHOOL_OFFERS
run ug-phd-390-dark     "{$ROUTE_13,\"after\":\"card\"}" 390 dark "" ENDING
run ms1-560-light       "{$ROUTE_13,\"masters\":\"MS_1Y\",\"after\":\"expand\"}" 560 light full ENDING
run ms2-390-light       "{$ROUTE_13,\"masters\":\"MS_2Y\",\"after\":\"card\"}" 390 light "" ENDING
run auto-high-1200-light '{"seed":7,"economy":"HIGH","aspiration":"INDEPENDENCE"}' 1200 light full ENDING
run auto-mid-390-dark   '{"seed":42,"economy":"MID","aspiration":"BELONGING","masters":"MS_2Y","after":"gallery"}' 390 dark full ENDING

echo "    截图与脚本在：$OUT"
echo "    系统：macOS $(sw_vers -productVersion)（build $(sw_vers -buildVersion)）"
exit "$FAILED"
