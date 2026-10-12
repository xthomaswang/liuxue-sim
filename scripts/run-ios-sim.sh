#!/usr/bin/env bash
# 构建 iOS 模拟器版，启动模拟器并安装、运行。
#
# 用法：scripts/run-ios-sim.sh [设备名] [--screenshot <png>] [--headless]
#   设备名        默认 "iPhone 17"（xcrun simctl list devices available 里的名字）
#   --screenshot  启动后截一张图存到指定路径
#   --headless    不打开 Simulator 窗口（只在后台启动设备）
# 需要先有网页构建产物（项目根目录运行 npm run build）；本脚本不运行 npm。
# 环境变量：LIUXUE_WEB_DIST  网页构建目录，默认 <项目根>/dist
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIST="${LIUXUE_WEB_DIST:-$ROOT/dist}"
DERIVED="$ROOT/apple/DerivedData"
LOG="$DERIVED/build-ios-sim.log"
BUNDLE_ID="com.tuomasier.liuxuesim"

DEVICE="iPhone 17"
SCREENSHOT=""
HEADLESS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --screenshot)
      SCREENSHOT="${2:?--screenshot 需要一个 png 路径}"
      shift 2
      ;;
    --headless)
      HEADLESS=1
      shift
      ;;
    -h | --help)
      sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      DEVICE="$1"
      shift
      ;;
  esac
done

if [[ ! -f "$WEB_DIST/index.html" ]]; then
  echo "找不到网页构建产物：$WEB_DIST/index.html" >&2
  echo "先在项目根目录运行 npm run build（或用 LIUXUE_WEB_DIST 指定已构建的目录）。" >&2
  exit 1
fi
WEB_DIST="$(cd "$WEB_DIST" && pwd)"

# 按名字精确匹配一台可用设备（"iPhone 17" 不会匹配到 "iPhone 17e"）。
UDID="$(xcrun simctl list devices available | awk -v name="$DEVICE" '
  {
    line = $0
    sub(/^[ \t]+/, "", line)
    if (index(line, name " (") == 1 &&
        match(line, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) {
      print substr(line, RSTART, RLENGTH)
      exit
    }
  }')"
if [[ -z "$UDID" ]]; then
  echo "找不到名为 \"$DEVICE\" 的可用模拟器。可用设备：" >&2
  xcrun simctl list devices available | grep -E "iPhone|iPad" >&2 || true
  exit 1
fi

mkdir -p "$DERIVED"
echo "==> 构建 iOS 模拟器版，设备：$DEVICE（$UDID），网页目录：$WEB_DIST"
if ! xcodebuild \
  -project "$ROOT/apple/LiuxueSim.xcodeproj" \
  -scheme LiuxueSim \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" \
  LIUXUE_WEB_DIST="$WEB_DIST" \
  build >"$LOG" 2>&1; then
  grep -E "error[: ]" "$LOG" | head -20 >&2 || true
  echo "构建失败，完整日志：$LOG" >&2
  exit 1
fi
APP="$DERIVED/Build/Products/Debug-iphonesimulator/LiuxueSim.app"

echo "==> 启动模拟器并安装"
xcrun simctl bootstatus "$UDID" -b >/dev/null
if [[ "$HEADLESS" -eq 0 ]]; then
  open -a Simulator --args -CurrentDeviceUDID "$UDID"
fi
xcrun simctl install "$UDID" "$APP"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null

if [[ -n "$SCREENSHOT" ]]; then
  sleep 4
  mkdir -p "$(dirname "$SCREENSHOT")"
  xcrun simctl io "$UDID" screenshot "$SCREENSHOT" >/dev/null
  echo "    截图：$SCREENSHOT"
fi

echo "==> 已在 $DEVICE 上启动 $BUNDLE_ID"
echo "    看日志：xcrun simctl spawn $UDID log stream --predicate 'subsystem == \"$BUNDLE_ID\"'"
echo "    关模拟器：xcrun simctl shutdown $UDID"
echo "    系统：macOS $(sw_vers -productVersion)（build $(sw_vers -buildVersion)）"
echo "    工具：$(xcodebuild -version | tr '\n' ' ')"
