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
$src        = Join-Path $root "src/index.ts"
$client     = Join-Path $root "lib/client.js"
$bookmark   = Join-Path $root "src/scan/bookmark.ts"
$host_src   = Get-Content -Raw -Encoding UTF8 $src
$client_src = Get-Content -Raw -Encoding UTF8 $client
$bm_src     = Get-Content -Raw -Encoding UTF8 $bookmark
# 周期榜换期三件套（2026-10-16 rank-scan-next-session）：三江空期回退 + 跨期不可比保护
$diff_src   = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src/scan/diff.ts")
$qd_src     = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src/sites/qidiantu.ts")

Write-Host "== 不连累本体 ==" -ForegroundColor Cyan
Check "P0-1 定时回调有兜底（未捕获拒绝会让宿主 exit(1)）" ($host_src -match "checkTimer\(\)\.catch") "setInterval 回调挂了 .catch"
Check "P0-1 recordRun 自身不抛" ($host_src -match "写定时状态失败（已吞）") "写盘失败只记 timer.log"
Check "P0-2 日期入口有校验" ($host_src -match "assertDataDate\(body\.date\)") ("调用点数=" + ([regex]::Matches($host_src, "assertDataDate\(body\.date\)").Count))
#   ★ 2026-10-16（审计-2/46）：旧断言只 match "async function withScanLock" ⇒ 有人把调用点删光它照样 PASS。
#     改成真断言：锁**定义**在 + **两个**手动入口（/scan、/retry）都真的调用它。
Check "票 30 扫描锁真的置位" ((([regex]::Matches($host_src, "async function withScanLock")).Count -eq 1) -and ($host_src -match "withScanLock\(\(\) => doScan\('manual', \{ retry: true") -and ($host_src -match "withScanLock\(\(\) => doScan\('manual', opts\)\)")) "锁定义 1 处 + /retry 与 /scan 两个调用点都在"
#   ★ 2026-10-16（审计-2/46）：旧正则 "6,10_000|10_000\)" 太松。改成「把超时值抠出来 + 断言它是有界正整数」。
$readBodyTimeout = [regex]::Match($host_src, 'const timer = setTimeout\(\(\) => done\(\{\}\), ([0-9_]+)\)').Groups[1].Value
Check "票 30 readBody 有超时" ($readBodyTimeout -match '^[0-9][0-9_]*$' -and [int]($readBodyTimeout -replace '_','') -ge 1000 -and [int]($readBodyTimeout -replace '_','') -le 60000) ("readBody 超时 = " + $readBodyTimeout + " ms（有界：1s–60s）")
#   ★ 2026-10-16（审计-2/46）：旧断言只查 bounded-fetch.ts **文件存在** ⇒ 五站全都没接线也 PASS。
$bfSites = ([regex]::Matches($host_src, "await boundedFetch\(")).Count
$bfAdapters = @(@("fanqie","ciweimao","sfacg","qidian-mobile","qidiantu") | Where-Object { (Get-Content -Raw -Encoding UTF8 (Join-Path $root ("src/sites/" + $_ + ".ts"))) -match "await boundedFetch\(" }).Count
Check "票 29 站点请求有超时" (($host_src -match "import \{[^}]*boundedFetch[^}]*\} from '\./scan/bounded-fetch\.js'") -and ($bfSites -ge 5) -and ($bfAdapters -eq 5)) ("host 补全链 await boundedFetch=" + $bfSites + " 处（>=5）；五个站适配器接线=" + $bfAdapters + "/5")

Write-Host "== 轻量 ==" -ForegroundColor Cyan
#   ★ 2026-10-16（审计-2/46）：旧断言只 match 函数名 ⇒ 函数体被掏空也 PASS。
#     改成真断言：syncTimer 内部真的读 timerEnabled 开关、并按开关接/断定时器。
Check "票 25 定时惰性接线" (($host_src -match "function syncTimer\(") -and ($host_src -match "function syncTimer\(\)[\s\S]{0,900}?timerEnabled") -and ($host_src -match "function syncTimer\(\)[\s\S]{0,900}?setInterval\(") -and ($host_src -match "function syncTimer\(\)[\s\S]{0,900}?disposer\(\)")) "syncTimer 体内读 timerEnabled 且真的 setInterval 接线 / disposer() 断开"
#   ★ 2026-10-16（审计-2/46）：同上，函数名不算证据。要求「函数体里有缓存字段 + 真的 TTL 比较」。
Check "票 26 占用统计走缓存" (($host_src -match "function storageSummary\(") -and ($host_src -match "function storageSummary\([\s\S]{0,1200}?storageCache") -and ($host_src -match "function storageSummary\([\s\S]{0,1200}?now \- storageCache\.at > STORAGE_TTL_MS") -and ($host_src -match "function storageSummary\([\s\S]{0,1200}?storageCache = \{ at: now")) "storageSummary 走 storageCache + TTL 比较 + 命中时回填"
Check "票 27 面板收起/隐藏不轮询" (($client_src -match "document\.visibilityState") -and ($client_src -match "if \(!open\) return undefined")) "可见性判断 + 收起提前返回"

Write-Host "== 坏了也没事 ==" -ForegroundColor Cyan
Check "票 28 书签写盘原子（无先删后改名）" (-not ($bm_src -match "rmSync\(this\.file")) "bookmark.ts 不再 rmSync 主文件"
#   ★ 2026-10-16（审计-2/46）：旧断言只认这条**错误消息字符串** ⇒ 轮转被删掉也 PASS。
Check "票 28 主文件缺失能从备份恢复" (($bm_src -match "主文件缺失，已从备份恢复") -and ($bm_src -match "for \(let i = 1; i <= BACKUP_ROTATION; i\+\+\)") -and ($bm_src -match "this\.file \+ '\.' \+ i") -and ($bm_src -match "return \{ file: migrate\(got\), error: why \+ bak, recoveredFrom: bak \}")) "read() 真按 BACKUP_ROTATION 轮转，命中即回传 recoveredFrom"

Write-Host "== 离线测试 ==" -ForegroundColor Cyan
Push-Location $root
#   ★ 2026-10-16（审计-2/46）：旧实现硬编码 3 个文件，而 docs/DEVELOPMENT.md 宣称
#     「文件名以 .test.mjs 结尾即被两个闸门收集」⇒ 改成全量收集（唯一真调 apply() 的
#     update-routes.test.mjs 此前根本不在列表里）。
$testFiles = Get-ChildItem -Path (Join-Path $root 'tests') -Filter '*.test.mjs' | Sort-Object Name
Check "离线测试收集数 >= 3（全量收集 tests\*.test.mjs）" ($testFiles.Count -ge 3) ("收集到 " + $testFiles.Count + " 个 *.test.mjs：" + (($testFiles | ForEach-Object { $_.Name }) -join ', '))
foreach ($t in $testFiles) {
  node $t.FullName | Out-Null
  Check ("离线测试 " + $t.Name) ($LASTEXITCODE -eq 0) $t.Name
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
#   ② 个人绝对路径（形如「系统盘 + 用户目录 + 某个真人的名字」；本行刻意不写真样本，
#      否则闸门会命中这条注释 —— 2026-10-16 审计-2/46 踩过）
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
#     ★ 2026-10-16（审计-2/46）：旧 needle 被拼成了带**两个**反斜杠的字符串，真实路径永远命中不了，
#       等于闸门白设。改成单反斜杠（本注释刻意不写反斜杠，否则闸门会命中自己这条注释）；
#       自检样本也改成独立字面量（旧样本是照着 needle 拼的 ⇒ 恒真）。
$userPathNeedle = 'C:' + [char]92 + 'Users' + [char]92
#    ★ 探针自检：先用合成样本证明这个匹配真的能命中（历史坑：模式以反斜杠结尾 ⇒ 正则非法 ⇒ 每次都在
#      抛异常，而探针却显示 PASS，等于白设）。
$pathSample = 'C:' + [char]92 + 'Users' + [char]92 + 'someone' + [char]92 + 'Documents' + [char]92 + 'x.txt'
$probeWorks = $pathSample.Contains($userPathNeedle)
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
#      ★ 2026-10-25（0.3.0 发布准备）：口径改成**只查已公开基线之后的新增提交**。
#      旧实现扫整段 git log ⇒ 已公开历史里的一条旧文案会把发布链永久拖红：既拦不住新问题，
#      又让人习惯性忽略红灯；而重写历史会改掉已发布 tag 的 sha，不能做。
#      基线必须存在且是 HEAD 的祖先，否则 CLI 直接非零（宁红不放行，不许静默放行）。
#      文件层面的禁词检查（上面 ③）仍覆盖全部当前文件，那部分没有历史包袱。
$commitBaseline = 'b838c30b59ce0673f789c98c9246c4c3bb0877c9'
$commitGate = Join-Path $root 'scripts/check-commit-messages.mjs'
$commitGateCode = 1
$commitGateOut = ""
try {
  # 先用 PowerShell 的 node 探一下：测试会注入一个会抛错的 node 函数，不能绕过它直接用 .NET 起真 node。
  & node --version | Out-Null
  # 直接用 .NET Process 取 ExitCode：后台作业/重定向下 $LASTEXITCODE 偶尔被管道里的 cmdlet 覆盖，
  # 而 Start-Process -PassThru 返回的进程对象 ExitCode 为空；两者都会把「未命中禁词」误判成红。
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'node'
  foreach ($arg in @($commitGate, '--repo', $root, '--baseline', $commitBaseline)) { $psi.ArgumentList.Add($arg) }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.WaitForExit()
  $commitGateCode = $p.ExitCode
  $commitGateOut = $outTask.Result + $errTask.Result
} catch {
  $commitGateOut = $_.Exception.Message
}
Check "公开面闸：提交信息里没有内部称呼（Git 元数据同样是公开面）" ($commitGateCode -eq 0) ("baseline " + $commitBaseline.Substring(0, 7) + "..HEAD；" + ($commitGateOut.Trim() -replace "`r?`n", ' | '))
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
Check "轻量闸：面板产物不会再被构建覆盖（无 src/client、无 tsdown 配置）" ((-not (Test-Path (Join-Path $root 'src/client'))) -and (-not (Test-Path (Join-Path $root 'tsdown.config.ts')))) "手写 client/parts/*.js + 构建拼接"
#   ★ 面板源必须在仓库里：此前它只存在于开发机的 lib/client.js 里（lib/ 不入库），
#     于是 CI 从源码构建出的 tgz 没有面板，build.yml 的产物校验必然失败。
$clientPartsDir = Join-Path $root 'client/parts'
$clientOutPath = Join-Path $root 'lib/client.js'
$clientParts = if (Test-Path $clientPartsDir) { @(Get-ChildItem $clientPartsDir -Filter '*.js' | Sort-Object Name) } else { @() }
$clientSrcExists = ($clientParts.Count -gt 0)
$clientOutExists = Test-Path $clientOutPath
$clientSrcText = ($clientParts | ForEach-Object { "/* ---- parts/" + $_.Name + " ---- */" + [char]10 + (Get-Content -Raw -Encoding UTF8 $_.FullName) }) -join ''
$clientOutText = if ($clientOutExists) { Get-Content -Raw -Encoding UTF8 $clientOutPath } else { '' }
#   ★ 2026-10-16（审计-2/46）：旧实现产物缺失时 $clientSame = $true（恒真）⇒ 从没构建过也 PASS。
#     改成三段真断言：源在 + 产物在 + 内容一致（缺产物 = FAIL，如实报「没构建」）。
$clientSame = ($clientSrcExists -and $clientOutExists -and ($clientSrcText -ceq $clientOutText))
Check "装配闸：面板源入库（client/parts/*.js），且 lib/client.js 与拼接结果一致" ($clientSrcExists -and $clientOutExists -and $clientSame) ("源文件=" + $clientParts.Count + " 产物存在=" + $clientOutExists + " 内容一致=" + $clientSame + "（产物缺失即 FAIL：跑 scripts\build-local.ps1）")
$tgz = Get-ChildItem -Path $root -Filter '*.tgz' -ErrorAction SilentlyContinue | Select-Object -First 1
#   ★ 2026-10-16（审计-2/46）：干净 clone 上必然没有 tgz ⇒ 旧写法 Check ... $false 让 acceptance.ps1 恒 exit 1。
#     未 pack 改成 SKIP（不计 fail），pack 过了就照旧查体积。
if ($tgz) {
  Check "分发闸：tgz 体积 <= 400 KB" ($tgz.Length -le 409600) ($tgz.Name + ' = ' + [math]::Round($tgz.Length / 1024) + ' KB')
} else {
  Write-Host "SKIP  分发闸：tgz 体积（还没 npm pack —— 干净 clone 上属正常，分发前要产出）" -ForegroundColor Yellow
}
#   ★ 2026-10-16（审计-2/46）：旧断言与后面的「开关-1」重复且更弱（只挡 st1 一个变量名）。
#     改成「全文件只有一处 timerEnabled 赋值，且必须是面板 /timer 接口」。
$hostCode = ($host_src -split "`n" | Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' -and $_ -notmatch "timerLog\(" }) -join "`n"
$timerAssigns = ([regex]::Matches($hostCode, 'timerEnabled\s*=(?!=)')).Count
$timerPanelAssigns = ([regex]::Matches($host_src, 'stT\.timerEnabled = body\.enabled')).Count
Check "迁移闸：除面板 /timer 接口外没有任何代码写 timerEnabled" (($timerAssigns -eq 1) -and ($timerPanelAssigns -eq 1)) ("timerEnabled 赋值语句=" + $timerAssigns + " 处；其中面板 /timer 接口=" + $timerPanelAssigns + " 处")
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
$upd_src   = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src/scan/update.ts")
$check_src = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src/scan/update-check.ts")
#    ★ 注意：`$host_src -match '/api/rank-scan/version'` 会**恒假**（含 / 的模式串在 match 里被当正则，
#      实测踩过一次）⇒ 改用 IndexOf 做纯文本查找。
Check "更新-1 面板能读到自家版本（读包根 package.json）" (($host_src.IndexOf('rank-scan/version') -ge 0) -and ($host_src.IndexOf('readOwnVersion(import.meta.url)') -ge 0)) "路由 + import.meta.url（宿主是 ESM，__dirname 会 500）"
Check "更新-2 不装市场 ⇒ 只读降级，不报错" ($check_src -match "no-provider") "updateAvailability 三态"
Check "更新-3 每次外部调用都有超时（不许挂死面板）" ((Select-String -Path (Join-Path $root "src/scan/update.ts") -Pattern 'AbortSignal\.timeout' -AllMatches).Matches.Count -ge 2) "probeMarket / fetchNpmLatest 各有超时"
Check "更新-4 重启只走市场的 /restart（不发明进程控制）" (($host_src.IndexOf('rank-scan/update-restart') -ge 0) -and ($host_src -match 'restartSupported !== true')) "桌面版会被明确拒绝并让用户自己重启"
Check "更新-5 面板版本区在「抓什么」页且带一键更新按钮" (($client_src -match 'function VersionRow') -and ($client_src -match "jpost\('/update'")) "lib/client.js#VersionRow"

Write-Host ("== 汇总：PASS " + $pass + " / FAIL " + $fail + " ==") -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
