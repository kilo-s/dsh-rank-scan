/**
 * 票 45②：spawn 安全（静态 + 行为）
 *
 * 来源：docs/rank-scan/需求确认-审计修复-v1.md §3.3 / adr/0004（插件任何代码路径不得让宿主进程退出）。
 * 事实：spawn 一个不存在的可执行文件时，失败是**异步 'error' 事件**；没有监听者时它升级成
 *       uncaughtException，而宿主 fail-loud 会 proc.exit(1) —— 用户整个 DSH 连会话一起死。
 *
 * 本文件是一支**常驻红线**：
 *   ① 静态：全仓每个 spawn( 调用点，同文件内必须有 .on('error', …) 监听；
 *   ② 行为：真起一个 node 子进程，让它 spawn 不存在的可执行文件 —— 不带监听必须死（探针自检），
 *      带监听必须存活并把后续日志打出来。
 *
 * ★ 沙箱注意：本机 DSH 沙箱下「父进程用管道捕获子进程 stdio」会 EPERM ⇒ 子进程 stdout/stderr
 *   一律**重定向到文件**（stdio: ['ignore', fd, fd]）再读回，不用 pipe。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, openSync, closeSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'tests/host-spawn.test.mjs'
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp-types', 'lib', 'dist', '.tmp'])
const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.ps1', '.sh'])
const SPAWN_CALL = /\bspawn\s*\(/g
const ERROR_LISTENER = /\.on\(\s*['"`]error['"`]/

function collectSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectSources(full, acc)
    else if (SOURCE_EXT.has(extname(name))) acc.push(full)
  }
  return acc
}
function isComment(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('#') || t.startsWith('/*')
}
function rel(p) {
  return relative(root, p).replace(/\\/g, '/')
}

test("静态：全仓每个 spawn( 调用点都挂了 .on('error')（没挂就是宿主退出的种子）", () => {
  const missing = []
  let callSites = 0
  for (const f of collectSources(root)) {
    if (rel(f) === SELF) continue // 本文件里的「反面样本」是字符串，不是调用点
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      SPAWN_CALL.lastIndex = 0
      if (!SPAWN_CALL.test(line)) return
      if (isComment(line)) return
      callSites++
      const window = lines.slice(i, i + 30).join('\n')
      if (!ERROR_LISTENER.test(window)) missing.push(rel(f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 100))
    })
  }
  assert.ok(callSites >= 1, '静态检查必须至少命中一个真实调用点，否则这条检查是空的')
  assert.deepEqual(missing, [], 'spawn 调用点缺 .on("error") 监听（同文件 30 行内找不到）：\n' + missing.join('\n'))
})

const work = join(root, 'tests', '.tmp-spawn-probe')

function runChild(tag, childCode) {
  mkdirSync(work, { recursive: true })
  const js = join(work, tag + '.cjs')
  const outPath = join(work, tag + '.out')
  const errPath = join(work, tag + '.err')
  writeFileSync(js, childCode, 'utf8')
  const fdOut = openSync(outPath, 'w')
  const fdErr = openSync(errPath, 'w')
  let status = null
  let spawnErr = null
  try {
    const r = spawnSync(process.execPath, [js], { stdio: ['ignore', fdOut, fdErr], timeout: 20000 })
    status = r.status
    spawnErr = r.error ? String(r.error.code || r.error.message) : null
  } catch (e) {
    spawnErr = String(e && e.message)
  } finally {
    closeSync(fdOut)
    closeSync(fdErr)
  }
  const out = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
  const err = existsSync(errPath) ? readFileSync(errPath, 'utf8') : ''
  return { status, spawnErr, out, err }
}

const BODY_TAIL = 'setTimeout(()=>{console.log("RSC-ALIVE");process.exit(0);},300);'
const CHILD_NO_LISTENER =
  'const {spawn}=require("node:child_process");' +
  'spawn("rsc-definitely-no-such-exe-42",[],{stdio:"ignore"});' +
  BODY_TAIL
const CHILD_WITH_LISTENER =
  'const {spawn}=require("node:child_process");' +
  'const c=spawn("rsc-definitely-no-such-exe-42",[],{stdio:"ignore"});' +
  'c.on("error",(e)=>{console.log("RSC-ERR "+String(e&&e.code));});' +
  BODY_TAIL

test("行为探针自检：spawn 不存在的可执行文件且无 error 监听 ⇒ 子进程必须死（否则这条探针是空的）", () => {
  const r = runChild('no-listener', CHILD_NO_LISTENER)
  assert.equal(r.spawnErr, null, '连 node 都没起来（spawnSync 自身失败）：' + r.spawnErr)
  assert.notEqual(r.status, 0, '没挂 error 监听居然还活着 —— 本探针失去意义')
  assert.match(r.err, /Unhandled 'error' event/, "stderr 应出现 Unhandled 'error' event，实际：" + r.err.slice(0, 200))
  assert.ok(!r.out.includes('RSC-ALIVE'), '进程不该还走到后续日志')
})

test("行为：挂了 .on('error') ⇒ 进程存活，并继续打印后续日志（adr/0004）", () => {
  const r = runChild('with-listener', CHILD_WITH_LISTENER)
  assert.equal(r.spawnErr, null, 'spawnSync 自身失败：' + r.spawnErr)
  assert.equal(r.status, 0, '挂了监听就该正常退出，实际 status=' + r.status + ' stderr=' + r.err.slice(0, 300))
  assert.match(r.out, /RSC-ERR ENOENT/, '应捕获到 ENOENT（宿主会看到的错误码），实际：' + JSON.stringify(r.out))
  assert.match(r.out, /RSC-ALIVE/, 'spawn 失败不能带走进程，后续日志必须照打')
  assert.ok(!/Unhandled 'error' event/.test(r.err), '挂了监听还出现 Unhandled error event：' + r.err.slice(0, 200))
})

test('清场：临时探针目录不留残留', () => {
  rmSync(work, { recursive: true, force: true })
  assert.equal(existsSync(work), false)
})
