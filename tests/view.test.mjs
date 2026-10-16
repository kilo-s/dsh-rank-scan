import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyColumnPolicy, boardMeta, columnsFor, compareDesc, defaultSortFor, fanqieCatName, hideColumnsFor, shouldShowDays, usesRankDelta, withFanqieCat, groupChanges, groupBySite } from '../lib/scan/view.js'

test('列随榜：起点签约榜（已限定分类）不出现分类列，但有子分类与字数', () => {
  const m = boardMeta('qidian.sign.cat12')
  const keys = columnsFor(m).map((c) => c.key)
  assert.ok(keys.includes('subCat'))
  assert.ok(keys.includes('words'))
  assert.ok(!keys.includes('cat'), '榜已限定分类 ⇒ 分类列不出现')
  assert.ok(keys.includes('collect'), '收藏列在（值要靠 enrich，没补则该格「—」）')
  assert.ok(!keys.includes('days'), '没有历史（无精简索引）时「在榜天数」不占列')
  assert.equal(m.categoryScoped, true)
})

test('列随榜：有历史时才出现「在榜天数」', () => {
  const keys = columnsFor(boardMeta('qidian.sign.cat12'), { hasBaseline: true, hasHistory: true }).map((c) => c.key)
  assert.ok(keys.includes('days'))
  const noBase = columnsFor(boardMeta('fanqie.m.new.1141'), { hasBaseline: false, hasHistory: true }).map((c) => c.key)
  assert.ok(!noBase.includes('readDelta'), '无基准 ⇒ 不出现「在读变化」列')
})

test('列随榜：番茄新书榜有字数/在读/在读变化；站方升降与更新时间已按属主去掉了', () => {
  const keys = columnsFor(boardMeta('fanqie.m.new.1141'), { hasBaseline: true, hasHistory: true }).map((c) => c.key)
  assert.ok(keys.includes('read'))
  assert.ok(keys.includes('words'))
  assert.ok(keys.includes('readDelta'), '有基准时才有「在读变化」列')
  assert.ok(!keys.includes('siteDelta'), '站方升降（rankPosDiff）属主已删')
  assert.ok(!keys.includes('updated'), '更新时间属主已删')
  assert.ok(!keys.includes('collect'), '番茄没有收藏 ⇒ 整列不出现')
  assert.ok(!keys.includes('cat'), '番茄分类榜已限定分类')
})

test('列随榜：起点图首订有收藏/字数/粉丝；三江有期初收藏与每日增量', () => {
  const sd = columnsFor(boardMeta('qidiantu.shouding')).map((c) => c.key)
  assert.ok(sd.includes('value'), '首订榜必须显示主指标「首订」列')
  assert.ok(sd.includes('collect') && sd.includes('words') && sd.includes('fans'))
  const sj = columnsFor(boardMeta('qidiantu.sanjiang')).map((c) => c.key)
  assert.ok(sj.includes('collectBase') && sj.includes('dailyDelta'))
  // ★ 每日增量拆成 7 列（2026-10-15 属主反馈：7 天的值挤一格读不出来）
  for (let d = 0; d < 7; d++) assert.ok(sj.includes('daily' + d), '第' + (d + 1) + '天要有独立列')
  assert.ok(!sj.includes('daily'), '旧的「每日增量」聚合列要删掉，避免和 7 个分列重复')
  assert.ok(!sj.includes('settledDays'), '三江的「已结算天数」列已去掉（属主 2026-10-15）')
  assert.ok(!sj.includes('rank'), '三江去掉「名次」列（它不是名次榜）')
  assert.ok(sj.includes('cat'), '三江榜不限分类 ⇒ 分类列在')
})

test('列随榜：刺猬猫带收藏/字数（榜单页无值，靠书页补全）；菠萝包多评分/字数/收藏（前两名才有值）', () => {
  const cw = columnsFor(boardMeta('ciweimao.no-vip-click.week')).map((c) => c.key)
  // 榜单页本身没有数值字段 ⇒ 收藏/字数列留给「补全本榜」填（无历史 ⇒ 无在榜天数列）
  // 列顺序统一（2026-10-15 属主）：全站「字数 → 收藏」
  assert.deepEqual(cw, ['rank', 'delta', 'title', 'author', 'words', 'collect'], '刺猬猫核心列 + 字数/收藏（字数在前）')
  const sc = columnsFor(boardMeta('sfacg.new.click')).map((c) => c.key)
  assert.ok(sc.includes('score') && sc.includes('words') && sc.includes('collect'))
  // 2026-10-15 属主：首页榜没有作者，但书页 <title> 里有 ⇒ 补全后能填上，列要给
  assert.ok(sc.includes('author'), '菠萝包也要「作者」列（值靠书页补全）')
})

test('★ 列序守卫：起点图两榜的「字数」必须紧跟「分类」（属主 2026-10-15）', () => {
  for (const id of ['qidiantu.shouding', 'qidiantu.sanjiang']) {
    // 面板看到的是过完口径过滤的列集合（「在榜天数」就是被 applyColumnPolicy 干掉的）
    const keys = applyColumnPolicy(columnsFor(boardMeta(id), { hasBaseline: true, hasHistory: true }), id).map((c) => c.key)
    const ci = keys.indexOf('cat')
    const wi = keys.indexOf('words')
    assert.ok(ci >= 0 && wi >= 0, id + ' 应有 分类 与 字数 列')
    assert.equal(wi, ci + 1, id + ' 的「字数」必须紧跟「分类」⇒ 实际 ' + keys.join(','))
    // 站方指标/每日列一律排在 字数 之后（别再把作品属性挤到队尾）
    for (const k of ['value', 'collect', 'ratio', 'fans', 'collectBase', 'dailyDelta', 'periodTotal']) {
      if (keys.indexOf(k) >= 0) assert.ok(keys.indexOf(k) > wi, id + ' 的 ' + k + ' 应在「字数」之后')
    }
    // 「在榜天数」由 shouldShowDays 控制（面板传的 hasHistory 就是它算出来的）⇒ 起点图恒 false
    assert.equal(shouldShowDays('qidiantu', 5), false, '起点图整站不出「在榜天数」')
    const noHist = columnsFor(boardMeta(id), { hasBaseline: true, hasHistory: false }).map((c) => c.key)
    assert.ok(!noHist.includes('days'), id + ' 不该有「在榜天数」列')
  }
})

test('★ 列序守卫：全站「字数」都排在「收藏」之前（统一口径）', () => {
  for (const id of ['qidian.sign.cat12', 'ciweimao.no-vip-click.week', 'ciweimao.buy.latest', 'sfacg.new.click', 'qidiantu.shouding']) {
    const keys = columnsFor(boardMeta(id), { hasBaseline: true, hasHistory: true }).map((c) => c.key)
    const wi = keys.indexOf('words')
    const ci = keys.indexOf('collect')
    if (wi >= 0 && ci >= 0) assert.ok(wi < ci, id + ' 的「字数」应在「收藏」之前 ⇒ 实际 ' + keys.join(','))
  }
})

test('列随榜：刺猬猫「首订（约）」= 第三方约值 + 书页补的字数/收藏（2026-10-15 属主）', () => {
  const keys = columnsFor(boardMeta('ciweimao.buy.latest')).map((c) => c.key)
  assert.deepEqual(keys, ['rank', 'delta', 'title', 'author', 'buyNumRaw', 'words', 'collect'], '首订（原始）+ 字数/收藏')
  // 该榜是第三方约值榜：不出「在榜天数」
  const pol = applyColumnPolicy(columnsFor(boardMeta('ciweimao.buy.latest'), { hasBaseline: true, hasHistory: true }), 'ciweimao.buy.latest').map((c) => c.key)
  assert.ok(!pol.includes('days'), '第三方约值榜不显示在榜天数')
  assert.ok(pol.includes('words') && pol.includes('collect'), '补全后字数/收藏列要保留')
})

test('列随榜：起点图首订榜带收订比列', () => {
  assert.ok(columnsFor(boardMeta('qidiantu.shouding')).map((c) => c.key).includes('ratio'))
})

test('番茄派生榜与首订(约)：口径与来源要标出来', () => {
  const dv = boardMeta('fanqie.derived.period')
  assert.equal(dv.extended, true)
  assert.ok(String(dv.caliber).includes('本地派生'))
  const buy = boardMeta('ciweimao.buy.latest')
  assert.equal(buy.metric, 'value')
  assert.ok(String(buy.source).includes('第三方'))
  const san = boardMeta('qidiantu.sanjiang')
  assert.equal(san.extended, true)
})

test('变化分组：按站编组、固定四组顺序、空组不出现', () => {
  const entries = [
    { site: 'qidian', siteName: '起点', boardId: 'qidian.sign.cat12', boardName: '签约榜', group: '下降', title: '丙', delta: '↓2', days: 3 },
    { site: 'qidian', siteName: '起点', boardId: 'qidian.sign.cat12', boardName: '签约榜', group: '新入榜', title: '甲', delta: '第4名', days: 1 },
    { site: 'fanqie', siteName: '番茄', boardId: 'fanqie.m.new.1141', boardName: '新书榜', group: '上升', title: '乙', delta: '+300', days: 2 },
  ]
  const g = groupChanges(entries)
  assert.deepEqual(g.map((x) => x.site), ['qidian', 'fanqie'], '按站编组')
  assert.deepEqual(g[0].groups.map((x) => x.group), ['新入榜', '下降'], '固定顺序且空组不出现')
  assert.equal(g[1].groups[0].items[0].title, '乙')
})

test('概览按站编组：站内榜数正确', () => {
  const rows = [
    { boardId: 'qidian.sign.cat12', status: 'ok' },
    { boardId: 'qidiantu.shouding', status: 'ok' },
    { boardId: 'qidiantu.sanjiang', status: 'stale' },
    { boardId: 'fanqie.m.new.1141', status: 'ok' },
  ]
  const sites = groupBySite(rows)
  const qd = sites.find((s) => s.site === 'qidiantu')
  assert.equal(qd.count, 2)
  assert.deepEqual(qd.statuses, ['ok', 'stale'])
})

test('★ 「在榜天数」口径：起点图强制不出，其余站按该榜有无更早数据日', () => {
  // 起点图 = 第三方聚合源，跨天连续在榜无意义 ⇒ 永不出列（即便有更早数据日）
  assert.equal(shouldShowDays('qidiantu', 5), false)
  assert.equal(shouldShowDays('qidiantu', 0), false)
  // 真实榜单：**有任何本地数据就出**（1 天也出，新书当天显示 1 天）
  assert.equal(shouldShowDays('qidian', 3), true)
  assert.equal(shouldShowDays('ciweimao', 1), true)
  assert.equal(shouldShowDays('sfacg', 2), true)
  assert.equal(shouldShowDays('fanqie', 1), true)
  assert.equal(shouldShowDays('qidian', 1), true, '只有当天一份快照也要出列（否则分类之间看起来不一致）')
  // 完全没有数据才不出
  assert.equal(shouldShowDays('fanqie', 0), false)
})


test('★ 列口径（属主 2026-10-15 逐条）：起点图不出名次变化、三江不出重复 daily、刺猬猫首订不出在榜天数', () => {
  // 起点图：第三方聚合源，没有「名次变化」这个概念
  assert.equal(hideColumnsFor('qidiantu.shouding').includes('delta'), true)
  assert.equal(hideColumnsFor('qidiantu.sanjiang').includes('delta'), true)
  // 应用口径后，起点图首订的列里不该再出现 delta
  const sd = applyColumnPolicy(columnsFor(boardMeta('qidiantu.shouding'), { hasBaseline: true, hasHistory: false }), 'qidiantu.shouding').map((c) => c.key)
  assert.ok(!sd.includes('delta'), '起点图首订不该有名次变化列')
  assert.ok(sd.includes('value') && sd.includes('ratio') && sd.includes('collect'), '主指标/收订比/收藏都要在')
  // 三江：delta 与 daily 都不该出（变化已由今日增量 + 7 列每日增量表达）
  const sj = applyColumnPolicy(columnsFor(boardMeta('qidiantu.sanjiang'), { hasBaseline: true, hasHistory: false }), 'qidiantu.sanjiang').map((c) => c.key)
  assert.ok(!sj.includes('delta') && !sj.includes('daily'), '三江不出 delta/daily')
  assert.ok(sj.includes('dailyDelta') && sj.includes('daily0') && sj.includes('daily6'), '增量的表达要保留')
  // 刺猬猫首订（约）：第三方，不出在榜天数
  assert.equal(hideColumnsFor('ciweimao.buy.latest').includes('days'), true)
  // 真实榜单的 delta 仍在
  assert.equal(hideColumnsFor('qidian.sign.cat12').length, 0)
  assert.equal(hideColumnsFor('ciweimao.no-vip-click.week').length, 0)
  assert.deepEqual(hideColumnsFor('sfacg.new.click'), ['score'], '菠萝包只隐藏「作品评分」')
  assert.equal(hideColumnsFor('fanqie.m.new.262').length, 0)
})


test('★ 「变化」列口径：有真实名次的榜用名次差，起点图/刺猬猫首订约不值得出', () => {
  // 番茄是真实榜单（有 rank 1..30）⇒ 变化必须是名次差，否则退化成「在读差」与在读变化重复
  assert.equal(usesRankDelta('fanqie.m.new.1140'), true)
  assert.equal(usesRankDelta('fanqie.m.new.262'), true)
  // 派生榜（本地算的涨幅榜）不是名次榜
  assert.equal(usesRankDelta('fanqie.derived.period'), false)
  // 起点/刺猬猫榜单/菠萝包 都是真实名次榜
  assert.equal(usesRankDelta('qidian.sign.cat12'), true)
  assert.equal(usesRankDelta('ciweimao.no-vip-click.week'), true)
  assert.equal(usesRankDelta('sfacg.hot.week'), true)
  // 起点图不是榜单；刺猬猫「首订（约）」是第三方约值榜
  assert.equal(usesRankDelta('qidiantu.shouding'), false)
  assert.equal(usesRankDelta('qidiantu.sanjiang'), false)
  assert.equal(usesRankDelta('ciweimao.buy.latest'), false)
})


test('★ 菠萝包不出「作品评分」列（无意义装饰条目，属主 2026-10-15）', () => {
  for (const b of ['sfacg.new.click', 'sfacg.hot.week', 'sfacg.vip.week']) {
    assert.equal(hideColumnsFor(b).includes('score'), true, b + ' 要隐藏 score')
    const keys = applyColumnPolicy(columnsFor(boardMeta(b), { hasBaseline: true, hasHistory: true }), b).map((c) => c.key)
    assert.ok(!keys.includes('score'), b + ' 的列集合里不该有 score')
    assert.ok(keys.includes('collect') && keys.includes('words'), b + ' 收藏/字数必须保留')
  }
  // 排序项里也不能再出现 score（客户端按列集合过滤排序项）
})

test('★ 数值排序必须倒序（字数/收藏/首订：最大的在前）；缺失值排最后', () => {
  // 直接钉方向：comparator(a,b) 必须把大的放前面
  assert.ok(compareDesc(100, 5) < 0, '100 应排在 5 前面')
  assert.ok(compareDesc(5, 100) > 0, '5 应排在 100 后面')
  assert.equal(compareDesc(7, 7), 0)
  const vals = [12, 300, 5, 999]
  const sorted = vals.slice().sort(compareDesc)
  assert.deepEqual(sorted, [999, 300, 12, 5], '必须是从大到小')
  // 缺失值 = +Infinity ⇒ 倒序后落到底部
  const withMissing = [50, Number.POSITIVE_INFINITY, 200].slice().sort(compareDesc)
  assert.deepEqual(withMissing, [200, 50, Number.POSITIVE_INFINITY], '缺失值要排最后（数组末尾）')
})

test('★ 三江列与默认排序：期累计要有；默认排序 = 期初收藏', () => {
  const keys = applyColumnPolicy(columnsFor(boardMeta('qidiantu.sanjiang'), { hasBaseline: true, hasHistory: false }), 'qidiantu.sanjiang').map((c) => c.key)
  // 三江原本只有今日增量 + 7 列每日增量，没有合计（属主 2026-10-15 指出）
  assert.ok(keys.includes('periodTotal'), '三江必须有「期累计」列')
  assert.ok(keys.includes('collectBase'), '期初收藏要在')
  assert.ok(keys.includes('dailyDelta'), '今日增量要在')
  assert.ok(!keys.includes('settledDays'), '「已结算天数」列已去掉')
  assert.ok(!keys.includes('rank'), '三江去掉名次列')
  // 默认排序口径
  assert.equal(defaultSortFor('qidiantu.sanjiang'), 'collectBase')
  assert.equal(defaultSortFor('qidiantu.shouding'), null, '首订榜保持站点顺序')
  assert.equal(defaultSortFor('qidian.sign.cat12'), null)
  assert.equal(defaultSortFor('fanqie.derived.period'), null, '派生榜默认按今日涨幅（名次就是它）')
})

test('★ 番茄在读周榜列：分类/字数要在，名次不要', () => {
  const keys = applyColumnPolicy(columnsFor(boardMeta('fanqie.derived.period'), { hasBaseline: true, hasHistory: false }), 'fanqie.derived.period').map((c) => c.key)
  assert.ok(keys.includes('words'), '在读周榜要显示字数（属主 2026-10-15）')
  assert.ok(keys.includes('cat'), '要显示分类')
  assert.ok(keys.includes('read') && keys.includes('periodDelta'), '在读与期累计要在')
  assert.ok(keys.includes('pday0') && keys.includes('pday6'), '七天逐日增量要在')
  assert.ok(!keys.includes('rank'), '名次不要（与涨幅列重复）')
  assert.ok(!keys.includes('days'), '在榜天数不要（派生榜没有快照）')
})

test('★ 番茄分类：extra.catId（数字）要解析成 extra.cat（中文名）', () => {
  // 番茄的行只有 catId ⇒ 之前「分类」列恒为「—」
  assert.equal(withFanqieCat({ catId: 1140 }).cat, '东方仙侠')
  assert.equal(withFanqieCat({ catId: 258 }).cat, '传统玄幻')
  assert.equal(withFanqieCat({ catId: 262 }).cat, '都市脑洞')
  // 已经有文本 cat 的（起点/起点图/刺猬猫）不许覆盖
  const ex = withFanqieCat({ cat: '历史', catId: 1140 })
  assert.equal(ex.cat, '历史', '有文本分类就别动它')
  // 未知 id / 没有 id ⇒ 不写（列显示「—」，不编造）
  assert.equal(withFanqieCat({ catId: 999999 }).cat, undefined)
  assert.equal(withFanqieCat({}).cat, undefined)
  assert.equal(fanqieCatName(1141), '西方奇幻')
  assert.equal(fanqieCatName(null), null)
  assert.equal(fanqieCatName('258'), '传统玄幻', '字符串 id 也要认')
})

