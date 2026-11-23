import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookmarkService, BookmarkStore } from '../lib/scan/bookmark.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-export-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new BookmarkStore(root)
  const service = new BookmarkService({ store, now: () => new Date('2026-11-19T11:00:00+08:00') })
  const seen = (boardId, rank = 7) => ({ boardId, rank, dataDate: '2026-11-18' })
  for (const [site, id, firstSeen] of [
    ['fanqie', '7688452081815929368', seen('fanqie.m.new.1141')],
    ['qidian', '11', seen('qidian.sign.cat12')],
    ['sfacg', '12', seen('sfacg.hot.week')],
    ['ciweimao', '13', seen('ciweimao.yp_new.week')],
    ['qidiantu', '14', seen('qidiantu.shouding')],
    ['qidian', '15', null],
  ]) {
    service.add({ bookKey: site + ':' + id, site, title: site + id, url: 'https://example.invalid/' + id, source: firstSeen ? 'board' : 'manual', firstSeen }, { note: '备注 {中文} \\ 路径\r\n第二行 😀\t#标签', folders: ['待读'] })
  }
  return { service, store, seen }
}
function plainDoc(content) {
  assert.ok(Buffer.isBuffer(content), 'DOC must be a binary payload')
  assert.equal(content.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', 'real OLE document header')
  return content.toString('utf16le')
}

test('site export groups sites in panel order and preserves order within each site', t => {
  const { service } = fixture(t)
  const bookKeys = ['fanqie:7688452081815929368', 'qidian:15', 'sfacg:12', 'qidian:11', 'qidiantu:14', 'ciweimao:13']
  const books = JSON.parse(service.exportData('json', { bookKeys, sort: 'site' }).content).bookmarks
  assert.deepEqual(books.map(b => b.bookKey), ['qidian:15', 'qidian:11', 'qidiantu:14', 'ciweimao:13', 'sfacg:12', 'fanqie:7688452081815929368'])
  assert.deepEqual(JSON.parse(service.exportData('json', { bookKeys }).content).bookmarks.map(b => b.bookKey), books.map(b => b.bookKey))
  const md = service.exportData('md', { bookKeys }).content
  assert.ok(md.indexOf('## 起点（') < md.indexOf('## 刺猬猫（'))
  assert.ok(md.indexOf('qidian15') < md.indexOf('qidian11'))
  const csv = service.exportData('csv', { bookKeys }).content
  assert.ok(csv.indexOf('qidian:15') < csv.indexOf('qidian:11'))
  const doc = plainDoc(service.exportData('doc', { bookKeys }).content)
  assert.ok(doc.indexOf('qidian15') < doc.indexOf('qidian11'))
  assert.ok(doc.indexOf('qidian11') < doc.indexOf('ciweimao13'))
})

test('current export honors caller order, filters keys, deduplicates and excludes trash', t => {
  const { service } = fixture(t)
  service.remove('sfacg:12')
  const bookKeys = ['fanqie:7688452081815929368', 'qidian:11', 'sfacg:12', 'missing:0', 'qidian:11']
  const data = service.exportData('json', { bookKeys, sort: 'current' })
  assert.equal(data.count, 2)
  assert.deepEqual(JSON.parse(data.content).bookmarks.map(b => b.bookKey), ['fanqie:7688452081815929368', 'qidian:11'])
  assert.equal(service.exportData('doc', { bookKeys, includeTrash: true }).count, 3)
  const repeated = ['qidian:11', 'fanqie:7688452081815929368', 'qidian:11']
  assert.deepEqual(JSON.parse(service.exportData('json', { bookKeys: repeated, sort: 'current' }).content).bookmarks.map(b => b.bookKey), repeated.slice(0, 2))
})

test('all formats name the original site and exact board without mutating stored bookmarks', t => {
  const { service, store, seen } = fixture(t)
  service.add({ bookKey: 'qidian:11' }, { seen: seen('qidiantu.sanjiang', 2) })
  const before = readFileSync(store.file, 'utf8')
  const md = service.exportData('md').content
  assert.match(md, /\*\*榜单\*\*：签约榜 × 轻小说（移动端口径） 第 7 名（2026-11-18）/)
  assert.match(md, /\*\*也上过\*\*：起点图 · 三江·推荐效果（周·收藏增量） 第 2 名（2026-11-18）/)
  assert.match(md, /男频新书榜 × 西方奇幻/)
  assert.match(md, /手动添加 · 无榜单来源/)
  assert.ok(!md.includes('夹：'), '文档导出不输出书签夹')
  assert.ok(!md.includes('qidian.sign.cat12'))
  assert.ok(!md.includes('\r'), 'Markdown normalizes Windows note line endings')
  const first = JSON.parse(service.exportData('json').content).bookmarks.find(b => b.bookKey === 'qidian:11').firstSeen
  assert.equal(first.boardId, 'qidian.sign.cat12')
  assert.equal(first.boardName, '签约榜 × 轻小说（移动端口径）')
  assert.equal(first.rank, 7)
  const csv = service.exportData('csv').content
  assert.match(csv, /首次发现站点,首次发现榜单,首次发现名次,首次发现数据日期/)
  assert.ok(csv.includes('起点,签约榜 × 轻小说（移动端口径）,7,2026-11-18'))
  const doc = plainDoc(service.exportData('doc').content)
  assert.ok(doc.includes('榜单：签约榜 × 轻小说（移动端口径） 第 7 名（2026-11-18）'))
  assert.ok(!doc.includes('夹：'), 'Word 导出也不输出书签夹')
  assert.ok(doc.includes('备注 {中文} \\ 路径\r第二行 😀\t#标签'))
  assert.equal(readFileSync(store.file, 'utf8'), before)
})

test('导出清洗：优先原官方榜单、去重同榜多日、去重双份在读、数字易扫读', t => {
  const { service } = fixture(t)
  service.add({
    bookKey: 'fanqie:9990001112223334445',
    site: 'fanqie',
    title: '番茄样书',
    author: '某作者',
    url: 'https://fanqienovel.com/page/9990001112223334445',
    words: 243147,
    collect: 292127,
    collectLabel: '在读',
    metric: { name: '在读', value: 310000 },
    source: 'board',
    firstSeen: { boardId: 'fanqie.derived.period', rank: 10, dataDate: '2026-11-18' },
    seenBoards: [
      { boardId: 'fanqie.derived.period', rank: 10, dataDate: '2026-11-18' },
      { boardId: 'fanqie.m.new.262', rank: 4, dataDate: '2026-11-18' },
      { boardId: 'fanqie.m.new.262', rank: 5, dataDate: '2026-11-19' },
      { boardId: 'fanqie.m.new.262', rank: 5, dataDate: '2026-11-20' },
    ],
    capturedAt: '2026-11-20T04:00:00Z',
  }, { note: '完整拆书笔记', folders: ['2026-11-20'] })

  const md = service.exportData('md', { bookKeys: ['fanqie:9990001112223334445'] }).content
  assert.match(md, /24\.3万字 · 在读 29\.2万/)
  assert.equal((md.match(/在读 /g) || []).length, 1, '不能出现双份在读')
  assert.match(md, /\*\*榜单\*\*：男频新书榜 × 都市脑洞 第 5 名（最高第 4 名，在榜 3 天，2026-11-18 ~ 11-20）/)
  assert.equal((md.match(/男频新书榜 × 都市脑洞/g) || []).length, 1, '同榜多日不能重复刷屏')
  assert.ok(!md.includes('本地派生'), '已有原官方榜时不混入派生榜')
  assert.ok(!md.includes('夹：'), '不输出书签夹')

  const csv = service.exportData('csv', { bookKeys: ['fanqie:9990001112223334445'] }).content
  assert.equal((csv.match(/男频新书榜 × 都市脑洞/g) || []).length, 1, 'CSV 也上过同样按 boardId 去重')
})

test('derived, third-party, unknown and absent ranks remain explicit', t => {
  const { service, seen } = fixture(t)
  for (const [id, boardId] of [['21', 'fanqie.derived.period'], ['22', 'ciweimao.buy.latest'], ['23', 'retired.board'], ['24', 'qidian.retired.cat12'], ['25', 'fanqie.retired.0.1141'], ['26', 'qidian.sign.cat-1']]) {
    service.add({ bookKey: 'qidian:' + id, site: 'qidian', title: id, source: 'board', firstSeen: seen(boardId, null) })
  }
  const md = service.exportData('md').content
  assert.match(md, /候选池内.*本地派生；非原站榜单/)
  assert.match(md, /第三方（newmmapi.yukirus.com）· 约值/)
  assert.match(md, /未知历史榜单（retired.board） 第 — 名/)
  assert.match(md, /未知历史榜单（qidian.retired.cat12）/)
  assert.match(md, /未知历史榜单（fanqie.retired.0.1141）/)
  assert.match(md, /未知历史榜单（qidian.sign.cat-1）/)
  assert.ok(!md.includes('收藏 0'))
  const csv = service.exportData('csv').content
  assert.match(csv, /本地派生；非原站榜单/)
  assert.match(csv, /第三方（newmmapi.yukirus.com）· 约值/)
  assert.match(csv, /未知历史榜单（retired.board）/)
})

test('a damaged discovery record does not prevent usable bookmarks from being exported', t => {
  const { service, store } = fixture(t)
  const data = JSON.parse(readFileSync(store.file, 'utf8'))
  data.bookmarks[0].firstSeen = { rank: 3, dataDate: '2026-11-18' }
  writeFileSync(store.file, JSON.stringify(data))
  for (const format of ['json', 'md', 'csv', 'doc']) {
    const exported = service.exportData(format)
    assert.equal(exported.count, 6)
    const text = format === 'doc' ? plainDoc(exported.content) : exported.content
    assert.ok(text.includes('未知历史榜单（缺少榜单标识）'))
    assert.ok(text.includes('qidian11'))
  }
})

test('导出接入本地详情缓存：MD 折叠简介、Word 浅灰简介段、CSV/JSON 扩展列与「信息→标签→简介→笔记→榜单」顺序', t => {
  const { service } = fixture(t)
  const detailLookup = (b) => b.bookKey === 'ciweimao:13' ? {
    status: '连载中',
    category: '玄幻奇幻',
    tags: ['男频', '签约', '多女主'],
    desc: '　　第一段原书简介。\r\n\r\n第二段原书简介。',
    honours: [{ rank: 3, label: '收藏月榜', sub: '玄幻奇幻第1名', source: 'daosearch' }],
    detailFetchedAt: '2026-11-22T04:00:00.000Z',
  } : null

  const mdOn = service.exportData('md', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: true }).content
  assert.ok(!mdOn.includes('\r'), 'MD 简介也要规范换行不含 CR')
  assert.match(mdOn, /\*\*信息\*\*：.*连载中 · 玄幻奇幻/)
  assert.match(mdOn, /\*\*标签\*\*：男频 \/ 签约 \/ 多女主/)
  assert.match(mdOn, /<details>\n<summary>作品简介<\/summary>\n\n第一段原书简介。\n\n第二段原书简介。\n\n<\/details>/)
  const iInfo = mdOn.indexOf('**信息**')
  const iTag = mdOn.indexOf('**标签**')
  const iDesc = mdOn.indexOf('<details>')
  const iNote = mdOn.indexOf('> 备注 {中文}')
  const iBoard = mdOn.indexOf('**榜单**')
  assert.ok(iInfo > 0 && iTag > iInfo && iDesc > iTag && iNote > iDesc && iBoard > iNote, 'MD 必须按 信息 → 标签 → 折叠简介 → 笔记 → 榜单 排序')

  const mdOff = service.exportData('md', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: false }).content
  assert.ok(!mdOff.includes('<details>') && !mdOff.includes('第一段原书简介'), '关闭附带简介时 MD 不输出简介')
  assert.match(mdOff, /\*\*标签\*\*：男频 \/ 签约 \/ 多女主/, '关闭简介仍保留状态、分类与站点标签')

  const docOn = plainDoc(service.exportData('doc', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: true }).content)
  assert.ok(docOn.includes('信息：') && docOn.includes('连载中 · 玄幻奇幻'))
  assert.ok(docOn.includes('标签：男频 / 签约 / 多女主'))
  assert.ok(docOn.includes('简介：第一段原书简介。\r第二段原书简介。'))
  const dInfo = docOn.indexOf('信息：')
  const dTag = docOn.indexOf('标签：')
  const dDesc = docOn.indexOf('简介：')
  const dNote = docOn.indexOf('备注 {中文}')
  const dBoard = docOn.indexOf('榜单：')
  assert.ok(dInfo > 0 && dTag > dInfo && dDesc > dTag && dNote > dDesc && dBoard > dNote, 'Word 必须按 信息 → 标签 → 简介 → 笔记 → 榜单 排序')

  const docOff = plainDoc(service.exportData('doc', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: false }).content)
  assert.ok(!docOff.includes('简介：') && !docOff.includes('第一段原书简介'), '关闭附带简介时 Word 不输出简介')

  const csvOn = service.exportData('csv', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: true }).content
  assert.match(csvOn, /,也上过,连载状态,作品分类,站点标签,作品简介\r\n/)
  assert.ok(csvOn.includes(',连载中,玄幻奇幻,男频 签约 多女主,"第一段原书简介。\n第二段原书简介。"'))

  const jsonOn = JSON.parse(service.exportData('json', { bookKeys: ['ciweimao:13'], detailLookup, includeDesc: true }).content)
  assert.equal(jsonOn.bookmarks[0].detail.status, '连载中')
  assert.equal(jsonOn.bookmarks[0].detail.category, '玄幻奇幻')
  assert.deepEqual(jsonOn.bookmarks[0].detail.tags, ['男频', '签约', '多女主'])
  assert.equal(jsonOn.bookmarks[0].detail.desc, '第一段原书简介。\n第二段原书简介。')
  assert.equal(jsonOn.bookmarks[0].detail.honours.length, 1)
})
