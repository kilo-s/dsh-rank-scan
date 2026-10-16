<#
  扫榜插件（dsh-rank-scan）安装脚本 —— Windows / PowerShell
  用法：
    pwsh -File scripts\install.ps1 -Spec "E:\path\to\dsh-rank-scan-0.0.1.tgz"
    pwsh -File scripts\install.ps1 -Spec "link:E:\path\to\dsh-rank-scan"      # 目录直装（开发用）
  默认 -Profile desktop；装完去 DSH 侧栏找「扫榜」入口。
#>
param(
  [string]$Profile = "desktop",
  [string]$Spec = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Spec) { $Spec = "link:$root" }

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
Write-Host "1) 重新打开桌面版 DSH；"
Write-Host "2) 看左侧栏「扫榜」入口（会话列表下面）；"
Write-Host "3) 或直接访问 http://127.0.0.1:19387/api/rank-scan/health 应返回 {\"ok\":true,...}。"
Write-Host ""
Write-Host "数据目录（卸载也不会删）：%USERPROFILE%\.dsh\data\rank-scan"
