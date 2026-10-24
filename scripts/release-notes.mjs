#!/usr/bin/env node
/**
 * 生成 GitHub Release 说明（零依赖 Node CLI）。
 *
 * 为什么要有它：旧实现是 workflow 里一串 echo，其中一行在**双引号**里写反引号 ——
 * bash 会先做命令替换，把 `dsh-rank-scan-x.y.z.tgz` 与安装命令整段吃掉。
 * 公开的 v0.2.4 Release 正文已经实证了这个后果（附件名和安装命令都不见了）。
 * 交给 Node 直接写文件，反引号就是字面字符，不经过任何 shell 解释。
 *
 * 顺带把「版本对不上」挡在**创建 Release 之前**：
 *   · tag 必须是 vX.Y.Z（或 X.Y.Z）；
 *   · tag 的版本必须与 package.json 的 version 完全一致；
 *   · CHANGELOG.md 必须有 `## [X.Y.Z]` 段，且段内不是空的。
 * 任何一条不满足 ⇒ 非零退出，且**不写输出文件**（发布链拿不到半份说明）。
 *
 * 用法：
 *   node scripts/release-notes.mjs --tag v0.3.0 [--package package.json] [--changelog CHANGELOG.md] [--out 文件]
 *   不给 --out 时打印到 stdout。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const USAGE = '用法：release-notes --tag v<X.Y.Z> [--package package.json] [--changelog CHANGELOG.md] [--out <文件>]'

function die(msg) {
  process.stderr.write('release-notes: ' + msg + '\n')
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

function readText(file, what) {
  try {
    return readFileSync(file, 'utf8')
  } catch (e) {
    die('读不到' + what + '：' + file + '（' + String(e && e.message ? e.message : e) + '）')
  }
  return ''
}

/** tag → 版本号（v0.3.0 与 0.3.0 都接受） */
function versionOfTag(tag) {
  const t = String(tag || '').trim()
  const m = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(t)
  if (!m) die('tag 不是 vX.Y.Z 形式：' + JSON.stringify(t))
  return m[1]
}

/** 取 `## [X.Y.Z]` 段正文（到下一个 `## ` 标题为止）；没有这段返回 null。 */
function extractSection(changelog, version) {
  const head = '## [' + version + ']'
  const lines = String(changelog).split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(head))
  if (start < 0) return null
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break
    body.push(lines[i])
  }
  return body.join('\n').trim()
}

/** 说明正文：本版 CHANGELOG 段 + 安装指引（反引号是字面字符）。 */
function buildNotes(version, section) {
  return [
    section,
    '',
    '### 安装',
    '',
    '```sh',
    'dsh plugin --profile desktop add github:kilo-s/dsh-rank-scan#v' + version,
    '```',
    '',
    '或从本页 Assets 下载 `dsh-rank-scan-' + version + '.tgz`，完全退出 DSH 后执行 '
      + '`dsh plugin --profile desktop add <tgz 路径>`。详见 README「安装 / 更新」。',
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.tag) die('缺少 --tag\n' + USAGE)
  const version = versionOfTag(args.tag)

  const pkgFile = args.package || 'package.json'
  let pkg
  try {
    pkg = JSON.parse(readText(pkgFile, '包清单'))
  } catch {
    die('包清单不是合法 JSON：' + pkgFile)
  }
  const pkgVersion = String((pkg && pkg.version) || '')
  if (pkgVersion !== version) {
    die('tag 版本与包版本不一致：tag=' + version + ' ' + pkgFile + '=' + (pkgVersion || '（缺失）')
      + '。先把 package.json 的 version 改成 ' + version + '，再打 tag。')
  }

  const changelogFile = args.changelog || 'CHANGELOG.md'
  const changelog = readText(changelogFile, '变更记录')
  const section = extractSection(changelog, version)
  if (section === null) {
    die('CHANGELOG 里没有 `## [' + version + ']` 这一段：' + changelogFile
      + '。Release 说明取自该段，缺了就只能发空说明。')
  }
  if (!section) {
    die('CHANGELOG 的 `## [' + version + ']` 段是空的：' + changelogFile + '。先写清这一版改了什么。')
  }

  const notes = buildNotes(version, section)
  if (args.out) {
    try {
      writeFileSync(args.out, notes, 'utf8')
    } catch (e) {
      die('写不出说明文件：' + args.out + '（' + String(e && e.message ? e.message : e) + '）')
    }
    process.stdout.write('release-notes: 已写出 ' + args.out + '（版本 ' + version + '）\n')
  } else {
    process.stdout.write(notes)
  }
}

main()
