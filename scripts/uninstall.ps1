<#
  扫榜插件卸载脚本 —— Windows / PowerShell
  做四件事：dsh plugin remove → 清 profile patch 里的 disabled 条目 → 删 junction → 打印数据目录（**不删数据**）。
  用法：pwsh -File scripts\uninstall.ps1 [-Profile desktop]
#>
param([string]$Profile = "desktop")
$ErrorActionPreference = "Continue"
$pkg = "@dsh-external/dsh-rank-scan"
$home_ = $env:USERPROFILE
$profileDir = Join-Path $home_ ".dsh\profiles\$Profile"
$dataDir = Join-Path $home_ ".dsh\data\rank-scan"

Write-Host "== 扫榜插件卸载 ==" -ForegroundColor Cyan
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) {
  Write-Host "⚠ 请先完全退出桌面版 DSH。"
  & dsh plugin --profile $Profile remove $pkg
  Write-Host "dsh plugin remove 退出码：$LASTEXITCODE"
} else {
  Write-Host "找不到 dsh 命令，跳过 remove（稍后手动执行：dsh plugin --profile $Profile remove $pkg）" -ForegroundColor Yellow
}

# 清 patch 里为「已卸载插件」留的 disabled 条目（有备份）
$patch = Join-Path $profileDir "cordis.patch.yml"
if (Test-Path $patch) {
  $txt = Get-Content -Raw -Encoding UTF8 $patch
  $new = [regex]::Replace($txt, "(?m)^#+\s*已卸载插件（$([regex]::Escape($pkg))）[^\n]*\n", "")
  $new = [regex]::Replace($new, "(?m)^\s*-\s*id:\s*dsh-rank-scan\s*\n(?:\s+disabled:\s*true\s*\n)?", "")
  if ($new -ne $txt) {
    Copy-Item $patch "$patch.bak-rank-scan-uninstall" -Force
    Set-Content -Path $patch -Value $new -Encoding UTF8 -NoNewline
    Write-Host "已清 patch 残留条目（备份：$patch.bak-rank-scan-uninstall）"
  } else { Write-Host "patch 里没有本插件的残留条目" }
}

# 删 junction
$link = Join-Path $profileDir "node_modules\@dsh-external\dsh-rank-scan"
if (Test-Path $link) {
  try { (Get-Item $link).Delete(); Write-Host "已删 junction：$link" }
  catch { Remove-Item -Recurse -Force $link -ErrorAction SilentlyContinue; Write-Host "已删目录：$link" }
} else { Write-Host "没有 junction 残留" }

Write-Host ""
Write-Host "== 卸载完成 ==" -ForegroundColor Green
Write-Host "数据目录**保留**在这里（里面是配置、书签、书页缓存）：" -ForegroundColor Yellow
Write-Host "  $dataDir"
Write-Host "想彻底清理就自己删这个目录。"
