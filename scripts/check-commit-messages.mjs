#!/usr/bin/env node
/**
 * 提交信息闸门（零依赖 Node CLI）：只查 `baseline..HEAD` 的新增提交。
 *
 * 为什么不再扫整段 git log：仓库是公开的，GitHub 的提交列表会把每条信息直接展示给读者，
 * 所以提交信息确实属于公开面、必须检查。但**已公开的历史无法修改**（重写历史会把
 * 所有已发布 tag 的 sha 一起改掉），扫全历史等于让一个既成事实永久拖红发布链 ——
 * 既拦不住任何新问题，又让人习惯性忽略红灯。
 *
 * 现在的口径：固定一个「已公开基线」，只对基线之后的新增提交执行禁词检查；
 * 文件层面的禁词 / 绝对路径 / 死链检查仍覆盖全部当前文件（那部分没有历史包袱）。
 *
 * 拒绝（非零退出）的情形 —— 全部是**宁可红也不放行**：
 *   · 缺 --baseline、基线提交不存在；
 *   · 基线不是 HEAD 的祖先（那 range 就没意义，等于放行任意历史）；
 *   · git 跑不起来（不是仓库、没有提交、spawn 失败）。
 *
 * 用法：node scripts/check-commit-messages.mjs --repo <目录> --baseline <sha> [--head <sha>]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const USAGE = '用法：check-commit-messages --repo <目录> --baseline <提交 sha> [--head <提交 sha>]'

/**
 * 与 scripts/acceptance.ps1 同一份禁词口径（那里用 [char] 码点拼，这里用码点数组，
 * 都是为了让闸门自己的源码不会命中自己 —— 因此任何文件都不需要开例外）。
 */
const BANNED = [
  [0x7ef4, 0x62a4, 0x8005],
  [0x672c, 0x673a],
  [0x5c5e, 0x4e3b],
  [0x8fd9, 0x53f0, 0x673a, 0x5668],
].map((codes) => String.fromCharCode(...codes))

function die(msg) {
  process.stderr.write('check-commit-messages: ' + msg + '\n')
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) die('不认识的参数：' + a + '\n' + USAGE)
    const key = a.slice(2)
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) die('参数 ' + a + ' 缺值\n' + USAGE)
    out[key] = val
    i += 1
  }
  return out
}

/**
 * 跑一条 git 子进程并把 stdout+stderr 收进内存。
 *
 * ★ 这里刻意**不用管道**：受管环境里「父进程用管道捕获子进程 stdio」会被拒（EPERM），
 *   所以走临时文件（与 tests/host-spawn.test.mjs 同一套办法）。spawn 本身失败也照样
 *   返回 code=null + error，让调用方按「拒绝」处理，绝不静默当成「没有命中」。
 */
function git(repo, args) {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-commit-gate-'))
  const log = join(dir, 'out.txt')
  const fd = openSync(log, 'w')
  let code = null
  let error = null
  try {
    const r = spawnSync('git', ['-C', repo, ...args], { stdio: ['ignore', fd, fd], timeout: 60000 })
    if (r.error) error = String(r.error)
    code = r.status
  } catch (e) {
    error = String(e && e.message ? e.message : e)
  } finally {
    closeSync(fd)
  }
  let text = ''
  try {
    text = readFileSync(log, 'utf8')
  } catch { /* 读不回就是空输出，交给 code 判 */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉不影响结论 */ }
  return { code, error, text }
}

function mustGit(repo, args, what) {
  const r = git(repo, args)
  if (r.error || r.code === null) die(what + '：git 执行失败（' + (r.error || '未知错误') + '）')
  return r
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo || process.cwd()
  const baseline = String(args.baseline || '').trim()
  if (!baseline) {
    die('缺少 --baseline：必须显式给出已公开基线，否则等于扫全历史（那条路已经废弃）\n' + USAGE)
  }
  const headRef = String(args.head || 'HEAD').trim()

  const base = mustGit(repo, ['rev-parse', '--verify', '--quiet', baseline + '^{commit}'], '基线不可解析')
  if (base.code !== 0) {
    die('基线提交不存在或不是提交对象：' + baseline + '（' + base.text.trim() + '）')
  }
  const baseSha = base.text.trim()

  const head = mustGit(repo, ['rev-parse', '--verify', '--quiet', headRef + '^{commit}'], 'HEAD 不可解析')
  if (head.code !== 0) {
    die('读不到 ' + headRef + ' 指向的提交（空仓库？）：' + head.text.trim())
  }
  const headSha = head.text.trim()

  // 基线必须是祖先：否则 baseline..HEAD 会包含一堆与基线无关的提交，检查口径失去意义。
  const anc = mustGit(repo, ['merge-base', '--is-ancestor', baseSha, headSha], '祖先判定失败')
  if (anc.code !== 0) {
    die('基线不是 ' + headRef + ' 的祖先：' + baseline + '（range 无效，拒绝放行）')
  }

  const range = baseSha + '..' + headSha
  const log = mustGit(repo, ['log', '--format=%H%x1f%B%x1e', range], 'git log 失败')
  if (log.code !== 0) die('git log 失败：' + range + '（' + log.text.trim() + '）')

  const hits = []
  let commits = 0
  for (const rec of log.text.split('\x1e')) {
    const body = rec.replace(/^\n+/, '')
    if (!body.trim()) continue
    const sep = body.indexOf('\x1f')
    if (sep < 0) continue
    const sha = body.slice(0, sep).trim()
    const message = body.slice(sep + 1)
    commits += 1
    for (const word of BANNED) {
      if (message.includes(word)) hits.push({ sha, word })
    }
  }

  if (hits.length) {
    process.stderr.write('check-commit-messages: 新增提交里有公开面禁词（' + range + '）\n')
    for (const h of hits) {
      process.stderr.write('  ' + h.sha.slice(0, 7) + ' 命中「' + h.word + '」\n')
    }
    process.stderr.write('改法：重写这条提交的信息（本地未推送前 amend 即可），不要删检查。\n')
    process.exit(1)
  }

  process.stdout.write('check-commit-messages: ' + range + ' 共 ' + commits + ' 条提交，未命中禁词\n')
}

main()
