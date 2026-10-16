# 本地自测：按文件直接跑（node --test 会 spawn 子进程，被沙箱拒 EPERM）
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $fail = 0
  foreach ($f in Get-ChildItem tests\*.test.mjs) {
    Write-Host ("=== " + $f.Name + " ===")
    node $f.FullName
    if ($LASTEXITCODE -ne 0) { $fail++ }
  }
  if ($fail -gt 0) { Write-Host "$fail 个测试文件失败"; exit 1 }
  Write-Host "全部离线测试通过"
} finally { Pop-Location }
