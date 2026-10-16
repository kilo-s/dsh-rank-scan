<#
  扫榜插件 npm 名占位脚本 —— Windows / PowerShell
  **需要你在自己的终端里跑**（要 npm 登录态与联网，agent 不该代做）。

  目的（Q26）：在 npm 上占个名，防同名抢注；**不发布插件内容**（插件不通过 npm 分发）。
  做这些事：
    1) 查 npm → 查登录态（未登录就执行 npm login）；失败即停；
    2) 查 npm 上是否已存在 <名字>：已存在且版本就是 0.0.0 ⇒ 目标已达成（退出 0）；
       已存在但版本不同 ⇒ 打印详情并**非零退出**（要人工确认是不是我们发过的）；
    3) 在临时目录生成一个最小占位包（package.json + README.md，没有任何代码）并 npm publish；
    4) 打印验证方式与后续手动命令。

  用法：
    pwsh -File scripts\publish-npm-placeholder.ps1 -DryRun   # 只检查：登录态 + 名字是否被占（推荐先跑）
    pwsh -File scripts\publish-npm-placeholder.ps1           # 真的占位注册
    pwsh -File scripts\publish-npm-placeholder.ps1 -Name dsh-rank-scan -Version 0.0.0
#>
param(
  [string]$Name = "dsh-rank-scan",
  [string]$Version = "0.0.0",
  [switch]$DryRun
)
$ErrorActionPreference = "Continue"

function Info([string]$m) { Write-Host $m }
function Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red }

Write-Host "== npm 名占位（$Name@$Version）==" -ForegroundColor Cyan
if ($DryRun) { Warn "模式：-DryRun（只检查，不登录、不发布）" }

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
if (-not $npm) {
  Fail "找不到 npm。请先装 Node.js，并确认 npm 在 PATH 里（重开一个终端）。"
  exit 1
}
Info "npm: $npm"

function Invoke-Npm([string[]]$NpmArgs) {
  $out = & $npm @NpmArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
  return [pscustomobject]@{ Code = $code; Out = $out }
}

# ---- 1) 登录态 ----
$who = Invoke-Npm @('whoami')
if ($who.Code -ne 0) {
  Warn "当前未登录 npm（npm whoami 退出码 $($who.Code)）。"
  if ($DryRun) {
    Warn "-DryRun：跳过 npm login（真跑时会先执行 npm login）。"
  } else {
    Info "即将执行 npm login —— 按提示在浏览器/终端完成（有 2FA 就输入一次性验证码）。"
    & $npm login
    if ($LASTEXITCODE -ne 0) { Fail "npm login 失败（退出码 $LASTEXITCODE），停止。"; exit 1 }
    $who = Invoke-Npm @('whoami')
    if ($who.Code -ne 0) { Fail "npm login 之后 npm whoami 仍失败，停止。"; exit 1 }
  }
}
if ($who.Code -eq 0) { Ok ("已登录：" + $who.Out.Trim()) }

# ---- 2) 名字是否已被占用 ----
$view = Invoke-Npm @('view', $Name, 'version')
if ($view.Code -eq 0) {
  $existing = $view.Out.Trim()
  Warn "npm 上已经存在 $Name（version=$existing）—— 不需要再发。"
  if ($existing -eq $Version) {
    Ok "占位已就位：$Name@$Version（目标达成）"
    Info "验证：npm view $Name version      应输出 $Version"
    Info "页面：https://www.npmjs.com/package/$Name"
    exit 0
  }
  Fail "已存在的是 $existing，不是本次要发的 $Version —— 可能是别人占用，也可能是历史版本。"
  Info "先人工确认：npm view $Name maintainers --json"
  Info "确认不是我们发的 ⇒ 说明抢注面已经关闭（名字被别人拿去）；需要换名再占位。"
  exit 1
}
if ($view.Out -match 'EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|registry') {
  Fail "查询 npm 失败（可能是网络/代理问题），先修网络再重跑："
  Info $view.Out.Trim()
  exit 1
}
Ok "npm 上还没有 $Name —— 可以占位。"

# ---- 3) 生成最小占位包（临时目录，不含任何代码）----
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-rank-scan-placeholder-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$manifest = [ordered]@{
  name        = $Name
  version     = $Version
  description = "DSH 扫榜插件的 npm 名占位包：只占名，不含任何代码（插件未发布到 npm）。"
  license     = "BSD-3-Clause"
  repository  = @{ type = "git"; url = "git+https://github.com/kilo-s/dsh-rank-scan.git" }
  keywords    = @("dsh", "dsh-plugin", "placeholder")
}
[System.IO.File]::WriteAllText((Join-Path $tmp "package.json"), ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
$readme = "# $Name (name placeholder)" + [char]10 + [char]10 +
  "This is a NAME PLACEHOLDER only. No code is published here." + [char]10 + [char]10 +
  "The plugin lives in the GitHub repository: https://github.com/kilo-s/dsh-rank-scan" + [char]10
[System.IO.File]::WriteAllText((Join-Path $tmp "README.md"), $readme, (New-Object System.Text.UTF8Encoding($false)))
Info "临时占位包：$tmp"

if ($DryRun) {
  Warn "-DryRun：不发布。真跑时会执行："
  Info "  cd $tmp; npm publish"
  Info "然后验证：npm view $Name version  →  $Version"
  exit 0
}

# ---- 4) 发布（交互式命令，输出直接给终端，不捕获）----
Push-Location $tmp
& $npm publish
$pubCode = $LASTEXITCODE
Pop-Location
if ($pubCode -ne 0) {
  Fail "npm publish 失败（退出码 $pubCode）。"
  Info "若是 EOTP / one-time password：手动执行 cd $tmp; npm publish --otp=<6位验证码>"
  Info "若是 403 权限/名字被占：先 npm view $Name maintainers --json 确认归属，别换名硬试。"
  Info "临时目录已保留，可直接重试：$tmp"
  exit $pubCode
}

# ---- 5) 验证 ----
$v = Invoke-Npm @('view', $Name, 'version')
$vTxt = if ($v.Code -eq 0) { $v.Out.Trim() } else { "(查询失败，退出码 $($v.Code))" }
Write-Host ""
if ($v.Code -eq 0 -and $vTxt -eq $Version) {
  Ok "完成：$Name@$Version 已占位。"
} else {
  Fail "发布后验证不通过：npm view $Name version → $vTxt"
  Info "可能刚发布有缓存延迟，稍后手动重查：npm view $Name version"
  exit 1
}
Write-Host ""
Write-Host "== 怎么验证（随时可跑）==" -ForegroundColor Cyan
Info "npm view $Name version          # 应输出 $Version"
Info "npm view $Name maintainers --json"
Info "https://www.npmjs.com/package/$Name"
Write-Host ""
Info "说明：这个包只占名，不含代码；插件内容不发布到 npm（用 Release 附件 / 仓库链接安装）。"
Info "临时目录可以删了：$tmp"
exit 0
