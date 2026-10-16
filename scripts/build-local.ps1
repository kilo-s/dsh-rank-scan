# 本机构建（不建 junction：沙箱禁止 symlink）
# 用 dsh checkout 自带的 tsc 直接编译 src → lib
# 注：本文件必须带 UTF-8 BOM，否则 Windows PowerShell 5.1 会按 GBK 读中文导致解析失败
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tsc = 'C:\Users\Kilometer\dsh-harness\node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { throw "tsc 不存在：$tsc" }
Push-Location $root
try {
  & $tsc -p tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw "tsc 失败（exit $LASTEXITCODE）" }
  Write-Host "构建完成：$root\lib"
} finally { Pop-Location }
