import type { Row } from './types.js'

/** 面板视图层（宿主侧）：列随榜逻辑 + 按站编组 + 变化分组。**渲染不联网**，全部由已落盘快照算出。 */

export interface Column { key: string; label: string; note?: string; source?: string }

export interface BoardMeta {
  boardId: string
  site: string
  siteName: string
  name: string
  metric: 'rank' | 'value'
  /** 榜本身已限定分类 ⇒ 不显示分类列 */
  categoryScoped: boolean
  /** 非默认抓取/非默认显示时给出提示 */
  extended?: boolean
  caliber?: string
  /** 数据来源（第三方等）要标出来 */
  source?: string
}

const QIDIAN_CATS: Record<number, string> = {
  21: '玄幻', 1: '奇幻', 2: '武侠', 22: '仙侠', 4: '都市', 15: '现实', 6: '军事',
  5: '历史', 7: '游戏', 8: '体育', 9: '科幻', 10: '悬疑灵异', 20109: '诸天无限', 12: '轻小说',
}
const FANQIE_CATS: Record<number, string> = {
  1141: '西方奇幻', 1140: '东方仙侠', 8: '科幻末世', 261: '都市日常', 124: '都市修真',
  1014: '都市高武', 273: '历史古代', 27: '战神赘婿', 263: '都市种田', 258: '传统玄幻',
  272: '历史脑洞', 539: '悬疑脑洞', 262: '都市脑洞', 257: '玄幻脑洞', 751: '悬疑灵异',
  504: '抗战谍战', 746: '游戏体育', 718: '动漫衍生', 1016: '男频衍生',
}

const SFACG_NAMES: Record<string, string> = {
  'sfacg.new.click': '新书榜（点击）',
  'sfacg.hot.week': '轻小说热榜（周）',
  'sfacg.vip.week': 'VIP热销榜（周）',
}
const CW_NAMES: Record<string, string> = {
  'ciweimao.no-vip-click.week': '点击榜（非VIP·周）',
  'ciweimao.yp_new.week': '新书榜（周）',
  'ciweimao.buy.latest': '首订（约）',
}

export function boardMeta(boardId: string): BoardMeta {
  const base = { boardId, metric: 'rank' as const, categoryScoped: false }
  if (boardId.startsWith('qidian.')) {
    const m = boardId.match(/^qidian\.([a-z]+)\.cat(-?\d+)$/)
    const slug = m ? m[1] : boardId.split('.')[1]
    const catId = m ? Number(m[2]) : -1
    const catName = m ? QIDIAN_CATS[catId] : undefined
    return {
      ...base,
      site: 'qidian',
      siteName: '起点',
      name: '签约榜 × ' + (catName || ('分类 ' + catId)) + '（移动端口径）',
      categoryScoped: !!catName,
      extended: !!catName && catName !== '轻小说',
      caliber: '移动端签约榜；与 BB 的桌面「签约新书榜」不是同一个榜',
    }
  }
  if (boardId === 'qidiantu.shouding') {
    return { ...base, site: 'qidiantu', siteName: '起点图', name: '首订榜', metric: 'value', caliber: '页面内容日期常为上一日' }
  }
  if (boardId === 'qidiantu.sanjiang') {
    return { ...base, site: 'qidiantu', siteName: '起点图', name: '三江·推荐效果（周·收藏增量）', metric: 'value', caliber: '期首日=周日，7 天收藏增量窗口', extended: true }
  }
  if (boardId.startsWith('fanqie.derived.')) {
    return {
      ...base,
      site: 'fanqie',
      siteName: '番茄',
      name: '在读周榜（候选池内）',
      metric: 'value',
      categoryScoped: true,
      extended: true,
      // 口径：照搬起点图三江榜的「同一期首日 + 期内累加每日增量 + 已结算 N 天」
      caliber: '本地派生（不发请求）：自然周（周一~周日）同一期首日 + 期内累加每日增量；名次按今日涨幅',
    }
  }
  if (boardId.startsWith('fanqie.')) {
    const parts = boardId.split('.')
    const catId = Number(parts[3])
    const catName = FANQIE_CATS[catId]
    return {
      ...base,
      site: 'fanqie',
      siteName: '番茄',
      name: '男频新书榜 × ' + (catName || ('分类 ' + catId)),
      metric: 'value',
      categoryScoped: !!catName,
      caliber: '站方每天 15:00 前更新截止上一日；书名/作者可能因字体反爬缺字',
    }
  }
  if (SFACG_NAMES[boardId]) {
    return { ...base, site: 'sfacg', siteName: '菠萝包', name: SFACG_NAMES[boardId], caliber: '首页 SSR，每榜 10 条；书名被站点截断' }
  }
  if (CW_NAMES[boardId]) {
    return {
      ...base,
      site: 'ciweimao',
      siteName: '刺猬猫',
      name: CW_NAMES[boardId],
      metric: boardId === 'ciweimao.buy.latest' ? 'value' : 'rank',
      source: boardId === 'ciweimao.buy.latest' ? '第三方（newmmapi.yukirus.com）· 约值' : undefined,
    }
  }
  return { ...base, site: 'other', siteName: '其他', name: boardId }
}

/**
 * 列随榜：核心列固定 + 该榜能给的列；没有的字段**整列不出现**。
 * 2026-10-14 属主反馈后的口径：
 * - **数值型必带主指标列**（起点图首订=首订、番茄=在读、刺猬猫首订约=首订（约）、派生榜=在读/七日累计）
 * - 番茄删「站方升降 / 更新时间」（属主点名不要）；「在榜天数」只在真有历史（≥2 数据日）时出现
 * - 菠萝包评分/字数/收藏只在前 2 名有值（首页 SSR 限制），列保留、空格显示「—」
 */
export interface ColumnFlags {
  /** 是否存在上一个数据日（决定「变化/在读变化/在榜天数」是否有意义） */
  hasBaseline: boolean
  /** 是否有任何历史精简索引（决定「在榜天数」是否值得占一列） */
  hasHistory: boolean
}

export function columnsFor(meta: BoardMeta, flags: ColumnFlags = { hasBaseline: false, hasHistory: false }): Column[] {
  const derivedBoard = meta.boardId.startsWith('fanqie.derived.')
  /**
   * 名次列（属主 2026-10-15）：
   *  - 起点图三江：**去掉名次**（它不是名次榜，行是「按收藏增量捞出来的书」，名次没意义）；
   *  - 番茄在读周榜（派生）：**去掉名次**（名次就是「今日涨幅倒序」，和涨幅列重复）；
   *  - 其余榜保留名次；非派生榜另给「变化」列。
   */
  const dropRank = meta.boardId === 'qidiantu.sanjiang' || derivedBoard
  const cols: Column[] = []
  if (!dropRank) cols.push({ key: 'rank', label: '名次' })
  if (!derivedBoard) cols.push({ key: 'delta', label: '变化' })
  const qidian = meta.site === 'qidian'
  const qidiantu = meta.site === 'qidiantu'
  const fanqie = meta.site === 'fanqie'
  const cw = meta.site === 'ciweimao'
  const sfacg = meta.site === 'sfacg'
  const derived = derivedBoard
  cols.push({ key: 'title', label: '书名' })
  // 作者列：菠萝包首页榜**没有**作者（sfacg.ts 注释有实测），但书页 <title> 里有 ⇒ 补全后能填上，故一并给列
  if (qidian || qidiantu || fanqie || cw || sfacg) cols.push({ key: 'author', label: '作者' })
  if (!derived && !meta.categoryScoped && (qidian || qidiantu || fanqie)) cols.push({ key: 'cat', label: '分类' })
  if (qidian) cols.push({ key: 'subCat', label: '子分类' }, { key: 'words', label: '字数', note: '站点缩写文本；开 enrich 后为精确值' }, { key: 'collect', label: '收藏', note: '需 enrich（默认关）' })
  if (qidiantu && meta.boardId === 'qidiantu.shouding') {
    // ★ 列序（属主 2026-10-15）：**字数紧跟在「分类」后面**，再排该站自己的指标。
    //   统一口径：分类之后 = 作品自身属性（字数）→ 站方/第三方指标 → 差值列 → 趋势列。
    cols.push(
      { key: 'words', label: '字数', note: '起点图口径（该站统计，实测 63/63 行有值）' },
      { key: 'value', label: '首订', note: '主指标；站点给负值的行按口径记 null ⇒ 显示「—」' },
      { key: 'collect', label: '收藏', note: '起点图口径（该站自己的统计，期数式）——与起点作品页的收藏同名不同源，实测差 0.3%~7%，别混用' },
      { key: 'ratio', label: '收订比' },
      { key: 'fans', label: '粉丝' },
    )
  }
  if (qidiantu && meta.boardId === 'qidiantu.sanjiang') {
    // ★ 列序（属主 2026-10-15）：**字数紧跟在「分类」后面**（三江源里没有字数字段，值取自起点书页）
    cols.push({ key: 'words', label: '字数', note: '三江源里没有字数字段，取自起点书页（走书页缓存）' })
    cols.push({ key: 'collectBase', label: '期初收藏' }, { key: 'dailyDelta', label: '今日增量', note: '今天那天的收藏增量；未到的天「—」' })
    // ★ 每日增量拆成 7 列（2026-10-15 属主反馈）：原先 7 天的值挤在一个单元格里，读不出来。
    //   列头用「第N天」，具体日期由宿主在 extra.daily 里给（期首日=周日，每周日滚一期）。
    for (let d = 0; d < 7; d++) {
      cols.push({ key: 'daily' + d, label: '第' + (d + 1) + '天', note: d === 0 ? '期首日=周日；未到的天「—」' : undefined })
    }
    // ★ 期累计（2026-10-15 属主发现缺）：三江原本只有「今日增量 + 7 列每日增量」，**没有把这一期加起来**。
    //   合计必须计入主字段，否则「这期到底涨了多少」得自己心算（而且未到的天是 null，不参与合计）。
    // 期累计保留；「已结算天数」去掉（属主 2026-10-15：那一列没意义）——期次范围写在面板说明行
    // 字数：三江表里没有 ⇒ 从起点书页取（走书页缓存，命中即显示；见 postScanEnrich / 面板按钮）
    cols.push({ key: 'periodTotal', label: '期累计', note: '本期已结算各日增量之和（未到的天不计）' })
  }
  if (fanqie && meta.boardId.startsWith('fanqie.m.')) {
    cols.push({ key: 'words', label: '字数' }, { key: 'read', label: '在读', note: '主指标' })
    if (flags.hasBaseline) cols.push({ key: 'readDelta', label: '在读变化', note: '本地按天算（今日 − 昨日）' })
  }
  if (fanqie && derived) {
    // 属主口径（2026-10-15 定稿）：名次 = 今日涨幅倒序；另给一列**本期累计涨幅**（可排序）
    // 与起点图三江同构（属主 2026-10-15）：今日涨幅 + 期累计 + **本期内每一天的增量各占一列**
    // 分类 + 字数（属主 2026-10-15：在读周榜也要显示作品字数）
    cols.push({ key: 'cat', label: '分类', note: '取自所在分类榜的快照' })
    cols.push(
      { key: 'read', label: '在读' },
      { key: 'words', label: '字数', note: '取自所在分类榜快照的 wordNumber（番茄榜页自带）' },
      { key: 'value', label: '今日涨幅', note: '今日在读 − 上一数据日' },
      { key: 'periodDelta', label: '期累计', note: '今日在读 − 本期基准日（期首周一；期首缺快照时退回本期内最早有数据的日期，看说明行）' },
    )
    for (let d = 0; d < 7; d++) {
      cols.push({ key: 'pday' + d, label: '第' + (d + 1) + '天', note: '本期第 ' + (d + 1) + ' 天的在读增量（未到/缺数据 ⇒ 「—」）' })
    }
  }
  if (cw && meta.boardId === 'ciweimao.buy.latest') {
    // ★ 属主 2026-10-15：第三方约值榜原来只有「首订（原始）」，**没有字数/收藏**。
    //   取数见 index.ts#enrichBoard：先把第三方来源页补进每条，再逐本进**刺猬猫书页**取字数/收藏。
    //   口径提示：同一行里首订是第三方约值，字数/收藏是刺猬猫书页当天的值 —— 两源不同。
    cols.push(
      { key: 'buyNumRaw', label: '首订（原始）', note: '带 + 号，第三方约值（newmmapi.yukirus.com）' },
      { key: 'words', label: '字数', note: '刺猬猫书页口径（与「首订（原始）」不同源）' },
      { key: 'collect', label: '收藏', note: '刺猬猫书页口径（与「首订（原始）」不同源）' },
    )
  }
  // 菠萝包：字数/收藏**榜页只有前 2 名有**，但书页补全早把整榜补齐了（实测 10/10）；评分是首页装饰值 ⇒ 只有前 2 名有
  if (sfacg) cols.push({ key: 'score', label: '评分', note: '榜页只有前 2 名有（首页装饰值）；其余行「—」' }, { key: 'words', label: '字数', note: '书页补全（首页榜仅前 2 名有）' }, { key: 'collect', label: '收藏', note: '书页补全（首页榜仅前 2 名有）' })
  // 刺猬猫榜单页没有任何数值：字数/收藏要走书页（面板「补全本榜」）
  // 列顺序统一（2026-10-15 属主）：全站一致为「字数 → 收藏」，与起点/菠萝包同序（此处原来反着写）
  if (cw && meta.boardId !== 'ciweimao.buy.latest') cols.push({ key: 'words', label: '字数', note: '榜单页无此字段；「补全本榜」进书页补' }, { key: 'collect', label: '收藏', note: '榜单页无此字段；「补全本榜」进书页补' })
  // 「在榜天数」只在真有历史时占列（派生榜另用「在池天数」）
  if (!derived && flags.hasHistory) cols.push({ key: 'days', label: '在榜天数' })
  return cols
}

/** 变化分组：按站编组，组内固定四组（新入榜 / 上升 / 下降 / 退榜；回榜单独标） */
export interface ChangeEntry { site: string; siteName: string; boardId: string; boardName: string; group: string; title: string; delta: string; days: number | null }

export function groupChanges(entries: ChangeEntry[]): { site: string; siteName: string; groups: { group: string; items: ChangeEntry[] }[] }[] {
  const order = ['新入榜', '回榜', '上升', '下降', '退榜']
  const bySite = new Map<string, ChangeEntry[]>()
  for (const e of entries) {
    const list = bySite.get(e.site) || []
    list.push(e)
    bySite.set(e.site, list)
  }
  const out: { site: string; siteName: string; groups: { group: string; items: ChangeEntry[] }[] }[] = []
  for (const [site, list] of bySite) {
    const groups = order
      .map((g) => ({ group: g, items: list.filter((e) => e.group === g) }))
      .filter((g) => g.items.length > 0)
    out.push({ site, siteName: list[0].siteName, groups })
  }
  return out
}

/** 概览：按站编组 + 五态计数 + 隐藏榜数 */
export interface BoardSummaryRow { boardId: string; name: string; status: string; up: number | null; newCount: number | null; out: number | null; lastCapture: string | null; note: string | null; extended?: boolean; source?: string }

export function groupBySite(rows: { boardId: string; status: string }[]): { site: string; siteName: string; count: number; statuses: string[] }[] {
  const bySite = new Map<string, { siteName: string; statuses: string[] }>()
  for (const r of rows) {
    const meta = boardMeta(r.boardId)
    const cur = bySite.get(meta.site) || { siteName: meta.siteName, statuses: [] }
    cur.statuses.push(r.status)
    bySite.set(meta.site, cur)
  }
  return Array.from(bySite.entries()).map(([site, v]) => ({ site, siteName: v.siteName, count: v.statuses.length, statuses: v.statuses }))
}
/**
 * 「在榜天数」列该不该出（纯函数、可单测）。口径（属主 2026-10-15）：
 *  - **起点图不出**：它是第三方聚合源、本身不是榜单，行是「按首订/收藏增量捞出来的书」，
 *    跨天连续在榜对它没有意义。
 *  - 其余站：该榜**有任何本地数据**就给。一天也出（新书/首次抓到的榜每行显示 1 天，
 *    而不是整列消失或一片「—」）。★ 2026-10-15 二次修正：原来要求「该榜有 ≥2 个数据日」，
 *    结果起点其它子分类、番茄部分分类（都只有当天一份快照）整列不出，看起来像「分类之间没统一」。
 */
export function shouldShowDays(site: string, dataDatesForBoard: number): boolean {
  if (site === 'qidiantu') return false
  return dataDatesForBoard > 0
}

/**
 * 该榜**不该出**的列（纯函数、可单测）。口径全部来自属主 2026-10-15 的逐条反馈：
 *  - 起点图（第三方聚合源，非官方榜单）：没有「名次变化」这种概念 ⇒ 不出 delta；
 *    且整站不出「在榜天数」（见 shouldShowDays）。
 *  - 起点图三江：变化已由「今日增量 / 每日增量 7 列」表达 ⇒ delta 重复，去掉。
 *  - 刺猬猫「首订（约）」：第三方约值榜，不出「在榜天数」。
 *  - 菠萝包/番茄等其余榜：照旧。
 */
export function hideColumnsFor(boardId: string): string[] {
  const hide: string[] = []
  if (boardId.startsWith('qidiantu.')) hide.push('delta')
  // 菠萝包的「作品评分」是站点的一个无意义装饰条目（属主 2026-10-15）⇒ 不出
  if (boardId.startsWith('sfacg.')) hide.push('score')
  if (boardId === 'qidiantu.sanjiang') hide.push('daily')
  if (boardId === 'ciweimao.buy.latest') hide.push('days')
  // 派生榜是按区间动态算出来的视图，没有单一快照/没有「在榜天数」概念（池内天数已在 extra 里）
  if (boardId.startsWith('fanqie.derived.')) hide.push('days')
  return hide
}

/** 按口径过滤列集合（列表页每次渲染都过一遍，保证「不该出的列」永不出） */
export function applyColumnPolicy(cols: Column[], boardId: string): Column[] {
  const hide = new Set(hideColumnsFor(boardId))
  return hide.size ? cols.filter((c) => !hide.has(c.key)) : cols
}

/**
 * 「变化」列该以**名次变化**为准的榜（纯函数、可单测）。属主 2026-10-15 口径：
 *  - 有真实名次的榜（番茄新书榜、起点、刺猬猫榜单、菠萝包榜单）⇒ 变化 = 名次变化，
 *    否则「变化」会退化成主指标的数值差（番茄就是在读差），与「在读变化」列 **完全重复**。
 *  - 起点图不是榜单（第三方聚合）/刺猬猫「首订（约）」是第三方约值榜 ⇒ 没有名次变化，
 *    变化交给它自己的增量列表达（三江的今日增量 + 每日增量 7 列），不出名次列。
 */
export function usesRankDelta(boardId: string): boolean {
  if (boardId.startsWith('fanqie.')) return !boardId.startsWith('fanqie.derived.')
  if (boardId.startsWith('qidian.')) return true
  if (boardId.startsWith('ciweimao.')) return boardId !== 'ciweimao.buy.latest'
  if (boardId.startsWith('sfacg.')) return true
  if (boardId.startsWith('qidiantu.')) return false
  return false
}

/**
 * 数值型排序的比较器（**一律倒序**，属主 2026-10-15：按字数/收藏/首订要「最大的在前」）。
 * 缺失值统一成 +Infinity ⇒ 倒序时排到最后，不会污染榜首。
 * 抽成纯函数是为了能被单测钉住方向（之前是内联的 num(a)-num(b)，被写成了正序）。
 */
export function compareDesc(a: number | null, b: number | null): number {
  // 缺失值显式判定，**永远压到最后**（不依赖 Infinity 参与减法：之前我靠 +Infinity 糊，
  // 倒序时 Infinity 会跑到最前面，把没数据的行顶到榜首）。
  const aMissing = a == null || !Number.isFinite(a)
  const bMissing = b == null || !Number.isFinite(b)
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return (b as number) - (a as number)
}

/**
 * 该榜在**没有显式选排序**时该按什么排（纯函数、可单测）。返回 null = 保持站点原始顺序。
 * 属主 2026-10-15：起点图三江默认按**期初收藏**（它是收藏增量榜，期初体量决定量级）。
 */
export function defaultSortFor(boardId: string): string | null {
  if (boardId === 'qidiantu.sanjiang') return 'collectBase'
  return null
}

/**
 * 番茄分类 id → 中文名（纯函数、可单测）。
 * ★ 2026-10-15 属主反馈「周榜的作品分类为什么不显示」：番茄的行把分类存在 `extra.catId`（数字），
 *   而列渲染读的是 `extra.cat`（起点/起点图/刺猬猫那是文本）⇒ 番茄这边**永远显示「—」**。
 *   修法：宿主侧把 catId 解析成名字写进 `extra.cat`，客户端不用知道映射表。
 *   同一 bug 也影响**番茄各个单分类榜**（它们同样只有 catId）—— 一并修掉。
 */
export function fanqieCatName(catId: unknown): string | null {
  const id = typeof catId === 'number' ? catId : Number(catId)
  if (!Number.isFinite(id)) return null
  return FANQIE_CATS[id] || null
}

/** 番茄行统一在此补 `extra.cat`（有文本就不用动；只有 catId 就解析成名字） */
export function withFanqieCat(extra: Record<string, any> | undefined): Record<string, any> {
  const ex: Record<string, any> = { ...(extra || {}) }
  if (!ex.cat && ex.catId != null) {
    const name = fanqieCatName(ex.catId)
    if (name) ex.cat = name
  }
  return ex
}

