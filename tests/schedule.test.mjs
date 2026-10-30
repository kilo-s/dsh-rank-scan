import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueNow, hhmm, shouldFireTimer, validTime } from '../lib/scan/schedule.js'

const at = (s) => new Date(s)

test('dueNow：关闭 / 未到点 / 已扫过 都不跑', () => {
  assert.equal(dueNow(at('2026-10-14T01:31:00+08:00'), '01:30', false, false), false)
  assert.equal(dueNow(at('2026-10-14T01:29:00+08:00'), '01:30', true, false), false)
  assert.equal(dueNow(at('2026-10-14T02:00:00+08:00'), '01:30', true, true), false)
})

test('dueNow：到点跑；当天漏了（晚开机）也补跑一次', () => {
  assert.equal(dueNow(at('2026-10-14T01:30:00+08:00'), '01:30', true, false), true)
  assert.equal(dueNow(at('2026-10-14T09:20:00+08:00'), '01:30', true, false), true)
})

test('时间格式与 hhmm', () => {
  assert.equal(validTime('01:30'), true)
  assert.equal(validTime('24:00'), false)
  assert.equal(validTime('1:30'), false)
  assert.equal(hhmm(at('2026-10-14T09:05:00+08:00')), '09:05')
})

// ── shouldFireTimer：2026-10-15「重启即重扫」事故的回归测试 ──────────────────
// 事故根因：只看 dueNow（到点 + 当天没扫过）时，宿主每次重启都会重新判成「该扫」，
// 于是「重启 → 立刻补跑整站扫描 → 拖死宿主」循环。shouldFireTimer 必须靠**落盘的**
// lastTimerRun 让重启后的进程继续记得「今天已经扫过了」。
const T0 = Date.parse('2026-10-15T11:53:49+08:00')   // 宿主启动时刻
const base = {
  scanTime: '01:30',
  enabled: true,
  hasCompletedToday: false,
  lastTimerRun: null,
  startedAtMs: T0,
  freshMs: 5 * 60 * 1000,
}

test('shouldFireTimer：★ 重启不重扫（落盘的 lastTimerRun 跨进程有效）', () => {
  // 当天已由定时扫过并落盘 ⇒ 即便宿主反复重启、时间早过 01:30，也不许再扫
  const after = new Date('2026-10-15T12:30:00+08:00')
  assert.equal(shouldFireTimer({ ...base, now: after, lastTimerRun: '2026-10-15' }), false)
  // 只在内存里记得不够：没有落盘记录时，同样的时刻会判定要扫（这正是当时的坏行为）
  assert.equal(shouldFireTimer({ ...base, now: after, lastTimerRun: null }), true)
})

test('shouldFireTimer：★ 启动宽限期内不跑（宿主刚起来不抢资源）', () => {
  const soon = new Date(T0 + 60 * 1000)          // 启动后 1 分钟
  assert.equal(shouldFireTimer({ ...base, now: soon }), false)
  const later = new Date(T0 + 5 * 60 * 1000)     // 满 5 分钟
  assert.equal(shouldFireTimer({ ...base, now: later }), true)
})

test('shouldFireTimer：关闭 / 未到点 / 当天已扫完 都不跑', () => {
  const late = new Date('2026-10-15T09:00:00+08:00')
  // 开关关着 ⇒ 不跑（新安装默认就是这一态）
  assert.equal(shouldFireTimer({ ...base, now: late, enabled: false }), false)
  // 当天已经扫完 ⇒ 不跑
  assert.equal(shouldFireTimer({ ...base, now: late, hasCompletedToday: true }), false)
  // 还没到点 ⇒ 不跑（宽限期已过也一样）
  const early = new Date(T0 + 6 * 60 * 1000)          // 12:00，扫点是 23:30
  assert.equal(shouldFireTimer({ ...base, now: early, scanTime: '23:30' }), false)
  // 同一条：把扫点调回 01:30 就该跑，证明上面挡它的是「未到点」而不是别的条件
  assert.equal(shouldFireTimer({ ...base, now: early, scanTime: '01:30' }), true)
})

test('shouldFireTimer：第二天照常补跑（落盘只挡当天）', () => {
  const next = new Date('2026-10-16T11:00:00+08:00')
  assert.equal(shouldFireTimer({ ...base, now: next, lastTimerRun: '2026-10-15' }), true)
})


// ── 按站分时（2026-10-16）───────────────────────────────────────────────
test('planSiteRuns：按各站时刻依次跑；已跑过的站不再跑', async () => {
  const { planSiteRuns, DEFAULT_SITE_TIMES } = await import('../lib/scan/schedule.js')
  const boards = ['qidian.sign.cat4', 'sfacg.hot.week', 'fanqie.m.new.262', 'ciweimao.yp_new.week', 'qidiantu.sanjiang']
  const times = DEFAULT_SITE_TIMES
  // 凌晨 01:35：只有起点到点
  let p = planSiteRuns({ nowHM: '01:35', today: '2026-10-16', boards, siteTimes: times, siteLastRun: {}, fallbackTime: '22:30' })
  assert.deepEqual(p.due, ['qidian'])
  assert.deepEqual(p.waiting, ['sfacg', 'fanqie', 'ciweimao', 'qidiantu'])
  // 起点跑过之后（siteLastRun 记了今天），不再出现
  p = planSiteRuns({ nowHM: '01:35', today: '2026-10-16', boards, siteTimes: times, siteLastRun: { qidian: '2026-10-16' }, fallbackTime: '22:30' })
  assert.deepEqual(p.done, ['qidian'])
  assert.deepEqual(p.due, [])
  // 12:45：到点的按各自时刻升序（fanqie 08:30 → ciweimao 10:40；sfacg 14:30 与 qidiantu 21:30 都还没到）
  p = planSiteRuns({ nowHM: '12:45', today: '2026-10-16', boards, siteTimes: times, siteLastRun: { qidian: '2026-10-16' }, fallbackTime: '22:30' })
  assert.deepEqual(p.due, ['fanqie', 'ciweimao'])
  assert.deepEqual(p.waiting, ['sfacg', 'qidiantu'])
  // 21:35（2026-10-30 改点后）：菠萝包 14:30、起点图 21:30 都到点
  p = planSiteRuns({ nowHM: '21:35', today: '2026-10-16', boards, siteTimes: times, siteLastRun: { qidian: '2026-10-16', fanqie: '2026-10-16', ciweimao: '2026-10-16' }, fallbackTime: '22:30' })
  assert.deepEqual(p.due, ['sfacg', 'qidiantu'])
})

test('planSiteRuns：当天已有快照的站算「已跑」；到兜底点补跑漏掉的站', async () => {
  const { planSiteRuns } = await import('../lib/scan/schedule.js')
  const boards = ['qidian.sign.cat4', 'sfacg.hot.week']
  const times = { qidian: '01:30', sfacg: '02:30' }
  // 手动扫过了（ranToday）⇒ 两个站都不再定时跑
  let p = planSiteRuns({ nowHM: '10:00', today: '2026-10-16', boards, siteTimes: times, siteLastRun: {}, fallbackTime: '22:30', ranToday: ['qidian', 'sfacg'] })
  assert.deepEqual(p.due, [])
  assert.deepEqual(p.done.sort(), ['qidian', 'sfacg'])
  // 晚到 22:40 还没跑过的站 ⇒ 进兜底队列
  p = planSiteRuns({ nowHM: '22:40', today: '2026-10-16', boards, siteTimes: { qidian: '23:30', sfacg: '23:40' }, siteLastRun: {}, fallbackTime: '22:30' })
  assert.deepEqual(p.fallback, ['qidian', 'sfacg'])
})

test('planSiteRuns：★ 今天跑过但**失败**的站也要被兜底捡起来（2026-10-17 修「兜底没生效」）', async () => {
  const { planSiteRuns } = await import('../lib/scan/schedule.js')
  const boards = ['ciweimao.yp_new.week', 'qidian.sign.cat4']
  const times = { qidian: '01:30', ciweimao: '10:40' }
  const op = { today: '2026-10-16', boards, siteTimes: times, fallbackTime: '22:30' }
  // 22:00（未到兜底）：失败站暂时算「已跑」，不能每 30 秒重试
  let p = planSiteRuns({ ...op, nowHM: '22:00', siteLastRun: { ciweimao: '2026-10-16' }, ranToday: ['qidian', 'ciweimao'], failed: ['ciweimao'] })
  assert.ok(p.done.includes('ciweimao'), '未到兜底前不重试')
  assert.deepEqual(p.fallback, [])
  // 22:40：到兜底 ⇒ 进补跑队列（这正是以前永远走不到的分支）
  p = planSiteRuns({ ...op, nowHM: '22:40', siteLastRun: { ciweimao: '2026-10-16' }, ranToday: ['qidian', 'ciweimao'], failed: ['ciweimao'] })
  assert.deepEqual(p.fallback, ['ciweimao'], '跑失败的站要被兜底捡起来')
  // 补过一次 ⇒ 不再重复
  p = planSiteRuns({ ...op, nowHM: '22:50', siteLastRun: { ciweimao: '2026-10-16' }, ranToday: ['qidian', 'ciweimao'], failed: ['ciweimao'], retried: { ciweimao: '2026-10-16' } })
  assert.deepEqual(p.fallback, [], '每站每天最多补一次')
})

test('planSiteRuns：★ 疑似未刷新的站到兜底时刻重跑一次，且每站每天只重跑一次（2026-10-16 C）', async () => {
  const { planSiteRuns } = await import('../lib/scan/schedule.js')
  const boards = ['qidiantu.sanjiang', 'qidian.sign.cat4']
  const times = { qidian: '01:30', qidiantu: '12:40' }
  const op = { today: '2026-10-16', boards, siteTimes: times, fallbackTime: '22:30' }
  // 13:00：起点图今天抓过但疑似未刷新；还没到兜底 ⇒ 先算已跑
  let p = planSiteRuns({ ...op, nowHM: '13:00', siteLastRun: { qidiantu: '2026-10-16' }, ranToday: ['qidian', 'qidiantu'], stale: ['qidiantu'] })
  assert.ok(p.done.includes('qidiantu'), '还没到兜底时算已跑')
  assert.deepEqual(p.fallback, [])
  // 22:40：到兜底 ⇒ 进补跑队列
  p = planSiteRuns({ ...op, nowHM: '22:40', siteLastRun: { qidiantu: '2026-10-16' }, ranToday: ['qidian', 'qidiantu'], stale: ['qidiantu'] })
  assert.deepEqual(p.fallback, ['qidiantu'], '疑似未刷新的站要被兜底捡起来')
  // 重跑过（siteRetry 记了今天）⇒ 不再重复
  p = planSiteRuns({ ...op, nowHM: '22:40', siteLastRun: { qidiantu: '2026-10-16' }, ranToday: ['qidian', 'qidiantu'], stale: ['qidiantu'], retried: { qidiantu: '2026-10-16' } })
  assert.deepEqual(p.fallback, [], '每站每天最多补跑一次')
})
