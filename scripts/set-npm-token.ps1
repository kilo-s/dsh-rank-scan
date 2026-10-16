# 把 npm granular token 写进项目级 .npmrc（token 不回显、不进历史、不进仓库）
# 用法： pwsh -File scripts\set-npm-token.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root ".npmrc"
Write-Host "去 npm 网站生成 granular token（勾 Bypass 2FA + Read and write），复制那串 npm_ 开头的字符。"
$token = Read-Host "把 token 粘到这里再回车"
if ([string]::IsNullOrWhiteSpace($token)) { Write-Host "没有输入，什么也没做。" -ForegroundColor Yellow; exit 1 }
if (-not $token.StartsWith("npm_")) { Write-Host "这看起来不像 npm token（一般以 npm_ 开头），先确认再重跑。" -ForegroundColor Yellow; exit 1 }
# ★ 2026-10-17（发布前修）：**不要**写成 @("a","b","c" + $token) —— PowerShell 里逗号优先级高于 +，
#   那样会把 token 当成**第 4 个数组元素**追加，落盘的 .npmrc 变成「//registry.npmjs.org/:_authToken=（空值）」
#   + 一行裸 token；npm 读到的是空 token ⇒ whoami/publish 一律 ENEEDAUTH，症状极像「token 无效或没复制全」。
#   正确写法：先把整行拼出来，再当数组元素用。
$authLine = "//registry.npmjs.org/:_authToken=" + $token
$lines = @("# 仅供发布使用，已在 .gitignore 中排除，绝不提交","registry=https://registry.npmjs.org/",$authLine)
[IO.File]::WriteAllText($file, ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
# 写后自检：必须是 3 行，且 authToken 行的值与输入字字一致（防上面那类形状错误再溜过去）
$back = Get-Content $file
$authBack = ($back | Where-Object { $_ -match '_authToken' } | Select-Object -First 1)
$got = if ($authBack) { ($authBack -split '=', 2)[1] } else { '' }
if ($back.Count -ne 3 -or $got -ne $token) {
  Write-Host ("写出的 .npmrc 形状不对（行数 " + $back.Count + "，authToken 长度 " + $got.Length + "）：别继续，先检查脚本里的数组拼接。") -ForegroundColor Red
  exit 2
}
Write-Host ("已写入并校验：" + $file) -ForegroundColor Green
$who = (& npm.cmd whoami --registry https://registry.npmjs.org/ --cache (Join-Path $env:TEMP "npm-cache-rank-scan") 2>&1 | Out-String).Trim()
Write-Host ("npm whoami -> " + $who)
if ($who -notmatch "^[A-Za-z0-9_-]+$") { Write-Host "whoami 没返回用户名：token 可能无效或权限不对。" -ForegroundColor Yellow } else { Write-Host "token 可用。" -ForegroundColor Green }
exit 0
