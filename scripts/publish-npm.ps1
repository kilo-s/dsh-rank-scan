# 发布到 npm（属主在自己终端执行；需要你的 npm 登录态与 OTP）
#   pwsh -File scripts\publish-npm.ps1 -DryRun        # 只检查 + 打包预览，不发布
#   pwsh -File scripts\publish-npm.ps1               # 真发布
#   pwsh -File scripts\publish-npm.ps1 -Otp 123456   # 有 2FA 时一步到位
param([switch]$DryRun, [string]$Otp = "", [string]$Tag = "latest")
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$cache = Join-Path $env:TEMP "npm-cache-rank-scan"
function Step($t) { Write-Host ("== " + $t) -ForegroundColor Cyan }
function Guard($cond, $msg) { if (-not $cond) { Write-Host ("中止：" + $msg) -ForegroundColor Red; exit 1 } }
Step "检查工作区与版本"
$dirty = (git status --porcelain | Out-String).Trim()
Guard ($dirty -eq "") ("工作区不干净，先提交再发布：" + $dirty)
$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version; $name = $pkg.name
Write-Host ("  包名/版本：" + $name + "@" + $version)
Step "本地闸门（不过不发布）"
& node (Join-Path $root "scripts/build.mjs"); Guard ($LASTEXITCODE -eq 0) "构建失败"
& pwsh -NoProfile -File (Join-Path $root "scripts/test-local.ps1") *> (Join-Path $env:TEMP "rank-scan-test.log")
Guard ($LASTEXITCODE -eq 0) "离线测试失败（日志见 TEMP 下 rank-scan-test.log）"
& pwsh -NoProfile -File (Join-Path $root "scripts/acceptance.ps1") -SkipLive *> (Join-Path $env:TEMP "rank-scan-accept.log")
Guard ($LASTEXITCODE -eq 0) "验收闸门失败（日志见 TEMP 下 rank-scan-accept.log）"
Step "登录态"
& npm.cmd whoami --cache $cache 2>&1 | Out-String | Write-Host
Guard ($LASTEXITCODE -eq 0) "npm 未登录：先在自己终端跑 npm login（本脚本不代你输密码）"
Step "打包预览（列出真正上传的文件）"
& npm.cmd pack --dry-run --cache $cache 2>&1 | Select-Object -Last 12 | Write-Host
if ($DryRun) { Step "-DryRun：到此为止，没有发布。"; exit 0 }
Step "发布"
$npmArgs = @("publish", "--access", "public", "--tag", $Tag, "--cache", $cache)
if ($Otp -ne "") { $npmArgs += "--otp"; $npmArgs += $Otp }
& npm.cmd @npmArgs
Guard ($LASTEXITCODE -eq 0) "npm publish 失败（401/403 = 权限或 2FA；EOTP = 用 -Otp 重试）"
Step "验证"
$shown = (& npm.cmd view $name version --cache $cache 2>&1 | Out-String).Trim()
Write-Host ("  npm 上的版本：" + $shown)
if ($shown -eq $version) { Write-Host "  已一致" -ForegroundColor Green } else { Write-Host "  与本地版本不一致，请核对" -ForegroundColor Yellow }
Write-Host "发布后还要做两件事：" -ForegroundColor Yellow
Write-Host ("  1) 推仓库并打 tag v" + $version + "（Release 附件由 .github/workflows/build.yml 产出）")
Write-Host "  2) 打开面板「抓什么」页 → 版本区 → 应能看到新版本并可一键更新"
Write-Host ("撤销：npm 只允许 72 小时内 unpublish；更稳的做法是发一个更高的修订版。")
exit 0
