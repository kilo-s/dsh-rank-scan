#!/bin/bash
# 薄包装：真正的构建是纯 Node 的 scripts/build.mjs（Windows 上没有可用 bash，git 直装必须走 Node）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/build.mjs"
