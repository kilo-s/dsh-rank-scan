/**
 * ★ 2026-10-25（0.3.0 发布准备）回归：两个 CLI 闸门的真实行为 + 两条接线。
 *
 * 为什么测 CLI 而不是测内部函数：这两件事在 CI 里的形态就是「跑一条命令、看退出码」。
 * 把逻辑抽成函数再单测，测到的只是函数，不是发布链真正执行的那条命令。所以这里起真子进程，
 * 用真文件（tag / package.json / CHANGELOG.md / 输出文件）和**隔离 Git 仓库**当输入。
 *
 * 覆盖的用户可见契约：
 *   · Release 说明必须能安全生成（字面反引号，不被 shell 当命令替换）；
 *   · tag 与包版本不一致、版本段缺失或为空 ⇒ 拒绝，且不产出半份说明；
 *   · 提交信息闸门只看 baseline..HEAD（已公开历史里的旧文案不再永久拖红）；
 *   · baseline 不存在 / 不是祖先 / git 跑不起来 ⇒ 一律非零（不许静默放行）。
 *
 * ★ 沙箱注意：受管沙箱下「父进程用管道捕获子进程 stdio」会 EPERM ⇒ 子进程输出
 *   一律重定向到文件再读回（与 tests/host-spawn.test.mjs 同一套办法）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync, closeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOTES_CLI = join(ROOT, 'scripts', 'release-notes.mjs')
const COMMIT_CLI = join(ROOT, 'scripts', 'check-commit-messages.mjs')

/** 公开面禁词（与 acceptance.ps1 同一口径）。字面量刻意用码点拼，免得本文件命中自己。 */
const BANNED = [
  [0x7ef4, 0x62a4, 0x8005],
  [0x672c, 0x673a],
  [0x5c5e, 0x4e3b],
  [0x8fd9, 0x53f0, 0x673a, 0x5668],
].map((codes) => String.fromCharCode(...codes))

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@example.invalid',
  GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
}

function scratch() {
  return mkdtempSync(join(tmpdir(), 'rsc-release-prep-'))
}

/** 跑一条命令，stdout/stderr 落到文件再读回（沙箱里不能用管道）。 */
function run(cmd, args, cwd) {
  const dir = scratch()
  const log = join(dir, 'out.txt')
  const fd = openSync(log, 'w')
  let res
  try {
    const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', fd, fd], timeout: 60000, env: GIT_ENV })
    closeSync(fd)
    res = { code: r.status, text: readFileSync(log, 'utf8'), spawnErr: r.error ? String(r.error) : null }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉不影响断言 */ }
  }
  return res
}

const nodeCli = (script, args) => run(process.execPath, [script, ...args], ROOT)

function writePackage(dir, version) {
  const file = join(dir, 'package.json')
  writeFileSync(file, JSON.stringify({ name: 'dsh-rank-scan', version }, null, 2) + '\n')
  return file
}

function writeChangelog(dir, body) {
  const file = join(dir, 'CHANGELOG.md')
  writeFileSync(file, body)
  return file
}

/* ---------- ① Release 说明生成 ---------- */

const CHANGELOG_OK = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '- 下一版才有的东西。',
  '',
  '## [0.3.0] - 2026-10-25',
  '',
  '### 修复',
  '',
  '- 面板进度显示真实数量。',
  '',
  '## [0.2.4] - 2026-10-17',
  '',
  '- 旧版内容。',
  '',
].join('\n')

test('Release 说明：tag 与包版本一致 ⇒ 写出该版本段 + 字面反引号安装命令', () => {
  const dir = scratch()
  try {
    const out = join(dir, 'release-notes.md')
    const r = nodeCli(NOTES_CLI, [
      '--tag', 'v0.3.0',
      '--package', writePackage(dir, '0.3.0'),
      '--changelog', writeChangelog(dir, CHANGELOG_OK),
      '--out', out,
    ])
    assert.equal(r.code, 0, '正常输入必须成功：' + r.text)
    assert.ok(existsSync(out), '必须写出说明文件')
    const notes = readFileSync(out, 'utf8')

    assert.match(notes, /面板进度显示真实数量/, '本版 CHANGELOG 段必须进说明')
    assert.ok(!/下一版才有的东西/.test(notes), '只取本版段，不许把 Unreleased 一起端出去')
    assert.ok(!/旧版内容/.test(notes), '也不许带上一版')

    // 安装说明里的反引号必须是**字面**的：整份说明由 Node 写文件，不经过 shell。
    assert.ok(notes.includes('```sh'), '安装命令要放在 sh 代码块里')
    assert.ok(
      notes.includes('dsh plugin --profile desktop add github:kilo-s/dsh-rank-scan#v0.3.0'),
      '安装命令要钉到本版 tag',
    )
    assert.ok(notes.includes('`dsh-rank-scan-0.3.0.tgz`'), '附件名要用字面反引号包住（旧实现被 shell 吃掉）')
    assert.ok(!/\$[({]/.test(notes), '不许残留未展开的 shell 变量/命令替换：' + notes.slice(0, 200))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Release 说明：tag 与包版本不一致 ⇒ 非零退出且不产出文件', () => {
  const dir = scratch()
  try {
    const out = join(dir, 'release-notes.md')
    const r = nodeCli(NOTES_CLI, [
      '--tag', 'v0.3.0',
      '--package', writePackage(dir, '0.2.4'),
      '--changelog', writeChangelog(dir, CHANGELOG_OK),
      '--out', out,
    ])
    assert.notEqual(r.code, 0, 'tag 与包版本不一致必须失败：' + r.text)
    assert.ok(!existsSync(out), '失败时不许留下半份说明（发布链会直接拿去创建 Release）')
    assert.match(r.text, /0\.2\.4/, '错误信息要点名实际版本：' + r.text)
    assert.match(r.text, /0\.3\.0/, '错误信息要点名 tag 版本：' + r.text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Release 说明：CHANGELOG 缺该版本段 ⇒ 拒绝', () => {
  const dir = scratch()
  try {
    const out = join(dir, 'release-notes.md')
    const r = nodeCli(NOTES_CLI, [
      '--tag', 'v0.3.0',
      '--package', writePackage(dir, '0.3.0'),
      '--changelog', writeChangelog(dir, '# Changelog\n\n## [0.2.4] - 2026-10-17\n\n- 旧版。\n'),
      '--out', out,
    ])
    assert.notEqual(r.code, 0, '没有本版段必须失败：' + r.text)
    assert.ok(!existsSync(out), '失败时不产出文件')
    assert.match(r.text, /CHANGELOG/, '错误信息要点名 CHANGELOG：' + r.text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Release 说明：版本段存在但为空 ⇒ 拒绝（不许发出空说明）', () => {
  const dir = scratch()
  try {
    const out = join(dir, 'release-notes.md')
    const empty = '# Changelog\n\n## [0.3.0] - 2026-10-25\n\n## [0.2.4] - 2026-10-17\n\n- 旧版。\n'
    const r = nodeCli(NOTES_CLI, [
      '--tag', 'v0.3.0',
      '--package', writePackage(dir, '0.3.0'),
      '--changelog', writeChangelog(dir, empty),
      '--out', out,
    ])
    assert.notEqual(r.code, 0, '空版本段必须失败：' + r.text)
    assert.ok(!existsSync(out), '失败时不产出文件')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------- ② 提交信息闸门 ---------- */

function git(repo, args) {
  const r = run('git', args, repo)
  assert.equal(r.code, 0, 'git ' + args.join(' ') + ' 失败：' + r.text + (r.spawnErr || ''))
  return r.text.trim()
}

function initRepo() {
  const dir = scratch()
  git(dir, ['init', '--quiet'])
  return dir
}

function commit(repo, message) {
  writeFileSync(join(repo, 'note.txt'), message)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '--quiet', '-m', message])
  return git(repo, ['rev-parse', 'HEAD'])
}

test('提交信息闸门：baseline..HEAD 干净时通过，基线之前的旧文案不再拖红', () => {
  const repo = initRepo()
  try {
    commit(repo, 'legacy: 早期提交里带着 ' + BANNED[1] + ' 这种词')
    const baseline = commit(repo, 'chore: 公开基线')
    commit(repo, 'fix: 新增提交是干净的')

    const r = nodeCli(COMMIT_CLI, ['--repo', repo, '--baseline', baseline])
    assert.equal(r.code, 0, '基线之前的历史不该再判失败：' + r.text)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('提交信息闸门：新增提交带禁词 ⇒ 非零并点名提交与词', () => {
  const repo = initRepo()
  try {
    const baseline = commit(repo, 'chore: 公开基线')
    const bad = commit(repo, 'docs: 顺手写了 ' + BANNED[0] + ' 三个字')

    const r = nodeCli(COMMIT_CLI, ['--repo', repo, '--baseline', baseline])
    assert.notEqual(r.code, 0, '新增提交违规必须失败：' + r.text)
    assert.ok(r.text.includes(BANNED[0]), '要点名命中的词：' + r.text)
    assert.ok(r.text.includes(bad.slice(0, 7)), '要点名违规提交：' + r.text)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('提交信息闸门：baseline 不存在 ⇒ 拒绝（不许当成「没有历史」放行）', () => {
  const repo = initRepo()
  try {
    commit(repo, 'chore: 唯一提交')
    const r = nodeCli(COMMIT_CLI, ['--repo', repo, '--baseline', '0'.repeat(40)])
    assert.notEqual(r.code, 0, '基线不存在必须失败：' + r.text)
    assert.match(r.text, /基线/, '错误信息要说清是基线问题：' + r.text)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('提交信息闸门：baseline 不是 HEAD 祖先 ⇒ 拒绝（否则等于放行任意历史）', () => {
  const repo = initRepo()
  try {
    commit(repo, 'chore: 一')
    const mid = commit(repo, 'chore: 二')
    const tip = commit(repo, 'chore: 三')
    git(repo, ['reset', '--quiet', '--hard', mid]) // tip 变成 mid 的后代，不再是祖先

    const r = nodeCli(COMMIT_CLI, ['--repo', repo, '--baseline', tip])
    assert.notEqual(r.code, 0, '非祖先基线必须失败：' + r.text)
    assert.match(r.text, /祖先/, '错误信息要说清祖先关系：' + r.text)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('提交信息闸门：不是 Git 仓库 ⇒ 非零（git 失败不许静默通过）', () => {
  const dir = scratch()
  try {
    const r = nodeCli(COMMIT_CLI, ['--repo', dir, '--baseline', '0'.repeat(40)])
    assert.notEqual(r.code, 0, 'git 跑不起来必须非零：' + r.text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------- ③ 接线：验收闸门与发布链 ---------- */

test('acceptance 接线：提交信息闸门改查 baseline..HEAD，且保留原有公开面检查', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'acceptance.ps1'), 'utf8')
  assert.ok(src.includes('check-commit-messages.mjs'), '必须调用新增的 CLI 闸门')
  assert.ok(
    src.includes('b838c30b59ce0673f789c98c9246c4c3bb0877c9'),
    '必须把已公开基线写成默认值（否则每条老提交都会永久拖红）',
  )
  assert.ok(!src.includes("log --format='%B' HEAD"), '整段历史扫描必须被替换掉')
  assert.match(src, /公开面闸：提交信息/, '原来那条检查的名字要保留（读者看得懂红在哪）')
  assert.match(src, /Check "[^"]*提交信息[^"]*" \(\$commitGateCode -eq 0\)/, '必须按 CLI 退出码判 PASS/FAIL')
})

test('build.yml 接线：dry_run 不能发布，且发布前跑 typecheck 与完整验收闸门', () => {
  const yaml = readFileSync(join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8')

  const typecheckAt = yaml.indexOf('npm run typecheck')
  const acceptanceAt = yaml.indexOf('scripts/acceptance.ps1 -SkipLive')
  const publishAt = yaml.indexOf('npm publish --access public')
  assert.ok(typecheckAt >= 0, '发布链必须跑 typecheck')
  assert.ok(acceptanceAt >= 0, '发布链必须跑与 checks 同一套离线验收闸门')
  assert.ok(publishAt >= 0, 'npm 发布步骤还在（不是把发布删了了事）')
  assert.ok(typecheckAt < publishAt, 'typecheck 必须在发布之前')
  assert.ok(acceptanceAt < publishAt, '验收闸门必须在发布之前')

  // 每一个会写公开副作用的步骤都必须带 dry_run 守卫（workflow_dispatch 默认 dry_run=true）。
  const guard = /inputs\.dry_run\s*(?:!=\s*'true'|==\s*false)|github\.event_name\s*==\s*'push'/
  const steps = []
  let cur = null
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^      - name: (.*)$/.exec(line)
    if (m) { cur = { name: m[1], body: [] }; steps.push(cur); continue }
    if (cur) cur.body.push(line)
  }
  const publishing = steps.filter((s) => {
    const code = s.body.filter((l) => !/^\s*#/.test(l)).join('\n')
    return /gh release (create|edit|upload)|npm publish/.test(code)
  })
  assert.ok(publishing.length >= 2, '至少应识别出 Release 与 npm 两个发布步骤：' + publishing.map((s) => s.name).join(' / '))
  for (const step of publishing) {
    const guardLine = step.body.find((l) => /^\s+if:/.test(l))
    assert.ok(guardLine, '发布步骤「' + step.name + '」必须带 if: 守卫')
    assert.match(guardLine, guard, '发布步骤「' + step.name + '」的守卫挡不住 dry_run=true：' + guardLine.trim())
  }
})
