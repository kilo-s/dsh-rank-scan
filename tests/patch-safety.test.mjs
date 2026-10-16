/**
 * 票 45①：patch 安全（静态 + 行为）
 *
 * 来源：docs/rank-scan/需求确认-审计修复-v1.md §1 Q24（**修订 Q17**）+ §3.1。
 *   Q24 冻结口径：**卸载/安装脚本永不重写用户的 cordis.patch.yml** —— 只做
 *   `dsh plugin remove` + 按 package.json 的 name 删 junction；patch 里的残留 disabled
 *   条目**只打印说明，不再删除**（宿主对非法 patch 是 fail-loud：`--dump-config` exit=1，
 *   而且 patch 被删坏之后 DSH 自己的界面/CLI 也修不了）。
 *
 * 本文件是一支**常驻红线**：
 *   ① 静态：install/uninstall 脚本对 cordis.patch.yml 只许读/打印，不许出现写操作；
 *   ② 行为：在隔离 DSH_HOME（本工作区内的临时目录）里对**四种真实形态**跑一遍修复逻辑，
 *      然后 `dsh --profile X --dump-config` 必须 exit=0。
 *
 * Q28：**拿不到 dsh 时 SKIP 不算失败**（CI/其它机器上没装 DSH 也不许红）。
 * 说明：ticket 47 的 `repair-patch` 脚本**本来就要回写**用户的 patch（那是它的职责），
 *      因此静态检查刻意只锚在 install/uninstall 上（与 Q24 的措辞一致）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, openSync, closeSync } from 'node:fs'
import { join, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = 'dsh-rank-scan'
const PROFILE = 'probe'
const tmpRoot = join(root, 'tests', '.tmp-patch-safety')

// ── ① 静态：install / uninstall 不许写 patch ──────────────────────────────

const INSTALL_NAME = /^(un)?install\.(ps1|sh)$/i
const PATCH_REF = /(cordis\.patch\.yml|\$patch\b|\$PATCH\b)/
const WRITE_CALL =
  /\b(Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item|rm|mv|cp|sed|perl)\b|(?<![0-9<>-])>(?!>)|>>|>>/

function scanPatchWrites(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const hits = []
  let block = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const t = raw.trim()
    if (block) {
      if (t.includes('#>')) block = false
      continue
    }
    if (t.startsWith('<#')) {
      if (!t.includes('#>')) block = true
      continue
    }
    if (t.startsWith('#') || t.startsWith('//')) continue
    if (!PATCH_REF.test(raw)) continue
    if (WRITE_CALL.test(raw)) hits.push(relative(root, file).replace(/\\/g, '/') + ':' + (i + 1) + '  ' + t.slice(0, 110))
  }
  return hits
}

test('静态探针自检：写操作样本必须被这条检查命中（否则检查是空的）', () => {
  const samples = [
    'Set-Content -Path $patch -Value $new -Encoding UTF8',
    'Copy-Item $patch "$patch.bak" -Force',
    'perl -0pi -e "s/x/y/" "$PATCH"',
    'printf "[]" > "$PATCH"',
    'Set-Content -Path (Join-Path $profileDir "cordis.patch.yml") -Value "[]"',
  ]
  for (const s of samples) {
    assert.ok(PATCH_REF.test(s), '样本应命中 patch 引用：' + s)
    assert.ok(WRITE_CALL.test(s), '样本应命中写操作：' + s)
  }
  const negatives = [
    '$patch = Join-Path $profileDir "cordis.patch.yml"',
    'Write-Host "patch: $patch"',
    'if (Test-Path $patch) { $txt = Get-Content -Raw -Encoding UTF8 $patch }',
    'echo "残留条目见 $PATCH，用 repair-patch 清"',
  ]
  for (const s of negatives) {
    assert.ok(PATCH_REF.test(s), '反样本应命中 patch 引用：' + s)
    assert.ok(!WRITE_CALL.test(s), '反样本不该被判成写操作：' + s)
  }
})

function collectNamed(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git') continue
    const full = join(dir, n)
    if (statSync(full).isDirectory()) collectNamed(full, acc)
    else if (INSTALL_NAME.test(n)) acc.push(full)
  }
  return acc
}

test('静态：install/uninstall 脚本对 cordis.patch.yml 只读不写（Q24：只打印说明）', () => {
  const targets = collectNamed(join(root, 'scripts'))
  assert.ok(targets.length >= 4, '应扫到 install/uninstall 的 ps1 与 sh 四个文件，实际 ' + targets.length)
  const hits = []
  for (const f of targets) hits.push(...scanPatchWrites(f))
  assert.deepEqual(hits, [], 'Q24：安装/卸载脚本不得重写用户的 patch 文件（只许读/打印），命中：\n' + hits.join('\n'))
})

// ── ② 行为：隔离 DSH_HOME + 四种真实形态 ──────────────────────────────────

/**
 * 找到 dsh 本体。dsh 的 launcher（dsh.cmd / dsh.ps1）里写的是
 * `"%dp0%\node_modules\@deepseek-ai\dsh\lib\bin.js"` —— 用绝对路径直跑 **node**，
 * 既避开「shim 是不是可执行」的差异，也避开 .cmd 需要 cmd.exe 的坑。
 * 拿不到就返回 null ⇒ 行为探针 SKIP（Q28）。
 */
function findDsh() {
  const sep = process.platform === 'win32' ? ';' : ':'
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh'] : ['dsh']
  const probe = (js) => {
    if (!existsSync(js)) return null
    const r = execCapture(process.execPath, [js, '--version'], process.env)
    return r.status === 0 ? { node: process.execPath, js } : null
  }
  for (const d of (process.env.PATH || '').split(sep)) {
    if (!d) continue
    for (const n of names) {
      const shim = join(d, n)
      if (!existsSync(shim)) continue
      if (process.platform !== 'win32') return { direct: shim }
      const text = readFileSync(shim, 'utf8')
      const m = text.match(/node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/)
      if (m) {
        const hit = probe(join(d, m[0]))
        if (hit) return hit
      }
    }
  }
  return null
}

/**
 * ★ 沙箱注意：本机 DSH 沙箱下「父进程用管道捕获子进程 stdio」会 EPERM ⇒
 *   一律把 stdout/stderr **重定向到文件**（stdio: ['ignore', fd, fd]）再读回。
 */
function execCapture(exe, args, env) {
  mkdirSync(tmpRoot, { recursive: true })
  const outPath = join(tmpRoot, 'stdout.txt')
  const errPath = join(tmpRoot, 'stderr.txt')
  const fdOut = openSync(outPath, 'w')
  const fdErr = openSync(errPath, 'w')
  let status = -1
  let spawnError = null
  try {
    const r = execFileSync(exe, args, {
      env: { ...env, DSH_HOME: env.DSH_HOME },
      cwd: root,
      stdio: ['ignore', fdOut, fdErr],
      timeout: 90000,
    })
    void r
    status = 0
  } catch (e) {
    status = typeof e.status === 'number' ? e.status : -1
    spawnError = e.code ? String(e.code) : null
  } finally {
    closeSync(fdOut)
    closeSync(fdErr)
  }
  const out = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
  const err = existsSync(errPath) ? readFileSync(errPath, 'utf8') : ''
  return { status, out, err, spawnError }
}

function runDumpConfig(dsh, home) {
  const env = { ...process.env, DSH_HOME: home }
  const tail = ['--profile', PROFILE, '--dump-config']
  if (dsh.node && dsh.js) return execCapture(dsh.node, [dsh.js, ...tail], env)
  if (dsh.direct) return execCapture(dsh.direct, tail, env)
  return { status: -1, out: '', err: 'no dsh launcher', spawnError: 'ENODSH' }
}

function writeUtf8(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

/**
 * 四种真实形态（审计 §3.1 实测：未修复前 dump-config 全部 exit=1）。
 * 每种都带宿主流下来的 tombstone 注释 + 本插件条目，再叠一层真实损坏。
 */
const FORMS = [
  {
    key: 'A-only-tombstone',
    desc: '只剩 tombstone 注释（条目已被删掉）⇒ 解析成 null，不是顶层数组',
    damaged:
      '# Your patch layer for this dsh profile, applied after every bundle layer:\n' +
      '# a top-level YAML array of loader patch entries.\n' +
      '# ' + PKG + ' 的残留条目已被删掉，只剩这行说明\n',
  },
  {
    key: 'B-name-config',
    desc: '条目带 name + config（多行嵌套）⇒ 嵌套块里留了非法缩进行',
    damaged:
      '# Your patch layer for this dsh profile:\n' +
      '- id: ' + PKG + '\n' +
      '  name: ' + PKG + '\n' +
      '  config:\n' +
      '    panel: true\n' +
      '   bad: 1\n' + // 故意比父级只多一格 ⇒ YAML 非法
      '# 已卸载插件（' + PKG + '，原 Q17 残留说明）\n',
  },
  {
    key: 'C-insert-wrapper',
    desc: '条目被 - insert: 包裹 ⇒ 内层缩进行变成孤儿（子序列里出现非法项）',
    damaged:
      '# Your patch layer for this dsh profile:\n' +
      '- insert:\n' +
      '    - id: ' + PKG + '\n' +
      '  - id: 9\n' +
      '   bad: 1\n' +
      '# 已卸载插件（' + PKG + '）\n',
  },
  {
    key: 'D-first-line',
    desc: '条目就在文件首行（前面没有注释缓冲），后面还挂着不合法内容',
    damaged: '- id: ' + PKG + '\n' + '  disabled: true\n' + ': bad\n',
  },
]

/** 修复逻辑：只改**脚本自己写坏的那一处**，其余合法条目原样保留；无条目则写 [] 保底（与 ticket 47 的 repair-patch 同口径） */
function repairPatch(file) {
  const before = readFileSync(file, 'utf8')
  const lines = before.split(/\r?\n/)
  const kill = new Set()
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s*id:\s*['"]?([^\s'"]+)['"]?\s*(?:#.*)?$/)
    if (!m || m[2] !== PKG) continue
    kill.add(i)
    if (/^\s*-\s*insert:/.test(lines[i - 1] ?? '')) kill.add(i - 1)
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^\s+\S/.test(lines[j]) && lines[j].trim() !== '') break
      kill.add(j)
    }
  }
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (kill.has(i)) continue
    if (new RegExp('^#.*已卸载插件.*' + PKG).test(lines[i])) continue
    out.push(lines[i])
  }
  const kept = out.filter((l) => /^\s*-\s+\S/.test(l)).length
  const text = kept === 0 ? '[]\n' : out.join('\n').replace(/\n{3,}/g, '\n\n')
  writeUtf8(file, text)
  return { after: text, kept, removed: kill.size }
}

const dsh = findDsh()

test('行为（Q28：拿不到 dsh 就 SKIP 不算失败）', (t) => {
  if (!dsh) {
    t.skip('PATH 上没有 dsh：按 Q28 跳过行为探针，不算失败')
    return
  }
  try {
    rmSync(tmpRoot, { recursive: true, force: true })
    const home = join(tmpRoot, 'home')
    const profDir = join(home, 'profiles', PROFILE)
    writeUtf8(
      join(profDir, 'package.json'),
      JSON.stringify({ name: 'dsh-profile-' + PROFILE, private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2) + '\n',
    )
    const patchFile = join(profDir, 'cordis.patch.yml')

    // 0) 夹具自证：健康形态必须 exit=0（否则 dsh 侧的问题会伪装成修复失败）
    writeUtf8(patchFile, '# Your patch layer for this dsh profile:\n[]\n')
    const healthy = runDumpConfig(dsh, home)
    assert.equal(healthy.status, 0, '隔离 profile 本身跑不通 dump-config（夹具问题，不是修复问题）：' + healthy.err.slice(0, 300))

    const summary = []
    for (const form of FORMS) {
      writeUtf8(patchFile, form.damaged)
      const before = runDumpConfig(dsh, home)
      assert.notEqual(before.status, 0, '形态 ' + form.key + ' 本该 exit!=0（' + form.desc + '），实际 exit=0 ⇒ 夹具不成立')

      const r = repairPatch(patchFile)
      const after = runDumpConfig(dsh, home)
      summary.push(form.key + ': exit ' + before.status + ' → ' + after.status + '（保留条目 ' + r.kept + '，删 ' + r.removed + ' 行）')

      assert.equal(after.status, 0, '形态 ' + form.key + '（' + form.desc + '）修复后仍 exit=' + after.status + '\n' + after.err.slice(0, 400))
      assert.match(after.out, /^\s*-\s+id:/m, 'dump-config 输出里应有顶层数组条目')
      assert.ok(!(r.kept === 0 && after.out.trim() === ''), 'dump-config 不该什么都不输出')
    }

    // 兜底：只剩注释 ⇒ 必须保底写 [] 且仍 exit=0
    writeUtf8(patchFile, '# 只剩注释\n')
    repairPatch(patchFile)
    assert.equal(readFileSync(patchFile, 'utf8').trim(), '[]', '无条目时修复逻辑必须保底写 []')
    const fallback = runDumpConfig(dsh, home)
    assert.equal(fallback.status, 0, '[] 保底后必须 exit=0，实际 ' + fallback.status)

    console.log('    形态汇总（修复前 exit → 修复后 exit）：')
    for (const s of summary) console.log('      ' + s)
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})
