<#
  扫榜插件（dsh-rank-scan）安装脚本 —— Windows / PowerShell

  用法：
    pwsh -File scripts\install.ps1 -Spec "E:\path\to\dsh-rank-scan-0.2.1.tgz"   # Release 附件
    pwsh -File scripts\install.ps1                                              # 目录直装（= link:<本目录>，开发用）
    pwsh -File scripts\install.ps1 -Profile dev -Spec "link:E:\path\to\repo"
  缺省 -Profile desktop；装完去 DSH 侧栏找「扫榜」入口。

  注意：缺省的目录直装要求本目录**已经构建**（有 lib/index.js）—— 缺了就直接报错退出，
  不会让 dsh 拿一个只有源码的目录去装（那会以「面板不出现」的形式静默失败）。
#>
param(
  [string]$Profile = "desktop",
  [string]$Spec = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $Spec) {
  $entry = Join-Path $root "lib\index.js"
  if (-not (Test-Path -LiteralPath $entry)) {
    Write-Host "缺省安装=目录直装，但本目录没有构建产物：$entry" -ForegroundColor Red
    Write-Host "两条路任选：" -ForegroundColor Yellow
    Write-Host "  ① 先构建再重跑本脚本：npm install; npm run build（或 pwsh -File scripts\build-local.ps1）"
    Write-Host "  ② 直接用 Release 附件（tgz 里自带 lib/）：pwsh -File scripts\install.ps1 -Spec \`"<tgz 完整路径>\`""
    exit 1
  }
  $Spec = "link:$root"
}

# 本地 .tgz 路径先自检：文件不在，dsh 一定会失败，不如现在就说清楚
$hasScheme = ($Spec -match "^[a-zA-Z][a-zA-Z0-9+.-]*:") -and ($Spec -notmatch "^[a-zA-Z]:[\\/]")
if (($Spec -match "\.tgz$") -and (-not $hasScheme) -and (-not (Test-Path -LiteralPath $Spec))) {
  Write-Host "找不到这个 tgz 文件：$Spec" -ForegroundColor Red
  Write-Host "请给**完整路径**（相对路径按当前目录算）。" -ForegroundColor Yellow
  exit 1
}

Write-Host "== 扫榜插件安装 ==" -ForegroundColor Cyan
Write-Host "profile: $Profile"
Write-Host "spec   : $Spec"

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
  Write-Host "找不到 dsh 命令。请先安装 DeepSeek Harness（桌面版）并确保 dsh 在 PATH 里。" -ForegroundColor Red
  exit 1
}
Write-Host ""
Write-Host "⚠ 请先**完全退出**桌面版 DSH（否则 dsh plugin 会拒绝执行）。" -ForegroundColor Yellow
Write-Host "  已退出就继续……"
& dsh plugin --profile $Profile add $Spec
if ($LASTEXITCODE -ne 0) { Write-Host "安装失败（exit $LASTEXITCODE）" -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ""
Write-Host "== 安装完成，怎么确认 ==" -ForegroundColor Green
Write-Host "本次装到 profile 「$Profile」；若你跑的是另一个 profile，插件**不会加载**（表现为侧栏没有入口，不报错）。" -ForegroundColor Yellow
Write-Host "1) 重新打开桌面版 DSH；"
Write-Host "2) 看左侧栏「扫榜」入口（会话列表下面）；"
Write-Host "3) 或直接访问 http://127.0.0.1:19387/api/rank-scan/health 应返回 {\"ok\":true,...}。"
Write-Host ""
Write-Host "数据目录（卸载也不会删）：%USERPROFILE%\.dsh\data\rank-scan"
