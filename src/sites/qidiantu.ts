import { MissingError, type BoardCtx, type BoardResult, type Row, type SiteAdapter } from '../scan/types.js'
import { boundedFetch } from '../scan/bounded-fetch.js'

/**
 * 起点图（qidiantu.com）适配器 —— 首订榜。实测（2026-10-14，只读取证）：
 * - /shouding/ 当日榜（27 条）、/shouding/{YYYY-MM-DD} 单日、/shouding/{YYYY-MM} 整月（634 条）
 * - SSR HTML 表格，无 JSON 接口；**精确数值在 td[value] 属性里**（显示文本是 1.72w 这类缩写）
 * - 陷阱：合法但无数据的日期返回 200 且 0 行 ⇒ 判 missing 只能看行数，不能看状态码
 */
export const QIDIANTU_BOARDS: Record<string, string> = {
  'qidiantu.shouding': '首订榜',
  'qidiantu.sanjiang': '三江·推荐效果（周·收藏增量）',
}

/** 某一周的三江期首日（周日） */
export function periodStartOf(d: Date): string {
  const day = d.getDay() // 0=周日
  const s = new Date(d.getTime())
  s.setDate(s.getDate() - day)
  return s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0')
}

/** 统一的本地日期串。★ **必须补零**：`/shouding/2026-10-1` 只返回 26 字节空页
 *  ⇒ 会被误判成「该日期无数据」（2026-10-15 维护者截图里就是这个）。 */
export function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function addDaysStr(s: string, n: number): string {
  const parts = s.split('-').map(Number)
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/**
 * 三江·推荐效果（/bang/1/6/<期首日>）：
 * 数据行恒 16 cell = [0]# [1]分类 [2]书名 [3]作者 [4]等级 [5]首订 [6]日期 [7]初始 [8]总增量 [9..15]第1..7天增量
 * 数值一律取单元格 value 属性（显示值是 8k / +3603 这类缩写）。
 * ★ 列级 null 策略（照搬生产侧、别一律把负数当缺失）：
 *   - 首订 / 日期 / 初始 = 计数类：负值或 0 ⇒ null
 *   - 总增量与日增量 = 差值类：**负数是真实净下降，必须原样保留**
 *   - 未到的天页面给 value=0（不是缺失）⇒ 按「列日期 > 今天」判 null
 */
export function parseSanjiang(html: string, today: string, periodStart: string): Row[] {
  const rows: Row[] = []
  const tbody = html.slice(html.indexOf('<tbody'))
  for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const info = tr.match(/<a href="\/info\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/)
    if (!info) continue
    const cells = tr.split('<td').slice(1).map((c) => {
      const vm = c.match(/value="?([^">]*)"?/)
      const body = c.slice(c.indexOf('>') + 1)
      return { v: vm ? vm[1] : null, text: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
    })
    const cnt = (s?: string | null): number | null => {
      const n = num(s)
      return n == null || n <= 0 ? null : n
    }
    const diff = (s?: string | null): number | null => num(s)
    const daily: { date: string; delta: number | null }[] = []
    for (let i = 0; i < 7; i++) {
      const date = addDaysStr(periodStart, i + 1)
      daily.push({ date, delta: date > today ? null : diff(cells[9 + i] && cells[9 + i].v) })
    }
    const authorM = tr.match(/<a href="\/author\/[^"]*"[^>]*>([^<]+)<\/a>/)
    rows.push({
      key: info[1],
      rank: num(cells[0] && cells[0].text),
      value: diff(cells[8] && cells[8].v),
      title: info[2].trim(),
      author: authorM ? authorM[1].trim() : null,
      url: 'https://www.qidian.com/book/' + info[1] + '/',
      extra: {
        cat: cells[1] ? cells[1].text : null,
        level: cells[4] ? cells[4].text : null,
        shouding: cnt(cells[5] && cells[5].v),
        firstDay: cnt(cells[6] && cells[6].v),
        collectBase: cnt(cells[7] && cells[7].v),
        totalDelta: diff(cells[8] && cells[8].v),
        daily,
        periodStart,
        settledDays: daily.filter((d) => d.delta != null).length,
      },
    })
  }
  return rows
}

function cellsOf(tr: string): { v: string | null; text: string }[] {
  return tr
    .split('<td')
    .slice(1)
    .map((c) => {
      const vm = c.match(/value="?([^">]*)"?/)
      // 先切掉本标签自己的属性（split 后剩余部分以属性开头），再取纯文本
      const body = c.slice(c.indexOf('>') + 1)
      const text = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      return { v: vm ? vm[1] : null, text }
    })
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? n : null
}

/**
 * 首订榜（/shouding/）：表头 = [#, [分类]书名, 首订, 收藏, 收订比, 字数, 粉丝, 作者, 首V时刻]。
 * ★ 口径（与三江一致）：**首订是计数类 —— 负值/0 ⇒ null**，页面偶尔出现的负数行不是「负首订」，
 *   面板一律显示「—」，绝不把负数当数值展示（维护者 2026-10-14 反馈）。
 */
export function parseShouding(html: string): { date: string | null; rows: Row[] } {
  // 日期在日期选择器的 value 里（标题不含日期）
  const dm = html.match(/id="datePicker"\s+value='(\d{4}-\d{2}-\d{2})'/) || html.match(/首订（(\d{4}-\d{2}-\d{2})/)
  const rows: Row[] = []
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const info = tr.match(/<a href="\/info\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/)
    if (!info) continue
    const cells = cellsOf(tr)
    // 计数类：负值 / 0 一律 null（本页实测有负值行；维护者反馈过「怎么还有负数」）
    const cnt = (s?: string | null): number | null => {
      const n = num(s)
      return n == null || n <= 0 ? null : n
    }
    const authorM = tr.match(/<a href="\/author\/[^"]*"[^>]*>([^<]+)<\/a>/)
    rows.push({
      key: info[1],
      rank: num(cells[0] && cells[0].text),
      value: cnt(cells[2] && cells[2].v),
      title: info[2].trim(),
      // 作者：首订页的「作者」在等级格内（"Lv.5 骆驼祥爷！"）⇒ 去掉等级前缀；退路才用 /author/ 链接
      author: authorM
        ? authorM[1].trim()
        : ((cells[7] && cells[7].text) || '').replace(/^\s*(?:Lv\.\s*\d+|白金|大神|长约|品牌作家|资深作家)\s*/, '').trim() || null,
      // 维护者口径（2026-10-15）：起点图的作品要跳到**起点作品页**，不是起点图的 /info 页
      //   起点图 bookId 与起点 bookId 同源（均为起点书号）⇒ 直接拼起点书页
      url: 'https://www.qidian.com/book/' + info[1] + '/',
      extra: {
        qidiantuUrl: 'https://www.qidiantu.com/info/' + info[1],
        cat: (tr.match(/\[([^\]]+)\]/) || [])[1] || null,
        collect: cnt(cells[3] && cells[3].v),
        ratio: num(cells[4] && cells[4].v),
        wordsCnt: num(cells[5] && cells[5].v),
        fans: cnt(cells[6] && cells[6].v),
        // ★ 第 7 格是「等级 作者」（如「Lv.5 骆驼祥爷！」/「白金 轻泉流响」），第 8 格是首 V 时刻
        //   （2026-10-15 修：原来作者取 /author/ 链接 —— 首订页根本没有这种链接 ⇒ 作者恒空）
        firstV: (cells[8] && cells[8].v) || null,
      },
    })
  }
  return { date: dm ? dm[1] : null, rows }
}

export function makeQidiantuSite(opts: {
  boards?: string[]
  fetchText?: (url: string, ctx: BoardCtx) => Promise<string>
} = {}): SiteAdapter {
  const boards = opts.boards && opts.boards.length ? opts.boards : ['qidiantu.shouding']
  const fetchText = opts.fetchText || (async (url: string, c?: BoardCtx) => {
    const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs })) as unknown as {
      status: number
      ok: boolean
      text(): Promise<string>
    }
    if (res.status === 404) throw new MissingError('起点图 404')
    if (!res.ok) throw new MissingError('HTTP ' + res.status)
    return await res.text()
  })
  return {
    id: 'qidiantu',
    site: '起点图',
    metric: 'value',
    boards,
    async fetchBoard(id: string, ctx: BoardCtx): Promise<BoardResult> {
      const t0 = Date.now()
      if (id === 'qidiantu.sanjiang') {
        const today = ctx.now()
        const ps = periodStartOf(today)
        const todayStr = ymd(today)
        /**
         * ★ 2026-10-16（跨会话收尾）：**空期回退上一期**（照搬刺猬猫首订的写法，最多退 2 期）。
         *   为什么必须做：站点在新一期（周日）**还没发布**时，/bang/1/6/<本期周日> 会返回
         *   合法 200 但没有数据行 ⇒ parseSanjiang 返回 0 行 ⇒ 旧实现直接抛 missing（当期无数据）。
         *   于是「周日 12:40 那次抓取」可能空一整天，而 stale 自检看的是「整榜 key+value 全等」，
         *   空榜（0 行）它不管 ⇒ 那天这个榜就真的没数据。
         *   退到上一期仍记一条 warning：面板能看出「今天看到的是上一期」，不是本期正常数据。
         *   （期首日 = 本地算的「本周日」，与站点 URL 口径一致；判空只看行数，不看状态码。）
         */
        let requests2 = 0
        let rows2: Row[] = []
        let usedPs = ps
        let settled = 0
        const warnings2: string[] = []
        for (let back = 0; back <= 2 && !rows2.length; back++) {
          usedPs = back === 0 ? ps : addDaysStr(ps, -7 * back)
          const html2 = await fetchText('https://www.qidiantu.com/bang/1/6/' + usedPs, ctx)
          requests2 += 1
          if (!/<tbody/.test(html2)) throw new MissingError('三江页结构变化：无 tbody')
          rows2 = parseSanjiang(html2, todayStr, usedPs)
          if (rows2.length && back > 0) {
            warnings2.push('本期（期首 ' + ps + '）无数据，已回退到上一期（期首 ' + usedPs + '）')
          }
        }
        if (!rows2.length) throw new MissingError('三江本期与上两期均无数据（可能新期还没开）')
        settled = (rows2[0].extra && (rows2[0].extra as any).settledDays) || 0
        if (settled < 7) warnings2.push('本期已结算 ' + settled + '/7 天（未到的天记为 null）')
        return {
          boardId: id,
          status: 'ok',
          rows: rows2,
          requests: requests2,
          durationMs: Date.now() - t0,
          warnings: warnings2,
        }
      }
      // 起点图支持按日期直查：/shouding/<YYYY-MM-DD>（当日 = /shouding/）
      // 维护者口径：面板要能看「之前的日期数据」，不必依赖本地是否存过那天的快照
      const day = ctx.now()
      const want = ymd(day)
      /**
       * 「真实今天」与「要请求的日期」是两件事，别搅在一起：
       *   want     = 要抓的那一天（注入的 ctx.now()，可能不是今天）
       *   todayStr = 真实系统的今天，用来判断「要不要带日期路径」
       * ★ 允许用 ctx.todayIso 覆盖真实今天 —— 否则这段判定依赖不可注入的 new Date()，
       *   测试跨过午夜就会红（曾经踩到：测试写死当日 10-15，10-16 一跑就失败），
       *   而且没法确定性复现。
       */
      const todayStr = (ctx as any).todayIso ? String((ctx as any).todayIso) : ymd(new Date())
      // ★ 2026-10-15 修：原来读 ctx.dateOf，但全仓库没有一处设置过它 ⇒ want 恒为 undefined
      //   ⇒ 永远请求当日 /shouding/，于是「直接查看历史日期」永远显示今天的榜。
      //   现在取自 ctx.now()（/day 与 /repair 路由已把 now 设成目标日期 12:00 +08:00）。
      const url = want !== todayStr ? 'https://www.qidiantu.com/shouding/' + want : 'https://www.qidiantu.com/shouding/'
      const html = await fetchText(url, ctx)
      const parsed = parseShouding(html)
      if (!parsed.rows.length) throw new MissingError('该日期无数据（0 行；注意 200 也可能是空榜）')
      return { boardId: id, status: 'ok', rows: parsed.rows, requests: 1, durationMs: Date.now() - t0, warnings: [] }
    },
  }
}