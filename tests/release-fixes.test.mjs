/**
 * ★ 2026-10-17（发布前修）回归闸：四个修法各自钉一条结构断言 + 一条纯函数断言。
 *
 * 为什么用「读源码断言」而不是跑宿主：这几处都在 `src/index.ts` 的 apply 闭包里（宿主模块），
 * 没有可注入的缝；而这次踩的坑恰恰是「纯函数与调用方口径不一致」——
 * `isEnrichableBoard('qidiantu.*')` 说可补、`enrichMissingFields` 要求 wordsCnt，
 * 但真正干活的 `enrichBoard` 里没有 qidiantu 分支 ⇒ 面板永久显示「补全未完成」。
 * 所以这里一边钉纯函数的口径，一边钉「干活的通道确实接了这条前缀」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEnrichableBoard, missingEnrichFields } from '../lib/scan/view.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const CLIENT = readClientSource()

test('起点图（三江）在纯函数口径里是「可补全、缺字数字段」的榜', () => {
  assert.equal(isEnrichableBoard('qidiantu.sanjiang'), true, '三江必须被判为可补全（否则待办永远清不掉）')
  assert.deepEqual(missingEnrichFields('qidiantu.sanjiang', { key: '1', extra: {} }), ['words'])
  assert.deepEqual(missingEnrichFields('qidiantu.sanjiang', { key: '1', extra: { wordsCnt: 12 } }), [])
})

test('enrichBoard 真的接了 qidiantu 通道（不再落到「这个榜暂不支持补全」）', () => {
  assert.ok(
    HOST.includes("if (boardId.startsWith('qidian.') || boardId.startsWith('qidiantu.')) {"),
    'enrichBoard 的首个分支必须同时认 qidian. 与 qidiantu. —— 否则续跑/「补全本榜」对三江是 0 请求的假尝试',
  )
})

test('/qidianEnrich 批量补全带上起点图（面板「起点补全」按钮不再漏掉三江）', () => {
  assert.ok(
    HOST.includes("(stQ.boards as string[]).filter((b) => b.startsWith('qidian.') || b.startsWith('qidiantu.'))"),
    '批量补全的榜清单必须含 qidiantu. 前缀',
  )
})

test('概览派生榜状态由行为回归覆盖，且不计入隐藏数', () => {
  assert.ok(HOST.includes("const derived = boardId.startsWith('fanqie.derived.')"), '概览行必须识别派生榜')
  assert.ok(HOST.includes('hiddenCount: rows.filter((r) => !r.displayed && !r.derived).length,'), '派生榜不计入隐藏数')
})

test('请求间隔：启动优先认 state（面板改过的值不再被重启丢掉）', () => {
  const at = HOST.indexOf('const REQUEST_INTERVAL_MS = (() => {')
  assert.ok(at >= 0, '找不到 REQUEST_INTERVAL_MS')
  const block = HOST.slice(at, at + 900)
  assert.ok(block.includes('readState() as any).requestIntervalMs'), '启动必须读 state.requestIntervalMs')
  assert.ok(block.indexOf('stored') < block.indexOf('cfg.requestIntervalMs'), 'state 的值要优先于插件配置')
})

test('补全横幅口径：宿主现算「还能续跑」的待办数并暴露给面板', () => {
  assert.ok(HOST.includes('function retryablePendingCount(): number {'), '宿主缺 retryablePendingCount')
  assert.ok(HOST.includes('retryable: retryablePendingCount(),'), '/enrich-status 必须回 retryable')
  assert.ok(HOST.includes('requestIntervalMs: minRequestIntervalMs(),'), '/enrich-status 必须回当前请求间隔')
  assert.ok(HOST.includes('当日已试满，明天再续'), '工人收工时的 note 必须区分「还能续跑」与「已试满」')
})

test('面板文案不再写死「1 请求/秒 / 1s 限速」', () => {
  for (const stale of ['（1 请求/秒，抓榜数据已可用）', '补全在后台按 1 请求/秒逐个榜补', '逐本 1 请求 + 1s 限速', '逐本 1 请求、1s 限速', '1 请求 + 1s 限速']) {
    assert.ok(!CLIENT.includes(stale), '面板里还有写死的限速文案：' + stale)
  }
  assert.ok(CLIENT.includes('const fmtIntervalText = function (ms) {'), '面板缺 fmtIntervalText（文案要跟着生效值走）')
  assert.ok(CLIENT.includes('noteRequestInterval(sv.requestIntervalMs)'), '打开「抓什么」页时要把生效间隔记下来')
})

test('npm 取号脚本不能踩 PowerShell 逗号优先级（否则 token 变成第 4 个数组元素）', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'set-npm-token.ps1'), 'utf8')
  assert.ok(
    !script.includes(',"registry=https://registry.npmjs.org/","//registry.npmjs.org/:_authToken=" + $token'),
    '又写成 @(…,"…_authToken=" + $token) 了：逗号优先于 + ⇒ 落盘成「_authToken= 空值 + 裸 token」，npm 一律 ENEEDAUTH',
  )
  assert.ok(script.includes('$authLine = "//registry.npmjs.org/:_authToken=" + $token'), '缺「先拼行再入数组」的写法')
  assert.ok(script.includes('写出的 .npmrc 形状不对'), '缺写后自检（行数 + authToken 值核验）')
})

test('面板横幅用宿主的 retryable（第三态：当日已试满）', () => {
  assert.ok(CLIENT.includes('enrichStatus.retryable'), '横幅必须用 retryable 判「还能不能续跑」')
  assert.ok(CLIENT.includes('补全已尽力：'), '缺「已尽力」这一态')
})
