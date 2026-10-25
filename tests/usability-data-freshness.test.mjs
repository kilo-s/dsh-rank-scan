import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 编译产物解析顺序：显式 RANK_SCAN_TEST_LIB → lib/（正常构建）→ .tmp-usability/lib（本地临时编译）。
// 三者都没有时**跳过**并说明原因：本包只改 src，不允许替使用者重建 lib/；
// 一旦构建过（CI 的 prepare / 本地 npm run build）这里就会真实执行断言。
const envLib = process.env.RANK_SCAN_TEST_LIB
const candidates = [
  envLib ? pathToFileURL(envLib.replace(/\\/g, '/') + '/').href : null,
  new URL('../lib/', import.meta.url).href,
  new URL('../.tmp-usability/lib/', import.meta.url).href,
].filter(Boolean)
const base = candidates.find((c) => existsSync(join(fileURLToPath(c), 'scan', 'daily.js')))
if (!base) {
  console.log('SKIP usability-data-*：找不到编译产物（先 npm run build，或设置 RANK_SCAN_TEST_LIB 指向临时编译目录）')
  process.exit(0)
}
const load = (p) => import(new URL(p, base).href)


const fresh = await load('scan/freshness.js')

const r = (n, extra) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null, extra: extra || {} })
const cur = [r(1), r(2), r(3)]
const prevSame = [r(1), r(2), r(3)]

test('节奏表：起点/番茄/首订=日更；菠萝包/刺猬猫周榜=周更；三江/首订(约)=期榜', () => {
  assert.equal(fresh.cadenceOfBoard('qidian.sign.cat12'), 'daily')
  assert.equal(fresh.cadenceOfBoard('fanqie.m.new.262'), 'daily')
  assert.equal(fresh.cadenceOfBoard('qidiantu.shouding'), 'daily')
  assert.equal(fresh.cadenceOfBoard('sfacg.vip.week'), 'weekly')
  assert.equal(fresh.cadenceOfBoard('ciweimao.no-vip-click.week'), 'weekly')
  assert.equal(fresh.cadenceOfBoard('qidiantu.sanjiang'), 'periodic')
  assert.equal(fresh.cadenceOfBoard('ciweimao.buy.latest'), 'periodic')
})

test('周榜同一周内容不变 = 正常（不判可疑、不触发兜底）', () => {
  const v = fresh.judgeFreshness({
    boardId: 'sfacg.vip.week', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows: cur, previousRows: prevSame,
  })
  assert.equal(v.verdict, 'ok')
  assert.equal(v.samePeriod, true)
  assert.match(String(v.reason), /同一期未变化/)
})

test('周榜跨周内容仍不变 = 可疑（站点确实没刷新）', () => {
  const v = fresh.judgeFreshness({
    boardId: 'sfacg.vip.week', date: '2026-10-25', prevDate: '2026-10-18',
    currentRows: cur, previousRows: prevSame,
  })
  assert.equal(v.verdict, 'suspected')
  assert.equal(v.samePeriod, false)
})

test('期榜按真实 issue：同一期不变=正常；换了期还全等=可疑', () => {
  const a = fresh.judgeFreshness({
    boardId: 'ciweimao.buy.latest', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows: [r(1, { issue: 478 })], previousRows: [r(1, { issue: 478 })],
    currentPeriodKey: '478', previousPeriodKey: '478',
  })
  assert.equal(a.verdict, 'ok')
  assert.equal(a.samePeriod, true)
  const b = fresh.judgeFreshness({
    boardId: 'ciweimao.buy.latest', date: '2026-10-24', prevDate: '2026-10-17',
    currentRows: [r(1)], previousRows: [r(1)],
    currentPeriodKey: '480', previousPeriodKey: '479',
  })
  assert.equal(b.verdict, 'suspected', '已经换期（期号不同）却逐条相同 ⇒ 判可疑')
})

test('日更榜逐条相同 = 可疑（站点还没换榜）', () => {
  const v = fresh.judgeFreshness({
    boardId: 'qidian.sign.cat12', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows: cur, previousRows: prevSame,
  })
  assert.equal(v.verdict, 'suspected')
})

test('日更榜只要细节数字变了就不算未刷新（签名纳入收藏/字数/评分）', () => {
  const prevRows = [r(1, { collect: 100 }), r(2), r(3)]
  const currentRows = [r(1, { collect: 101 }), r(2), r(3)]
  const v = fresh.judgeFreshness({
    boardId: 'qidian.sign.cat12', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows, previousRows: prevRows,
  })
  assert.equal(v.verdict, 'ok')
  assert.equal(v.identical, false)
})

test('名次榜 value=null 也不会退化成「只看书号」的假相同', () => {
  const prevRows = [{ ...r(1), rank: 1 }, { ...r(2), rank: 2 }]
  const currentRows = [{ ...r(1), rank: 2 }, { ...r(2), rank: 1 }]
  const v = fresh.judgeFreshness({
    boardId: 'qidian.sign.cat12', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows, previousRows: prevRows,
  })
  assert.equal(v.identical, false)
  assert.equal(v.verdict, 'ok')
})

test('没有基准（首次）不判可疑', () => {
  const v = fresh.judgeFreshness({ boardId: 'qidian.sign.cat12', date: '2026-10-22', prevDate: null, currentRows: cur, previousRows: null })
  assert.equal(v.verdict, 'ok')
  assert.equal(v.identical, false)
})

test('期键读取顺序：先 periodStart，再 issue', () => {
  assert.equal(fresh.periodKeyFromRows([r(1, { issue: 478 })]), '478')
  assert.equal(fresh.periodKeyFromRows([r(1, { periodStart: '2026-10-18', issue: 478 })]), '2026-10-18')
  assert.equal(fresh.periodKeyFromRows([r(1)]), null)
})

test('周键按本地自然日算（周日为一周起点）', () => {
  assert.equal(fresh.weekKeyOf('2026-10-22'), '2026-10-18')
  assert.equal(fresh.weekKeyOf('2026-10-18'), '2026-10-18')
  assert.equal(fresh.weekKeyOf('2026-10-25'), '2026-10-25')
})
test('★ 2026-10-25 换期 ≠ 换榜：同期整批换光才判换榜，跨期一律不判', () => {
  const rowsWith = (extra, keys) => keys.map((k, i) => ({ key: k, rank: i + 1, value: null, title: 'T' + k, author: null, url: null, extra }))
  // 同一期（issue 相同）里整批换光 ⇒ 仍是换榜/降级（站点降级页的特征）
  const same = fresh.judgeSwap({
    boardId: 'ciweimao.buy.latest', date: '2026-10-25', prevDate: '2026-10-24',
    currentRows: rowsWith({ issue: 479 }, ['1', '2', '3']),
    previousRows: rowsWith({ issue: 479 }, ['9', '8', '7']),
  })
  assert.equal(same.swapped, true, '同一期整批换光 ⇒ 判换榜')
  assert.equal(same.samePeriod, true)
  // 换期（479 → 480）整批换新 ⇒ 正常批次更替，**不许**判换榜（这正是 10-24 锁死的根因）
  const cross = fresh.judgeSwap({
    boardId: 'ciweimao.buy.latest', date: '2026-10-24', prevDate: '2026-10-23',
    currentRows: rowsWith({ issue: 479 }, ['1', '2', '3']),
    previousRows: rowsWith({ issue: 478 }, ['4', '5', '6']),
  })
  assert.equal(cross.swapped, false, '跨期换批不得判换榜')
  assert.equal(cross.samePeriod, false)
  assert.match(String(cross.reason), /跨期换批/)
  // 周榜没有行内期键 ⇒ 退回本地周键：同周可判、跨周不判
  const sameWeek = fresh.judgeSwap({
    boardId: 'ciweimao.no-vip-click.week', date: '2026-10-21', prevDate: '2026-10-20',
    currentRows: rowsWith({}, ['1', '2', '3']), previousRows: rowsWith({}, ['9', '8', '7']),
  })
  assert.equal(sameWeek.swapped, true, '同一周整榜换光 ⇒ 判换榜')
  const nextWeek = fresh.judgeSwap({
    boardId: 'ciweimao.no-vip-click.week', date: '2026-10-18', prevDate: '2026-10-17',
    currentRows: rowsWith({}, ['1', '2', '3']), previousRows: rowsWith({}, ['9', '8', '7']),
  })
  assert.equal(nextWeek.swapped, false, '跨周换榜是正常形态（周榜整期更替）')
  // 日更榜没有「期」的概念 ⇒ 保持原判据
  const daily = fresh.judgeSwap({
    boardId: 'qidian.sign.cat12', date: '2026-10-22', prevDate: '2026-10-21',
    currentRows: rowsWith({}, ['1', '2', '3']), previousRows: rowsWith({}, ['9', '8', '7']),
  })
  assert.equal(daily.swapped, true)
  // 期榜但两边都推不出期号 ⇒ 不下结论（宁可漏报，也不许再造成永久锁）
  const unknown = fresh.judgeSwap({
    boardId: 'ciweimao.buy.latest', date: '2026-10-25', prevDate: '2026-10-24',
    currentRows: rowsWith({}, ['1', '2', '3']), previousRows: rowsWith({}, ['9', '8', '7']),
  })
  assert.equal(unknown.swapped, false)
  assert.equal(unknown.samePeriod, null)
})
