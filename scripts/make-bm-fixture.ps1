<#
.SYNOPSIS
  生成「我的书签」长列表隔离夹具（默认 120 条，> 50 便于验收分批渲染）。

.DESCRIPTION
  只写 ${OutDir}/state/bookmarks.json，**绝不**触碰真实数据目录。
  验收时把插件的 dataDir 配置指向 ${OutDir}，或用 DSH_HOME 指向 ${OutDir} 的上一级，
  拍完即删。夹具内容全部是合成数据（书名带「夹具」前缀），一眼可辨不是真实书签。

.PARAMETER OutDir
  夹具根目录；默认落在临时目录下的 rank-scan-fixture-bm。

.PARAMETER Count
  书签条数；默认 120（> 50，覆盖「已显示 50 / y」与「再显示 50 条」）。

.PARAMETER Force
  目标文件已存在时允许覆盖。

.EXAMPLE
  pwsh -File scripts/make-bm-fixture.ps1
  pwsh -File scripts/make-bm-fixture.ps1 -OutDir "$env:TEMP/rs-bm-120" -Count 120 -Force
#>
[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'rank-scan-fixture-bm'),
  [int]$Count = 120,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ($Count -lt 1) { throw "Count 必须 >= 1（收到 $Count）" }

$file = Join-Path $OutDir 'state/bookmarks.json'
if ((Test-Path $file) -and -not $Force) {
  throw "目标已存在：$file（要覆盖请加 -Force）"
}

$sites = @('qidian', 'qidiantu', 'ciweimao', 'sfacg', 'fanqie')
$folders = @('追更', '看完', '待看', '参考资料')
$tags = @('爽文', '无限流', '女性向', '克苏鲁', '种田')
$now = [DateTime]::UtcNow
$list = New-Object System.Collections.Generic.List[object]

for ($i = 0; $i -lt $Count; $i++) {
  $site = $sites[$i % $sites.Count]
  $id = 900000 + $i
  # 每 7 条留一条没有备注（验证「＋ 备注」淡色文字按钮），其余带备注与标签
  $hasNote = ($i % 7) -ne 0
  # 每 11 条留一条陈旧数据（超 7 天，验证 warn chip）
  $stale = ($i % 11) -eq 0
  # 每 13 条留一条「待补」（valueFrom=manual，验证待补 chip 与 — 读数）
  $pending = ($i % 13) -eq 0
  $daysOld = if ($stale) { 12 } else { $i % 5 }
  $captured = $now.AddDays(-$daysOld).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $created = $now.AddDays(-($i % 40) - 1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $collected = if ($pending) { $null } else { 1200 + ($i * 137) % 90000 }
  $label = if ($site -eq 'fanqie') { '在读' } else { '收藏' }
  $boardId = switch ($site) {
    'qidian' { 'qidian.monthly-ticket' }
    'qidiantu' { 'qidiantu.shouding' }
    'ciweimao' { 'ciweimao.original-recommend' }
    'sfacg' { 'sfacg.new-book' }
    default { 'fanqie.hot' }
  }

  $list.Add([ordered]@{
      bookKey      = "$site`:$id"
      site         = $site
      url          = "https://example.invalid/$site/book/$id"
      source       = 'board'
      firstSeen    = [ordered]@{ boardId = $boardId; rank = ($i % 30) + 1; dataDate = $now.AddDays(-$daysOld).ToString('yyyy-MM-dd') }
      seenBoards   = @([ordered]@{ boardId = $boardId; rank = ($i % 30) + 1; dataDate = $now.AddDays(-$daysOld).ToString('yyyy-MM-dd') })
      title        = "夹具书目标题 $($i + 1) —— 用来验收长列表与三行卡片"
      author       = "夹具作者 $(([char](65 + ($i % 26))))"
      words        = if ($pending) { $null } else { 120000 + ($i * 3700) % 900000 }
      metric       = [ordered]@{ name = $label; value = $collected }
      metricBoard  = $boardId
      metricDate   = $now.AddDays(-$daysOld).ToString('yyyy-MM-dd')
      collect      = $collected
      collectLabel = $label
      collectFrom  = if ($pending) { 'none' } else { 'snapshot' }
      capturedAt   = $captured
      valueFrom    = if ($pending) { 'manual' } else { 'snapshot' }
      input        = $null
      note         = if ($hasNote) { "夹具备注 $($i + 1)：可用 #$($tags[$i % $tags.Count]) 归类" } else { '' }
      folders      = @($folders[$i % $folders.Count])
      createdAt    = $created
      updatedAt    = $created
    })
}

$payload = [ordered]@{
  bookmarksVersion = 1
  savedAt          = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  bookmarks        = $list
}

New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'state') | Out-Null
$json = ($payload | ConvertTo-Json -Depth 8)
[System.IO.File]::WriteAllText($file, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "已生成夹具：$Count 条"
Write-Host "  文件：$file"
Write-Host "  用法：把插件 dataDir 指向 $OutDir（或在隔离 profile 里设 DSH_HOME 指向 $OutDir 的上一级），验收完删除目录"
Write-Host "  提示：本夹具全部是合成数据（example.invalid 域名），不会与真实书签混淆"
