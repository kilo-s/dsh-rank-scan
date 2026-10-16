<#
  扫榜插件 patch 救援脚本 —— Windows / PowerShell
  用途：DSH 起不来、日志里说 profile 的 cordis.patch.yml 解析失败时，一条命令把 patch 修回**合法顶层数组**。

  做这些事：
    1) 判定 <home>\.dsh\profiles\<profile>\cordis.patch.yml 是否可解析（合法顶层数组）；
    2) 不可解析 ⇒ **先备份**（cordis.patch.yml.bak-rank-scan-repair-<时间戳>）⇒ 以 [] 保底回写
       （[] = 没有 overlay，宿主一定能启动；原有的 overlay 条目内容留在 .bak 里）；
    3) 可解析 ⇒ 一个字节都不动；
    4) 打印「做了什么 + 怎么验证 + 怎么还原」。

  用法：
    pwsh -File scripts\repair-patch.ps1                      # 检查并修复（缺省 profile = desktop）
    pwsh -File scripts\repair-patch.ps1 -DryRun              # 只检查，不写盘
    pwsh -File scripts\repair-patch.ps1 -Profile dev
    pwsh -File scripts\repair-patch.ps1 -Restore             # 用本脚本最近的备份还原

  安全边界：只碰这一个文件；备份失败就不写；写用「临时文件 + 覆盖」避免写一半。
#>
param(
  [string]$Profile = "desktop",
  [switch]$DryRun,
  [switch]$Restore
)
$ErrorActionPreference = "Continue"

# ---- patch 形态判定：合法 = 顶层是 YAML 数组（宿主 index.js:895 的硬要求）----
function Test-PatchShape([string]$text) {
  $result = & node (Join-Path $PSScriptRoot 'check-patch.mjs') $patch
  $code = $LASTEXITCODE
  if ($code -notin @(0,1)) { Write-Host '无法可靠解析 patch，停止且不写盘。' -ForegroundColor Red; exit 2 }
  return [pscustomobject]@{ Ok = ($code -eq 0); Reason = ($result -join ' '); Items = 0 }
}

$root = Split-Path -Parent $PSScriptRoot
$home_ = $env:USERPROFILE
if (-not $home_) { $home_ = $env:HOME }
if (-not $home_) { Write-Host "找不到用户主目录（USERPROFILE 与 HOME 都为空）。" -ForegroundColor Red; exit 2 }
$profileDir = Join-Path $home_ ".dsh\profiles\$Profile"
$patch = Join-Path $profileDir "cordis.patch.yml"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host "== 扫榜插件 patch 救援 ==" -ForegroundColor Cyan
Write-Host "profile     : $Profile"
Write-Host "profile 目录: $profileDir"
Write-Host "patch       : $patch"
if ($DryRun) { Write-Host "模式        : -DryRun（只检查，不写盘）" -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath $profileDir)) {
  Write-Host ""
  Write-Host "找不到 profile 目录 —— profile 名可能写错了（用 -Profile <名字> 指定）。" -ForegroundColor Red
  Write-Host "本次没有改动任何文件。" -ForegroundColor Yellow
  exit 1
}

# ---- 还原分支 ----
if ($Restore) {
  $baks = @(Get-ChildItem -LiteralPath $profileDir -Filter "cordis.patch.yml.bak-rank-scan-repair-*" -Force -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)
  if ($baks.Count -eq 0) {
    Write-Host "没找到本脚本产生的备份（cordis.patch.yml.bak-rank-scan-repair-*），无法还原。" -ForegroundColor Red
    exit 1
  }
  $src = $baks[0]
  Write-Host "用最近的备份还原：$($src.Name)（$($src.LastWriteTime)）"
  if ($DryRun) { Write-Host "-DryRun：未写盘。" -ForegroundColor Yellow; exit 0 }
  try {
    if (Test-Path -LiteralPath $patch) { Copy-Item -LiteralPath $patch -Destination ($patch + ".bak-rank-scan-repair-before-restore-" + $stamp) -Force -ErrorAction Stop }
    Copy-Item -LiteralPath $src.FullName -Destination $patch -Force -ErrorAction Stop
  } catch { Write-Host ("还原失败：" + $_.Exception.Message) -ForegroundColor Red; exit 1 }
  Write-Host "已还原：$patch" -ForegroundColor Green
  Write-Host ""
  Write-Host "验证：dsh --profile $Profile --dump-config     （退出码 0 = 宿主能解析这个 patch）"
  exit 0
}

if (-not (Test-Path -LiteralPath $patch)) {
  Write-Host ""
  Write-Host "这个文件不存在 —— 没有 overlay，宿主照常启动，不需要修。" -ForegroundColor Green
  exit 0
}

$text = $null
try { $text = [System.IO.File]::ReadAllText($patch) } catch {
  Write-Host ("读取失败：" + $_.Exception.Message + "（文件未被改动）") -ForegroundColor Red
  exit 1
}
$shape = Test-PatchShape $text
$verdict = if ($shape.Ok) { "可解析" } else { "不可解析" }
Write-Host ""
Write-Host "判定：$verdict —— $($shape.Reason)"

if ($shape.Ok) {
  Write-Host "文件已经是合法的顶层数组，**一个字节都不动**。" -ForegroundColor Green
  Write-Host ""
  Write-Host "验证：dsh --profile $Profile --dump-config     （退出码 0 = 宿主能解析）"
  exit 0
}

$bak = $patch + ".bak-rank-scan-repair-" + $stamp
Write-Host ""
Write-Host "修复方案：先备份 → 再把 patch 回写成顶层空数组 []" -ForegroundColor Yellow
Write-Host "  备份：$bak"
Write-Host "  回写：[]（空 overlay；原有条目全部留在 .bak 里，需要时用 -Restore 还原或用编辑器挑回去）"
if ($DryRun) {
  Write-Host ""
  Write-Host "-DryRun：以上都**没有做**，文件未被改动。" -ForegroundColor Yellow
  exit 0
}

try {
  Copy-Item -LiteralPath $patch -Destination $bak -Force -ErrorAction Stop   # 备份失败就不写
  $tmp = $patch + ".repair-tmp"
  [System.IO.File]::WriteAllText($tmp, "[]" + [char]10, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $patch -Force -ErrorAction Stop    # 临时文件+覆盖，避免写一半
} catch {
  Write-Host ("修复失败：" + $_.Exception.Message) -ForegroundColor Red
  if (Test-Path -LiteralPath $bak) { Write-Host "（备份仍在：$bak）" -ForegroundColor Yellow }
  exit 1
}

$after = Test-PatchShape ([System.IO.File]::ReadAllText($patch))
$afterTxt = if ($after.Ok) { "OK —— $($after.Reason)" } else { "仍不合格：" + $after.Reason }
Write-Host ""
Write-Host "== 做了什么 ==" -ForegroundColor Green
Write-Host "1) 备份原文件 → $bak"
Write-Host "2) 把 $patch 回写成 []"
Write-Host "3) 回写后自检：$afterTxt"
Write-Host ""
Write-Host "== 怎么验证 ==" -ForegroundColor Cyan
Write-Host "1) dsh --profile $Profile --dump-config   —— 退出码 0 就说明宿主能解析这个 patch 了；"
Write-Host "2) 重新打开桌面版 DSH，看侧栏入口是否回来（路由自查：/api/rank-scan/health 返回 {ok:true}）；"
Write-Host "3) 想撤销本次修改：pwsh -File scripts\repair-patch.ps1 -Profile $Profile -Restore"
Write-Host ""
Write-Host "如果 DSH 仍然起不来：把 -DryRun 的完整输出与 $bak 的内容附在仓库的 Issue 里（备份不会自动删）。" -ForegroundColor Yellow
exit 0
