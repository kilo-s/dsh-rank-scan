import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeFanqieSite } from '../lib/sites/fanqie.js'

/**
 * ★ 2026-10-17（实测取证）：番茄 rank 接口**能吃大 limit**。
 * 实测同一分类：limit=10 × 3 次翻页（offset 0/10/20）取回 30 本，与 limit=30 一次请求的 30 本**书号完全一致**（首尾相同）；
 * limit=100 一次能取回 100 本。所以「每页 10 条 offset 步进 10」是纯浪费请求数：30 本要 3 次，1 次就够。
 * 这条钉住：默认实现**一次请求取满 depth**，且深度上限仍然生效（不能因为一次能取 100 就多写盘）。
 */
const page = (n) => pageBase(n, 1000)
const pageBase = (n, start) => ({ code: 0, data: { total_num: 100, book_list: Array.from({ length: n }, (_, i) => ({ bookId: String(start + i), bookName: '书' + i, author: '作者' + i, read_count: 100 + i, wordNumber: '200000' })) }, message: 'success' })
const mk = (calls) => makeFanqieSite({
  boards: ['fanqie.m.new.262'],
  depthOf: () => 30,
  fetchJson: async (url) => { calls.push(url); return page(100) },
})

test('★ 单请求取满：depth=30 ⇒ 只发 1 次请求（旧实现每页 10 条要 3 次）', async () => {
  const calls = []
  const r = await mk(calls).fetchBoard('fanqie.m.new.262', {})
  assert.equal(calls.length, 1, '只能发 1 次请求，实际 ' + calls.length)
  assert.ok(/limit=30(&|$)/.test(calls[0]), '请求应带 limit=30（不是 10）：' + calls[0])
  assert.ok(/offset=0(&|$)/.test(calls[0]), '单请求必须 offset=0：' + calls[0])
  assert.equal(r.rows.length, 30, '落盘条数仍受 depth=30 约束（不能因为接口能给 100 就写 100）')
  assert.equal(r.requests, 1)
})

test('★ 深度上限：depthOf 给 30 就只取 30（不会被 limit=100 顶大）', async () => {
  const calls = []
  const r = await mk(calls).fetchBoard('fanqie.m.new.262', {})
  assert.equal(r.rows.length, 30)
  assert.ok(!/limit=100/.test(calls[0]), '不该按接口上限 100 去要数据：' + calls[0])
})

test('★ 仍需分页时正确：显式 limit=10 时按 offset 步进 10 翻页并去重', async () => {
  const calls = []
  const site = makeFanqieSite({
    boards: ['fanqie.m.new.262'],
    limit: 10,
    depthOf: () => 20,
    // 第二页必须给**不同的书号**，否则会被去重掉、看起来像只有一页
    fetchJson: async (url) => { calls.push(url); const off = Number(/offset=(\d+)/.exec(url)[1]); return pageBase(10, 1000 + off) },
  })
  const r = await site.fetchBoard('fanqie.m.new.262', {})
  assert.equal(calls.length, 2, '20 条按每页 10 条要 2 次，实际 ' + calls.length)
  assert.deepEqual(r.rows.map((x) => x.key).slice(0, 2), ['1000', '1001'])
  assert.equal(r.rows.length, 20)
})