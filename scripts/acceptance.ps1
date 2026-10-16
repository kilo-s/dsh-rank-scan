<#
  验收探针集（票 33）—— 一条命令跑完「不连累本体 / 轻量 / 即插即用 / 坏了也没事」的可执行探针。
  用法：pwsh -File scripts\acceptance.ps1            # 需要插件已注入（host OK）
        pwsh -File scripts\acceptance.ps1 -SkipLive  # 只跑离线（结构 + 单测）探针
  退出码 0 = 全 PASS；非 0 = 有 FAIL。
#>
param([switch]$SkipLive)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Check($name, $ok, $evidence) {
  if ($ok) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
  Write-Host ("      " + $evidence) -ForegroundColor DarkGray
}
$src        = Join-Path $root "src\index.ts"
$client     = Join-Path $root "lib\client.js"
$bookmark   = Join-Path $root "src\scan\bookmark.ts"
$host_src   = Get-Content -Raw -Encoding UTF8 $src
$client_src = Get-Content -Raw -Encoding UTF8 $client
$bm_src     = Get-Content -Raw -Encoding UTF8 $bookmark
# 周期榜换期三件套（2026-10-16 rank-scan-next-session）：三江空期回退 + 跨期不可比保护
$diff_src   = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src\scan\diff.ts")
$qd_src     = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src\sites\qidiantu.ts")

Write-Host "== 不连累本体 ==" -ForegroundColor Cyan
Check "P0-1 定时回调有兜底（未捕获拒绝会让宿主 exit(1)）" ($host_src -match "checkTimer\(\)\.catch") "setInterval 回调挂了 .catch"
Check "P0-1 recordRun 自身不抛" ($host_src -match "写定时状态失败（已吞）") "写盘失败只记 timer.log"
Check "P0-2 日期入口有校验" ($host_src -match "assertDataDate\(body\.date\)") ("调用点数=" + ([regex]::Matches($host_src, "assertDataDate\(body\.date\)").Count))
Check "票 30 扫描锁真的置位" ($host_src -match "async function withScanLock") "手动 /scan 与 /retry 都走 withScanLock"
Check "票 30 readBody 有超时" ($host_src -match "6,10_000|10_000\)") "半开连接不再悬挂"
Check "票 29 站点请求有超时" (Test-Path (Join-Path $root "src\scan\bounded-fetch.ts")) "bounded-fetch.ts 存在（五站已接线）"

Write-Host "== 轻量 ==" -ForegroundColor Cyan
Check "票 25 定时惰性接线" ($host_src -match "function syncTimer") "syncTimer 由 timerEnabled 驱动"
Check "票 26 占用统计走缓存" ($host_src -match "function storageSummary") "storageSummary + TTL 缓存"
Check "票 27 面板收起/隐藏不轮询" (($client_src -match "document\.visibilityState") -and ($client_src -match "if \(!open\) return undefined")) "可见性判断 + 收起提前返回"

Write-Host "== 坏了也没事 ==" -ForegroundColor Cyan
Check "票 28 书签写盘原子（无先删后改名）" (-not ($bm_src -match "rmSync\(this\.file")) "bookmark.ts 不再 rmSync 主文件"
Check "票 28 主文件缺失能从备份恢复" ($bm_src -match "主文件缺失，已从备份恢复") "read() 缺失也走备份轮转"

Write-Host "== 离线测试 ==" -ForegroundColor Cyan
Push-Location $root
foreach ($t in @("tests\host-guard.test.mjs","tests\client-bundle.test.mjs","tests\bookmark.test.mjs")) {
  node (Join-Path $root $t) | Out-Null
  Check ("离线测试 " + $t) ($LASTEXITCODE -eq 0) $t
}
Pop-Location

if (-not $SkipLive) {
  Write-Host "== 在线探针（需要插件已注入）==" -ForegroundColor Cyan
  $base = "http://127.0.0.1:19387/api/rank-scan"
  try { $h = Invoke-WebRequest -UseBasicParsing ($base + "/health") -TimeoutSec 8; Check "健康检查（本地无 Origin 放行）" ($h.StatusCode -eq 200) ("HTTP " + $h.StatusCode) }
  catch { Check "健康检查" $false $_.Exception.Message }
  try {
    Invoke-WebRequest -UseBasicParsing ($base + "/overview") -Headers @{ Origin = "http://evil.example" } -TimeoutSec 8 | Out-Null
    Check "跨源请求被拒（票 23）" $false "意外通过"
  } catch { $code = $_.Exception.Response.StatusCode.value__; Check "跨源请求被拒（票 23）" ($code -eq 403) ("HTTP " + $code + "（期望 403）") }
  try {
    Invoke-WebRequest -UseBasicParsing ($base + "/repair") -Method POST -ContentType "application/json" -Body '{"mode":"drop","date":".."}' -TimeoutSec 8 | Out-Null
    Check "越界日期被拒（P0-2）" $false "意外通过"
  } catch { $code = $_.Exception.Response.StatusCode.value__; Check "越界日期被拒（P0-2）" ($code -eq 400) ("HTTP " + $code + "（期望 400）") }
  try {
    $ov = (Invoke-WebRequest -UseBasicParsing ($base + "/overview") -TimeoutSec 10).Content | ConvertFrom-Json
    Check "诊断字段在（票 26）" ($null -ne $ov.services) ("services=" + ($ov.services | ConvertTo-Json -Compress))
    Check "定时接线与开关一致（票 25）" ($ov.services.timerArmed -eq $ov.defaults.timerEnabled) ("timerEnabled=" + $ov.defaults.timerEnabled + " timerArmed=" + $ov.services.timerArmed)
  } catch { Check "在线诊断探针" $false $_.Exception.Message }
}


Write-Host "== 轻量/轻依赖/易安装 闸门 ==" -ForegroundColor Cyan
$srcFiles = Get-ChildItem -Path (Join-Path $root 'src') -Recurse -Filter *.ts | Where-Object { $_.FullName -notmatch 'src\\client' }
$badImports = @()
foreach ($f in $srcFiles) {
  Select-String -Path $f.FullName -Pattern "from '(?!node:|\./|\.\./)" -AllMatches | ForEach-Object { $badImports += ($_.Filename + ':' + $_.LineNumber) }
}
Check "依赖闸：host 侧零第三方 import（只允许 node: 与相对路径）" ($badImports.Count -eq 0) ("可疑 import: " + ($badImports -join ', '))
# ★ 公开面闸（2026-10-16）：本仓库是**给别人看的**，以下四类一律不许出现：
#   ① 编译产物 lib/（会把源码注释复制一份，sourcemap 还带构建机的绝对路径）
#   ② 个人绝对路径（形如 C:\Users\<某人的名字>）
#   ③ 私下对话的人称与所属称呼（本仓早期版本满篇都是「某人说了什么」，外人看不懂）
#   ④ 公开面引用的仓库内图片 / 文档必须存在（死链 = 读者点开 404）
#   ★ 禁词本字刻意用 [char] 拼出来，这样闸门不会命中自己 —— 因此**任何文件都不需要开例外**。
$bannedWords = @(
  ([char]0x7EF4 + [char]0x62A4 + [char]0x8005),
  ([char]0x672C + [char]0x673A),
  ([char]0x5C5E + [char]0x4E3B),
  ([char]0x8FD9 + [char]0x53F0 + [char]0x673A + [char]0x5668)
)
$trackedFiles = @(& git -C $root ls-files 2>$null)
$libInIndex = ($trackedFiles | Where-Object { $_ -like 'lib/*' } | Measure-Object).Count
Check "公开面闸：编译产物 lib/ 不在仓库索引里" ($libInIndex -eq 0) ("索引内 lib 文件数=" + $libInIndex + "（仓库只放源码，包由 CI 构建）")
$textFiles = $trackedFiles | Where-Object { $_ -match '\.(ts|mjs|js|md|json|yml|ps1|sh|gitignore|gitattributes)$' }
$pathHits = @()
$userPathNeedle = 'C:' + [char]92 + [char]92 + 'Users' + [char]92
#    ★ 探针自检：先用合成样本证明这个匹配真的能命中（历史坑：模式以反斜杠结尾 ⇒ 正则非法 ⇒ 每次都在
#      抛异常，而探针却显示 PASS，等于白设）。
$probeWorks = ('C:' + [char]92 + [char]92 + 'Users' + [char]92 + 'someone').Contains($userPathNeedle)
foreach ($f in $textFiles) {
  $c = Get-Content -Raw -Encoding UTF8 (Join-Path $root $f) -ErrorAction SilentlyContinue
  if ($c -and $c.Contains($userPathNeedle)) { $pathHits += $f }
}
Check "公开面闸：仓库里没有个人绝对路径" (($pathHits.Count -eq 0) -and $probeWorks) ("命中：" + ($pathHits -join ', ') + "；探针自检=" + $probeWorks)
$ownerHits = @()
foreach ($f in $textFiles) {
  $c = Get-Content -Raw -Encoding UTF8 (Join-Path $root $f) -ErrorAction SilentlyContinue
  if (-not $c) { continue }
  foreach ($w in $bannedWords) { if ($c.Contains($w)) { $ownerHits += ($f + '(' + $w + ')') } }
}
Check "公开面闸：没有内部人称与所有权称呼" ($ownerHits.Count -eq 0) ("命中：" + ($ownerHits -join ', '))
$deadLinks = @()
foreach ($f in ($trackedFiles | Where-Object { $_ -match '\.md$' })) {
  $c = Get-Content -Raw -Encoding UTF8 (Join-Path $root $f) -ErrorAction SilentlyContinue
  if (-not $c) { continue }
  foreach ($m in [regex]::Matches($c, '(?<![\w/.:-])(?:docs/)?[A-Za-z0-9._-]+\.(?:png|md)')) {
    $rel = $m.Value
    if (Test-Path (Join-Path $root $rel)) { continue }
    if (Test-Path (Join-Path (Split-Path -Parent (Join-Path $root $f)) $rel)) { continue }
    $deadLinks += ($f + ' -> ' + $rel)
  }
}
Check "公开面闸：公开面引用的仓库内图片/文档都存在（无死链）" ($deadLinks.Count -eq 0) ("死链：" + ($deadLinks -join '; '))
#   ⑤ 提交信息也是公开面：GitHub 的文件列表 / 提交列表会把每条信息直接显示给读者。
$logText = (& git -C $root log --format='%B' HEAD 2>$null | Out-String)
$logHits = @()
foreach ($w in $bannedWords) { if ($logText.Contains($w)) { $logHits += $w } }
Check "公开面闸：提交信息里没有内部称呼（Git 元数据同样是公开面）" ($logHits.Count -eq 0) ("命中：" + (($logHits | Select-Object -Unique) -join ', '))
$pkgJson = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'package.json') | ConvertFrom-Json
$hasPeer = $null -ne $pkgJson.peerDependencies
$hasDeps = ($null -ne $pkgJson.dependencies) -and (($pkgJson.dependencies.PSObject.Properties | Measure-Object).Count -gt 0)
Check "依赖闸：package.json 无 peerDependencies、无运行时 dependencies" ((-not $hasPeer) -and (-not $hasDeps)) ("peer=" + $hasPeer + " deps=" + $hasDeps)
Check "装配闸：cordis.patch.yml 存在且是 dsh.bundle.patch 指向的文件" ((Test-Path (Join-Path $root 'cordis.patch.yml')) -and ($pkgJson.dsh.bundle.patch -eq './cordis.patch.yml')) "最小 insert 补丁"
#   ★ git 直装（dsh plugin add github:…）靠 package.json 的 prepare 在用户机器上构建；
#     没有它，装出来的包只有源码、没有 lib/，插件加载会 did not activate。
Check "分发闸：package.json 有 prepare（仓库链接直装才会现场构建出 lib/）" ($null -ne $pkgJson.scripts.prepare) ("prepare=" + $pkgJson.scripts.prepare)
Check "装配闸：dsh.client.platform=web 且 exports 有 ./client" (($pkgJson.dsh.client.platform -eq 'web') -and ($null -ne $pkgJson.exports.'./client')) "面板注入路径"
Check "装配闸：inject 声明的服务都在宿主已知集合（timer/webServer）" ((($pkgJson.dsh.client.inject | Measure-Object).Count -eq 0) -or (& { $ok=$true; foreach ($s in $pkgJson.dsh.client.inject) { if (@('timer','webServer','tools') -notcontains $s) { $ok=$false } }; $ok })) ("client.inject=" + ($pkgJson.dsh.client.inject -join ','))
Check "轻量闸：面板产物不会再被构建覆盖（无 src/client、无 tsdown 配置）" ((-not (Test-Path (Join-Path $root 'src\client'))) -and (-not (Test-Path (Join-Path $root 'tsdown.config.ts')))) "手写 client/client.js + 构建复制"
#   ★ 面板源必须在仓库里：此前它只存在于开发机的 lib/client.js 里（lib/ 不入库），
#     于是 CI 从源码构建出的 tgz 没有面板，build.yml 的产物校验必然失败。
$clientSrcPath = Join-Path $root 'client\client.js'
$clientOutPath = Join-Path $root 'lib\client.js'
$clientSame = if (Test-Path $clientOutPath) { (Get-FileHash $clientSrcPath).Hash -eq (Get-FileHash $clientOutPath).Hash } else { $true }
Check "装配闸：面板源入库（client/client.js），且 lib/client.js 与它内容一致" ((Test-Path $clientSrcPath) -and $clientSame) ("源在=" + (Test-Path $clientSrcPath) + " 产物存在=" + (Test-Path $clientOutPath) + " 内容一致=" + $clientSame)
$tgz = Get-ChildItem -Path $root -Filter '*.tgz' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($tgz) { Check "分发闸：tgz 体积 <= 400 KB" ($tgz.Length -le 409600) ($tgz.Name + ' = ' + [math]::Round($tgz.Length / 1024) + ' KB') } else { Check "分发闸：tgz 存在" $false "还没 npm pack（可接受，但分发前要产出）" }
Check "迁移闸：state 迁移不动用户开关（v6 迁移里没有 timerEnabled 赋值）" (-not ($host_src -match 'st1\.timerEnabled')) "老配置保持原样"
Check "通道闸：startInterval 回调里的拒绝有兜底（checkTimer 包装）" ($host_src -match 'checkTimer\(\)\.catch\(') "定时回调挂 catch"

Write-Host "== 周期榜换期（2026-10-16）==" -ForegroundColor Cyan
# ① 三江空期回退：当期 0 行要回退上一期（最多 2 期）+ 记警告，而不是直接判 missing
Check "换期-1 三江空期回退上一期（结构断言）" (($qd_src -match 'back <= 2') -and ($qd_src -match '已回退到上一期')) "qidiantu.ts 的 back 循环 + 回退警告"
Check "换期-1 三江三期全空才判 missing" ($qd_src -match '本期与上两期均无数据') "0 行不再直接 missing（旧行为：当期无数据）"
# ② 跨期不可比保护：纯函数 guardCrossPeriod + 周期榜清单 + computeBoardDiff 接线
Check "换期-2 跨期保护纯函数在（期键同值=同期）" (($diff_src -match 'export function guardCrossPeriod') -and ($diff_src -match 'prevPeriod !== curPeriod')) "diff.ts#guardCrossPeriod"
Check "换期-2 保护只作用于周期榜（三江 + 刺猬猫首订约）" (($diff_src -match "qidiantu\.sanjiang") -and ($diff_src -match "ciweimao\.buy\.latest")) "非周期榜行为不变"
Check "换期-2 computeBoardDiff 已接线并回传 crossPeriod" (($diff_src -match 'guardCrossPeriod\(\{ boardId') -and ($diff_src -match 'base\.crossPeriod = true')) "变化列在换期当天置空"
Check "换期-2 周日算法（三江期首日口径）" ($diff_src -match 'export function sundayOf') "sundayOf：本周日 = 期首日"
# ③ 定时开关的最终口径（2026-10-16 使用者）：**默认开、用户可关、重载保留**
#    历史真凶：旧 v2 迁移（timerSchemaV !== 2 ⇒ timerEnabled=false）与 v6（写 6）冲突 ⇒「6 !== 2」恒真
#    ⇒ 每次启动都把用户的开关关掉。最终形态 = **删掉该迁移**，除面板 /timer 接口外任何代码都不写 timerEnabled。
#    ★ 判据刻意**不剥注释**（实测：剥块注释的正则会被源码里不配对的 /* 或字符串吃掉几千字符，
#      让断言无故失败）——改成锚定「可执行上下文」的正则，注释里出现同样的词也不会误判。
Check "开关-1 迁移不再翻用户的定时开关" (-not ($host_src -match 'st[0-9]\.timerEnabled\s*=')) "bindTimer 里不许有任何写 timerEnabled 的语句" "唯一允许的写法是 stT.timerEnabled（面板 /timer 接口）"
Check "开关-1b 只有面板 /timer 接口按用户显式布尔写盘" ($host_src -match 'stT\.timerEnabled = body\.enabled') "用户关掉后落盘 false，重载读回 false"
Check "开关-2 默认 = 开（defaultState 里就是 true）" ($host_src -match '(?m)^\s*timerEnabled: true,') "默认值本身"
Check "开关-3 抓取集落盘保留（readState 合并 + /select 写盘）" (($host_src -match 'readState = \(\) =>') -and ($host_src -match 'st3\.boards = Array\.from')) "用户改过的「抓什么」不因重载回到默认"

Write-Host "== 版本 / 一键更新（2026-10-16）==" -ForegroundColor Cyan
$upd_src   = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src\scan\update.ts")
$check_src = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src\scan\update-check.ts")
#    ★ 注意：`$host_src -match '/api/rank-scan/version'` 会**恒假**（含 / 的模式串在 match 里被当正则，
#      实测踩过一次）⇒ 改用 IndexOf 做纯文本查找。
Check "更新-1 面板能读到自家版本（读包根 package.json）" (($host_src.IndexOf('rank-scan/version') -ge 0) -and ($host_src.IndexOf('readOwnVersion(import.meta.url)') -ge 0)) "路由 + import.meta.url（宿主是 ESM，__dirname 会 500）"
Check "更新-2 不装市场 ⇒ 只读降级，不报错" ($check_src -match "no-provider") "updateAvailability 三态"
Check "更新-3 每次外部调用都有超时（不许挂死面板）" ((Select-String -Path (Join-Path $root "src\scan\update.ts") -Pattern 'AbortSignal\.timeout' -AllMatches).Matches.Count -ge 2) "probeMarket / fetchNpmLatest 各有超时"
Check "更新-4 重启只走市场的 /restart（不发明进程控制）" (($host_src.IndexOf('rank-scan/update-restart') -ge 0) -and ($host_src -match 'restartSupported !== true')) "桌面版会被明确拒绝并让用户自己重启"
Check "更新-5 面板版本区在「抓什么」页且带一键更新按钮" (($client_src -match 'function VersionRow') -and ($client_src -match "jpost\('/update'")) "lib/client.js#VersionRow"

Write-Host ("== 汇总：PASS " + $pass + " / FAIL " + $fail + " ==") -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
