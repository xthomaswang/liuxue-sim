#!/usr/bin/env bash
# 构建 macOS 版，导出到 build/LiuxueSim.app（ad-hoc 签名，本机双击即可打开）。
#
# 用法：scripts/build-mac.sh
# 需要先有网页构建产物（项目根目录运行 npm run build）；本脚本不运行 npm。
# 环境变量：
#   LIUXUE_WEB_DIST  网页构建目录，默认 <项目根>/dist
#   CONFIGURATION    Xcode 配置，默认 Release
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIST="${LIUXUE_WEB_DIST:-$ROOT/dist}"
CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED="$ROOT/apple/DerivedData"
OUT="$ROOT/build/LiuxueSim.app"
LOG="$DERIVED/build-mac.log"

if [[ ! -f "$WEB_DIST/index.html" ]]; then
  echo "找不到网页构建产物：$WEB_DIST/index.html" >&2
  echo "先在项目根目录运行 npm run build（或用 LIUXUE_WEB_DIST 指定已构建的目录）。" >&2
  exit 1
fi
WEB_DIST="$(cd "$WEB_DIST" && pwd)"

mkdir -p "$DERIVED"
echo "==> 构建 macOS 版（$CONFIGURATION），网页目录：$WEB_DIST"
if ! xcodebuild \
  -project "$ROOT/apple/LiuxueSim.xcodeproj" \
  -scheme LiuxueSim \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "$DERIVED" \
  LIUXUE_WEB_DIST="$WEB_DIST" \
  build >"$LOG" 2>&1; then
  grep -E "error[: ]" "$LOG" | head -20 >&2 || true
  echo "构建失败，完整日志：$LOG" >&2
  exit 1
fi

BUILT="$DERIVED/Build/Products/$CONFIGURATION/LiuxueSim.app"
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
ditto "$BUILT" "$OUT"
codesign --verify --deep --strict "$OUT"

echo "==> 产物：$OUT"
echo "    打开：open \"$OUT\""
echo "    架构：$(lipo -archs "$OUT/Contents/MacOS/LiuxueSim")"
echo "    签名：$(codesign -dv "$OUT" 2>&1 | grep -E '^Signature=' || echo '未知')（ad-hoc 只适合本机运行，不能分发）"
echo "    系统：macOS $(sw_vers -productVersion)（build $(sw_vers -buildVersion)）"
echo "    工具：$(xcodebuild -version | tr '\n' ' ')"
