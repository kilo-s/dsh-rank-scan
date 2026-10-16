/**
 * 书签（ticket 13/15/16/17/21）：解析纯函数 + 服务规则。
 * 全部离线：解析纯函数直接用；服务用临时目录里的真文件（与 scan.test.mjs 的 FileStore 用例同款）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bookKeyOf, displayLabel, extractTags, normalizeBookId, parseBookInput } from '../lib/scan/bookmark-parse.js'
import { BookmarkService, BookmarkStore, TRASH_KEEP_DAYS } from '../lib/scan/bookmark.js'

const mk = () => mkdtempSync(join(tmpdir(), 'rank-scan-bm-'))
function svcAt(root, nowIso = '2026-10-15T20:00:00+08:00') {
  let t = Date.parse(nowIso)
  const s = new BookmarkService({ store: new BookmarkStore(root), now: () => new Date(t) })
  return { s, tick: (ms) => { t += ms } }
}
const boardSeen = { boardId: 'qidiantu.shouding', rank: 3, dataDate: '2026-10-15' }

test('解析：五种写法都能认，且起点图书号归并到 qidian 命名空间', () => {
  assert.equal(parseBookInput('https://book.sfacg.com/Novel/783717/')?.bookKey, 'sfacg:783717')
  assert.equal(parseBookInput('https://www.qidian.com/book/1045548865/')?.bookKey, 'qidian:1045548865')
  assert.equal(parseBookInput('https://www.qidiantu.com/info/1045548865')?.bookKey, 'qidian:1045548865', '起点图书号与起点同源 ⇒ 必须归并')
  assert.equal(parseBookInput('https://www.ciweimao.com/book/100504426')?.bookKey, 'ciweimao:100504426')
  assert.equal(parseBookInput('fanqie:7685322774750956568')?.bookKey, 'fanqie:7685322774750956568')
  assert.equal(parseBookInput('https://fanqienovel.com/page/7685322774750956568')?.bookKey, 'fanqie:7685322774750956568')
  assert.equal(parseBookInput('1045548865', 'qidian')?.bookKey, 'qidian:1045548865')
  assert.equal(parseBookInput('1045548865'), null, '纯书号不给站 ⇒ 不猜，返回 null')
  assert.equal(parseBookInput('随便一段文字'), null)
  assert.equal(parseBookInput(''), null)
})

test('★ 番茄书号是 19 位十进制：必须按字符串，禁止 Number 化', () => {
  const id = '7685322774750956568'
  assert.equal(normalizeBookId(id), id, '不能走数值路径')
  assert.notEqual(String(Number(id)), id, '前提本身成立：Number 会丢精度')
  assert.equal(bookKeyOf('fanqie', id), 'fanqie:' + id)
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: bookKeyOf('fanqie', id), site: 'fanqie', url: 'x', source: 'manual' })
  assert.equal(s.all()[0].bookKey, 'fanqie:' + id, '落盘读回仍是原串')
})

test('备注里的 #标签 提取：去重、保序、上限 20', () => {
  assert.deepEqual(extractTags('好看 #待读 #爽文 #待读'), ['待读', '爽文'])
  assert.deepEqual(extractTags('没有标签'), [])
  assert.equal(extractTags(Array.from({ length: 30 }, (_, i) => '#' + i).join(' ')).length, 20)
})

test('add 幂等：同一 bookKey 打两次只出一条，且不覆盖已有备注', () => {
  const root = mk()
  const { s } = svcAt(root)
  const r1 = s.add({ bookKey: 'qidian:1', site: 'qidian', url: 'u1', title: '甲', source: 'board' }, { note: '我的备注' })
  const r2 = s.add({ bookKey: 'qidian:1', site: 'qidian', url: 'u1', title: '甲（改）', source: 'board' })
  assert.equal(r1.created, true)
  assert.equal(r2.created, false)
  assert.equal(s.all().length, 1)
  assert.equal(s.all()[0].note, '我的备注', '重复打签不得清掉用户备注')
})

test('★ 自动更新永不触碰用户内容（备注/夹）', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:2', site: 'qidian', url: 'u', source: 'board' }, { note: '别动我', folders: ['待读'] })
  s.autoUpdate('qidian:2', { title: '新书名', words: 123, valueFrom: 'snapshot' })
  const b = s.get('qidian:2')
  assert.equal(b.note, '别动我')
  assert.deepEqual(b.folders, ['待读'])
  assert.equal(b.title, '新书名')
  assert.equal(b.words, 123)
})

test('跨榜去重：同一本书在两个榜打签 ⇒ 一条 + seenBoards 记两个榜', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:9', site: 'qidian', url: 'u', source: 'board', firstSeen: { boardId: 'qidiantu.shouding', rank: 3, dataDate: '2026-10-15' } })
  s.autoUpdate('qidian:9', {}, { boardId: 'qidiantu.sanjiang', rank: 1, dataDate: '2026-10-15' })
  s.autoUpdate('qidian:9', {}, { boardId: 'qidiantu.sanjiang', rank: 1, dataDate: '2026-10-15' })
  const b = s.get('qidian:9')
  assert.equal(s.all().length, 1)
  assert.equal(b.firstSeen.boardId, 'qidiantu.shouding', 'firstSeen 保持第一次')
  assert.equal(b.seenBoards.length, 2, '重复的同一榜同一天不重复追加')
})

test('★ 回归：重复 add（幂等分支）也必须追加 seenBoards —— 实测踩到过只记第一个榜', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:42', site: 'qidian', url: 'u', source: 'board' }, { seen: { boardId: 'qidiantu.shouding', rank: 1, dataDate: '2026-10-15' } })
  s.add({ bookKey: 'qidian:42', site: 'qidian', url: 'u', source: 'board' }, { seen: { boardId: 'qidiantu.sanjiang', rank: 4, dataDate: '2026-10-15' } })
  const b = s.get('qidian:42')
  assert.equal(s.all().length, 1)
  assert.deepEqual(b.seenBoards.map((x) => x.boardId), ['qidiantu.shouding', 'qidiantu.sanjiang'], '两个榜都要记上')
  assert.equal(b.firstSeen.boardId, 'qidiantu.shouding', '首次发现保持最早那次')
})

test('★ 软删除：删了不是物理删，回收站可见且能直接找回', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:3', site: 'qidian', url: 'u', source: 'board' }, { note: '旧备注', folders: ['A'] })
  assert.equal(s.remove('qidian:3'), true)
  assert.equal(s.all().length, 0, '主列表看不到')
  assert.equal(s.trash().length, 1, '回收站看得到')
  const raw = JSON.parse(readFileSync(join(root, 'state', 'bookmarks.json'), 'utf8'))
  assert.ok(raw.bookmarks[0].deletedAt, '文件里仍是软删除（不是硬删）')
  // 回收站里直接找回：备注与夹完整回来
  const r = s.restore('qidian:3')
  assert.equal(r.restored, true)
  assert.equal(r.merged, false, '没有现行条目 ⇒ 纯恢复')
  assert.equal(s.all().length, 1)
  assert.equal(s.trash().length, 0)
  assert.equal(s.all()[0].note, '旧备注')
  assert.deepEqual(s.all()[0].folders, ['A'])
})

test('★ 恢复与现行条目合并：不出现两条；两边备注与夹并起来', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:13', site: 'qidian', url: 'u', source: 'board' }, { note: '回收站那份的备注', folders: ['A'] })
  // 造出「回收站一份 + 现行一份」并存的局面（历史遗留/手工编辑 config 都可能成这样）
  const raw = JSON.parse(readFileSync(join(root, 'state', 'bookmarks.json'), 'utf8'))
  const dead = { ...raw.bookmarks[0], note: '回收站那份的备注', folders: ['A'], deletedAt: '2026-10-14T10:00:00+08:00', createdAt: '2026-10-01T10:00:00+08:00' }
  const live = { ...raw.bookmarks[0], note: '现行那份的备注', folders: ['B'], createdAt: '2026-10-10T10:00:00+08:00' }
  delete live.deletedAt
  writeFileSync(join(root, 'state', 'bookmarks.json'), JSON.stringify({ bookmarksVersion: 1, bookmarks: [dead, live], savedAt: 'x' }), 'utf8')
  const r = s.restore('qidian:13')
  assert.equal(r.restored, true)
  assert.equal(r.merged, true)
  assert.equal(s.all().length, 1, '合并后只有一条')
  assert.equal(s.trash().length, 0)
  const b = s.all()[0]
  assert.equal(b.note, '现行那份的备注', '现行备注优先')
  assert.deepEqual(b.folders.slice().sort(), ['A', 'B'], '两边的夹都要在')
  assert.equal(b.createdAt, '2026-10-01T10:00:00+08:00', '取更早的 createdAt')
})

test('对不存在的书签 restore ⇒ 明确返回 not-found，不静默造一条', () => {
  const root = mk()
  const { s } = svcAt(root)
  const r = s.restore('qidian:999')
  assert.equal(r.restored, false)
  assert.equal(s.all().length, 0)
})

test('★ 回收站 30 天清理：到期物理清除（注入时钟，不用 sleep）', () => {
  const root = mk()
  const { s, tick } = svcAt(root)
  s.add({ bookKey: 'qidian:4', site: 'qidian', url: 'u', source: 'board' })
  s.remove('qidian:4')
  assert.equal(s.trash()[0].daysLeft, TRASH_KEEP_DAYS)
  tick((TRASH_KEEP_DAYS - 1) * 86400000)
  assert.equal(s.pruneTrash(), 0, '还没到期不清')
  assert.equal(s.trash().length, 1)
  tick(2 * 86400000)
  assert.equal(s.pruneTrash(), 1, '到期后物理清除')
  assert.equal(s.trash().length, 0)
  assert.equal(s.all().length, 0)
})

test('★ stale 标记：超过 7 天没变新才告警；手动添加且没数据的不算（标待补已够）', () => {
  const root = mk()
  const { s, tick } = svcAt(root)
  s.add({ bookKey: 'qidian:21', site: 'qidian', url: 'u', source: 'board', capturedAt: '2026-10-15T12:00:00+08:00', valueFrom: 'snapshot' })
  const fresh = s.all()[0]
  assert.equal(fresh.stale, false, '当天数据不算陈旧')
  tick(6 * 86400000)
  assert.equal(s.all()[0].stale, false, '6 天不算（阈值是 7）')
  tick(2 * 86400000)
  const old = s.all()[0]
  assert.equal(old.ageDays, 8)
  assert.equal(old.stale, true, '8 天没变新 ⇒ 面板要标「可能已无法更新」')
  // 手动添加且取不到书页：不该报陈旧（它本来就没数据，卡片已经标「待补」）
  s.add({ bookKey: 'sfacg:999999', site: 'sfacg', url: 'u', source: 'manual', valueFrom: 'manual', capturedAt: '2026-10-15T12:00:00+08:00' })
  const man = s.all().find((b) => b.bookKey === 'sfacg:999999')
  assert.equal(man.ageDays, 8)
  assert.equal(man.stale, false)
})

test('sync 精简 map：只含未删除条目，带 hasNote/folders/updatedAt', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:5', site: 'qidian', url: 'u', source: 'board' }, { note: '有备注', folders: ['F'] })
  s.add({ bookKey: 'qidian:6', site: 'qidian', url: 'u', source: 'board' })
  s.remove('qidian:6')
  const y = s.sync()
  assert.equal(y.total, 1)
  assert.deepEqual(Object.keys(y.map), ['qidian:5'])
  assert.equal(y.map['qidian:5'].hasNote, true)
  assert.deepEqual(y.map['qidian:5'].folders, ['F'])
})

test('★ 文件损坏：不崩、可读错误、能从轮转备份恢复', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:7', site: 'qidian', url: 'u', source: 'board' }, { note: '第一版' })
  s.add({ bookKey: 'qidian:8', site: 'qidian', url: 'u', source: 'board' }, { note: '第二版' })
  assert.ok(existsSync(join(root, 'state', 'bookmarks.json.1')), '写第二次时应留下 .1 备份')
  writeFileSync(join(root, 'state', 'bookmarks.json'), '{ 这不是 JSON', 'utf8')
  const s2 = new BookmarkService({ store: new BookmarkStore(root), now: () => new Date('2026-10-15T20:00:00+08:00') })
  const list = s2.all()
  assert.ok(Array.isArray(list), '损坏时不崩，仍返回数组')
  assert.ok(s2.health().error, '要把「坏了/已恢复」这件事报出来')
  assert.ok(list.length >= 1, '从 .1 备份里恢复出内容')
})

test('★ 票 28：主文件**缺失**（不是损坏）也要从 .1 恢复 —— 不再静默空表', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:9', site: 'qidian', url: 'u', source: 'board' }, { note: '第一版' })
  s.add({ bookKey: 'qidian:10', site: 'qidian', url: 'u', source: 'board' }, { note: '第二版' })
  assert.ok(existsSync(join(root, 'state', 'bookmarks.json.1')), '前提：第二次写盘应留下 .1 备份')
  rmSync(join(root, 'state', 'bookmarks.json')) // 模拟「写盘崩在中间 ⇒ 主文件不见了」
  const s2 = new BookmarkService({ store: new BookmarkStore(root), now: () => new Date('2026-10-15T20:00:00+08:00') })
  const list = s2.all()
  assert.ok(list.length >= 1, '必须从备份恢复，而不是返回空表')
  assert.ok(s2.health().recoveredFrom, '要把恢复来源报出来（面板据此标「已从备份恢复」）')
  assert.match(String(s2.health().error), /主文件缺失/, '文案要说清是「缺失」而不是「损坏」')
})

test('★ 票 28：覆盖写不留 .tmp 残留，内容为最后一次写入', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:12', site: 'qidian', url: 'u', source: 'board' }, { note: 'A' })
  s.add({ bookKey: 'qidian:12', site: 'qidian', url: 'u', source: 'board' }, { note: 'A' })
  assert.ok(!existsSync(join(root, 'state', 'bookmarks.json.tmp')), '写完不该留 .tmp')
  const raw = JSON.parse(readFileSync(join(root, 'state', 'bookmarks.json'), 'utf8'))
  assert.equal(raw.bookmarks.length, 1)
  assert.equal(raw.bookmarks[0].note, 'A', '重复打签不得清掉备注')
})

test('导出：JSON 与 Markdown 都含四类字段，且不含回收站', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:11', site: 'qidian', url: 'https://www.qidian.com/book/11/', title: '留着', author: '作者甲', words: 123456, source: 'board', firstSeen: boardSeen }, { note: '好看 #待读', folders: ['待读'] })
  s.add({ bookKey: 'qidian:12', site: 'qidian', url: 'u', title: '被删的', source: 'board' })
  s.remove('qidian:12')
  const j = JSON.parse(s.exportData('json').content)
  assert.equal(j.bookmarks.length, 1, '回收站不进导出')
  assert.equal(j.bookmarks[0].note, '好看 #待读')
  assert.equal(j.bookmarks[0].firstSeen.boardId, 'qidiantu.shouding')
  const md = s.exportData('md').content
  assert.ok(md.includes('留着'))
  assert.ok(md.includes('待读'))
  assert.ok(!md.includes('被删的'), 'md 也不含回收站')
})

test('手动添加：取不到页面时用备注兜底显示，且标 manual（机会式不生效由 service 保证）', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'sfacg:783717', site: 'sfacg', url: 'https://book.sfacg.com/Novel/783717/', source: 'manual', input: 'https://book.sfacg.com/Novel/783717/', title: null }, { note: '从别处看到的' })
  const b = s.all()[0]
  assert.equal(b.title, null)
  assert.equal(displayLabel(b), 'https://book.sfacg.com/Novel/783717/', '无书名时用原始输入兜底，而不是显示赤裸书号')
  assert.equal(b.source, 'manual')
})
test('导出（2026-10-16 需求）：可只导选择集、可导 csv、可选含回收站', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'qidian:21', site: 'qidian', url: 'u1', title: '甲书', author: '作者甲', words: 111111, source: 'board', firstSeen: boardSeen })
  s.add({ bookKey: 'sfacg:22', site: 'sfacg', url: 'u2,含逗号', title: '乙书', source: 'board', firstSeen: boardSeen })
  s.add({ bookKey: 'ciweimao:23', site: 'ciweimao', url: 'u3', title: '丙书', source: 'board', firstSeen: boardSeen })
  s.remove('ciweimao:23')

  // ① 选择集：只导两条里的一条
  const one = JSON.parse(s.exportData('json', { bookKeys: ['qidian:21'] }).content)
  assert.equal(one.bookmarks.length, 1, '按 bookKeys 过滤')
  assert.equal(one.bookmarks[0].title, '甲书')

  // ② csv：表头 + 转义（含逗号的 URL 必须被引号包起来）
  const csv = s.exportData('csv').content
  assert.match(csv.split('\r\n')[0], /^bookKey,site,书名,作者,字数/)
  assert.equal(csv.split('\r\n')[0].split(',').length, 12, '12 列')
  assert.ok(csv.includes('"u2,含逗号"'), '含逗号的值要按 RFC4180 转义')
  assert.ok(!csv.includes('丙书'), '回收站不进导出')

  // ③ 含回收站：显式要求时才带上
  const withTrash = s.exportData('csv', { includeTrash: true }).content
  assert.ok(withTrash.includes('丙书'), 'includeTrash=true 才带回收站')

  // ④ md 里也标明不含回收站
  assert.ok(s.exportData('md').content.includes('不含回收站'))
})

test('口径纠正（2026-10-16）：番茄旧数据里的 collectLabel「追读」显示为「在读」', () => {
  const root = mk()
  const { s } = svcAt(root)
  s.add({ bookKey: 'fanqie:99', site: 'fanqie', url: 'u', title: '番茄书', source: 'board', firstSeen: boardSeen })
  // 模拟旧版本落盘的错标签
  const f = join(root, 'state', 'bookmarks.json')
  const raw = JSON.parse(readFileSync(f, 'utf8'))
  raw.bookmarks[0].collectLabel = '追读'
  writeFileSync(f, JSON.stringify(raw), 'utf8')
  const v = s.all().find((x) => x.bookKey === 'fanqie:99')
  assert.equal(v.collectLabel, '在读', '旧标签要就地纠正')
})
