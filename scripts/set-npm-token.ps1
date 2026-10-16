# 把 npm granular token 写进项目级 .npmrc（token 不回显、不进历史、不进仓库）
# 用法： pwsh -File scripts\set-npm-token.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root ".npmrc"
Write-Host "去 npm 网站生成 granular token（勾 Bypass 2FA + Read and write），复制那串 npm_ 开头的字符。"
$token = Read-Host "把 token 粘到这里再回车"
if ([string]::IsNullOrWhiteSpace($token)) { Write-Host "没有输入，什么也没做。" -ForegroundColor Yellow; exit 1 }
if (-not $token.StartsWith("npm_")) { Write-Host "这看起来不像 npm token（一般以 npm_ 开头），先确认再重跑。" -ForegroundColor Yellow; exit 1 }
$lines = @("# 仅供发布使用，已在 .gitignore 中排除，绝不提交","registry=https://registry.npmjs.org/","//registry.npmjs.org/:_authToken=" + $token)
[IO.File]::WriteAllText($file, ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host ("已写入：" + $file) -ForegroundColor Green
$who = (& npm.cmd whoami --registry https://registry.npmjs.org/ --cache (Join-Path $env:TEMP "npm-cache-rank-scan") 2>&1 | Out-String).Trim()
Write-Host ("npm whoami -> " + $who)
if ($who -notmatch "^[A-Za-z0-9_-]+$") { Write-Host "whoami 没返回用户名：token 可能无效或权限不对。" -ForegroundColor Yellow } else { Write-Host "token 可用。" -ForegroundColor Green }
exit 0
