<#
  扫榜插件卸载脚本 —— Windows / PowerShell

  做这些事（顺序固定）：
    1) dsh plugin --profile <p> remove <包名> —— **失败即中止**：不删 junction、不改任何文件，打印手动命令；
    2) 按 package.json 的 name 算 junction 路径并删除（新名 + 旧 scope 名各试一次）；
    3) 打印 profile patch 的**只读**检查结果与数据目录（**不删数据**）。

  ★ 本脚本永不写入 profile 的 cordis.patch.yml（口径 Q24）：只做「读 + 存在性判断 + 打印说明」。
    宿主对非法/空 patch 是 fail-loud（下次启动直接 exit=1，且宿主自己也没有修复入口），
    所以任何自动改写都可能把一个能启动的 profile 改坏。残留的 disabled 条目是宿主自己写的，留着合法。
    真要清理残留条目：先用宿主界面操作，或先跑 scripts/repair-patch.ps1（带备份的救援通道）。

  用法：
    pwsh -File scripts\uninstall.ps1                # 缺省 profile = desktop
    pwsh -File scripts\uninstall.ps1 -Profile dev
#>
param([string]$Profile = "desktop")
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot

# 包名以 package.json 的 name 为准（不硬编码：改名/换 scope 时脚本跟着走）
$pkg = ""
try { $pkg = (Get-Content -Raw -Encoding UTF8 (Join-Path $root "package.json") | ConvertFrom-Json).name } catch { }
if (-not $pkg) { $pkg = "dsh-rank-scan" }
$base = ($pkg -split "/")[-1]
$legacyPkg = "@dsh-external/$base"

$home_ = $env:USERPROFILE
if (-not $home_) { $home_ = $env:HOME }
if (-not $home_) {
  Write-Host "找不到用户主目录（USERPROFILE 与 HOME 都为空），无法定位 profile。" -ForegroundColor Red
  exit 2
}
$profileDir = Join-Path $home_ ".dsh\profiles\$Profile"
$dataDir = Join-Path $home_ ".dsh\data\rank-scan"
$patch = Join-Path $profileDir "cordis.patch.yml"

Write-Host "== 扫榜插件卸载 ==" -ForegroundColor Cyan
Write-Host "profile     : $Profile"
Write-Host "包名        : $pkg"
Write-Host "profile 目录: $profileDir"

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
  Write-Host ""
  Write-Host "找不到 dsh 命令：无法执行 remove，因此**不会**删 junction、也不会动任何文件。" -ForegroundColor Red
  Write-Host "装好 DSH（桌面版）后重跑本脚本，或手动执行：" -ForegroundColor Yellow
  Write-Host "  dsh plugin --profile $Profile remove $pkg"
  Write-Host "  然后删这两个 junction（存在才删）："
  Write-Host "    $profileDir\node_modules\$pkg"
  Write-Host "    $profileDir\node_modules\$legacyPkg"
  exit 1
}

Write-Host ""
Write-Host "⚠ 请先**完全退出**桌面版 DSH（否则 dsh plugin 会拒绝执行）。" -ForegroundColor Yellow

# 原生命令统一模式：本进程降到 Continue + 2>&1 捕获 + $LASTEXITCODE 判断
$ErrorActionPreference = "Continue"
$removeOut = & dsh plugin --profile $Profile remove $pkg 2>&1 | Out-String
$removeCode = $LASTEXITCODE
if ($null -eq $removeCode) { $removeCode = 1 }
if ($removeOut.Trim()) { Write-Host $removeOut.Trim() }
Write-Host "dsh plugin remove 退出码：$removeCode"

if ($removeCode -ne 0) {
  Write-Host ""
  Write-Host "remove 失败（exit $removeCode）：**立即中止**。" -ForegroundColor Red
  Write-Host "按口径 Q31，此时不删 junction、不改任何文件（junction 还在，插件可恢复）。" -ForegroundColor Yellow
  Write-Host "排查后手动执行：" -ForegroundColor Yellow
  Write-Host "  dsh plugin --profile $Profile remove $pkg"
  Write-Host "确认成功后，再删这两个 junction（存在才删）："
  Write-Host "    $profileDir\node_modules\$pkg"
  Write-Host "    $profileDir\node_modules\$legacyPkg"
  exit $removeCode
}

# ① 删 junction：路径由包名计算，新名与旧 scope 名都试
Write-Host ""
Write-Host "== 清理 junction ==" -ForegroundColor Cyan
$targets = @(
  (Join-Path $profileDir "node_modules\$pkg"),
  (Join-Path $profileDir "node_modules\$legacyPkg")
) | Select-Object -Unique

foreach ($t in $targets) {
  $item = Get-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    Write-Host "没有残留：$t"
    continue
  }
  try {
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      $item.Delete()   # junction / symlink：只删链接本体，不碰目标目录
    } else {
      Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction Stop
    }
    Write-Host "已删 junction：$t" -ForegroundColor Green
  } catch {
    Write-Host "删不掉（可稍后手动删）：$t —— $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# ② profile patch：只读检查，绝不改写
Write-Host ""
Write-Host "== profile patch（只读检查，本脚本不会改动它）==" -ForegroundColor Cyan
Write-Host "文件：$patch"
if (Test-Path -LiteralPath $patch) {
  $text = ""
  try { $text = [System.IO.File]::ReadAllText($patch) } catch { $text = $null }
  if ($null -eq $text) {
    Write-Host "读不到内容（权限？），跳过检查 —— 文件未被改动。" -ForegroundColor Yellow
  } else {
    $refs = ([regex]::Matches($text, "(?m)^\s*-?\s*id:\s*" + [regex]::Escape($pkg) + "\s*$")).Count
    if ($refs -gt 0) {
      Write-Host "发现 $refs 处 id: $pkg 的记录。**本脚本按 Q24 不删除它们**：" -ForegroundColor Yellow
      Write-Host "  宿主在禁用插件时会写一条 tombstone（- id: <包名> / disabled: true），留着合法，"
      Write-Host "  下次启动不受影响。想清掉请用宿主界面启用/禁用一次，或先跑 scripts\repair-patch.ps1 再手工删。"
    } else {
      Write-Host "没有 id: $pkg 的记录 —— patch 无需处理（本来也没有残留）。"
    }
    Write-Host "（本脚本不承诺 patch 零残留：宁可有残留，也不冒把文件改坏的风险。）"
  }
} else {
  Write-Host "文件不存在 —— 无需处理。"
}

# ③ 数据目录：只打印，不删
Write-Host ""
Write-Host "== 卸载完成 ==" -ForegroundColor Green
Write-Host "数据目录**保留**在这里（里面是配置、书签、书页缓存）：" -ForegroundColor Yellow
Write-Host "  $dataDir"
Write-Host "想彻底清理就自己删这个目录。"
exit 0
