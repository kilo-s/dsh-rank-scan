import { MissingError, type BoardCtx, type BoardResult, type Row, type SiteAdapter } from '../scan/types.js'
import { boundedFetch } from '../scan/bounded-fetch.js'
import { defaultRequestGate, withRateLimit, type RequestGate } from '../scan/rate-limit.js'

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
 *  ⇒ 会被误判成「该日期无数据」（2026-10-15 使用者截图里就是这个）。 */
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
 * ★ 票 49：起点图两个榜都是**纯位置索引**（第 5 格是收订比、第 6 格是首订…）——
 * 站点插一列、或改个表头名，旧实现会把整列读错却照样判 ok（错的数比没数更糟）。
 * 所以在读格之前先校验表头：**列数**（第一行 th 的 colspan 之和，与数据行 td 数对齐）+ **列名**。
 * 不符一律 MissingError（runScan 映射成 missing，不落快照）。
 *
 * 例外：**空期不校验**（一个数据行都没有的 200 页 = 「这期还没发布」，不是结构变化）——
 * 三江的「空期回退上一期」依赖这个语义。
 */
interface TableHead {
  /** 每一行 thead 的 th 纯文本（去掉标签与「点击可排序」这类备注） */
  rows: string[][]
  /** 列数 = 第一行 th 的 colspan 之和 */
  columns: number
}

function normHeadText(inner: string): string {
  return String(inner)
    .replace(/<[^>]*>/g, ' ') // 丢掉 <font>/<br> 之类
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[(（][^()（）]*[)）]\s*$/, '') // 表头里的「点击可排序」备注不算列名
    .trim()
}

function colspanOf(attrs: string): number {
  const m = attrs.match(/colspan\s*=\s*"?(\d+)/i)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** 取表头（优先 <thead>；退路：第一个含 <th> 的行）；拿不到 ⇒ null */
function parseTableHead(html: string): TableHead | null {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/)
  const block = thead
    ? thead[0]
    : (html.match(/<tr[\s\S]*?<\/tr>/g) || []).find((tr) => /<th[\s>]/.test(tr)) || null
  if (!block) return null
  const thRe = /<th\b([^>]*)>([\s\S]*?)(?=<\/th>|<th\b|$)/g
  const rows: string[][] = []
  let columns = 0
  for (const tr of block.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells: string[] = []
    let span = 0
    for (const m of tr.matchAll(thRe)) {
      cells.push(normHeadText(m[2]))
      span += colspanOf(m[1])
    }
    if (cells.length) {
      rows.push(cells)
      if (!columns) columns = span
    }
  }
  return rows.length ? { rows, columns } : null
}

/** 首订榜表头（真实页面 2026-10-13：9 列） */
const SHOUDING_HEAD = ['#', '[分类]书名', '首订', '收藏', '收订比', '字数', '粉丝', '作者', '首V时刻']

function assertShoudingHead(html: string): number {
  const head = parseTableHead(html)
  const labels = head && head.rows[0]
  if (!head || !labels) throw new MissingError('起点图首订榜表头缺失（站点结构变化）')
  if (labels.length !== SHOUDING_HEAD.length || head.columns !== SHOUDING_HEAD.length) {
    throw new MissingError(
      '起点图首订榜表头列数变化：' + labels.length + ' 列（列宽 ' + head.columns + '，期望 ' + SHOUDING_HEAD.length + '）',
    )
  }
  const bad = SHOUDING_HEAD.findIndex((h, i) => labels[i] !== h)
  if (bad >= 0) {
    throw new MissingError('起点图首订榜表头第 ' + (bad + 1) + ' 列变化：' + labels[bad] + '（期望 ' + SHOUDING_HEAD[bad] + '）')
  }
  return head.columns
}

/** 三江表头第一行前 7 列（真实页面 2026-10-11：两行表头，列宽 16） */
const SANJIANG_HEAD_LEAD = ['#', '分类', '书名', '作者', '等级', '首订', '日期']

function assertSanjiangHead(html: string): number {
  const head = parseTableHead(html)
  if (!head) throw new MissingError('三江页表头缺失（站点结构变化）')
  const r1 = head.rows[0]
  const r2 = head.rows[1]
  if (!r1 || !r2) throw new MissingError('三江页表头行数变化：' + head.rows.length + '（期望 2 行）')
  if (r1.length !== 9 || r2.length !== 9 || head.columns !== 16) {
    throw new MissingError(
      '三江页表头列数变化：' + r1.length + '/' + r2.length + '（列宽 ' + head.columns + '，期望 9/9/16）',
    )
  }
  const bad = SANJIANG_HEAD_LEAD.findIndex((h, i) => r1[i] !== h)
  if (bad >= 0) {
    throw new MissingError('三江页表头第 ' + (bad + 1) + ' 列变化：' + r1[bad] + '（期望 ' + SANJIANG_HEAD_LEAD[bad] + '）')
  }
  if (r1[7] !== '收藏' || r1[8] !== '每日收藏增量') throw new MissingError('三江页表头分组变化：' + r1[7] + '/' + r1[8])
  if (!/^\d{1,2}\.\d{1,2}\s*初始$/.test(r2[0])) throw new MissingError('三江页表头「初始」列变化：' + r2[0])
  if (r2[1] !== '总增量') throw new MissingError('三江页表头第 9 列变化：' + r2[1] + '（期望 总增量）')
  const dailyBad = r2.slice(2).findIndex((t) => !/^\d{1,2}[.\-/]\d{1,2}$/.test(t))
  if (dailyBad >= 0) throw new MissingError('三江页每日增量表头变化：' + r2[2 + dailyBad])
  return head.columns
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
  let columns = 0
  for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const info = tr.match(/<a href="\/info\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/)
    if (!info) continue
    // ★ 票 49：有数据行才校验表头（空期不校验 —— 那正是「新一期还没发布」）
    if (!columns) columns = assertSanjiangHead(html)
    const cells = tr.split('<td').slice(1).map((c) => {
      const vm = c.match(/value="?([^">]*)"?/)
      const body = c.slice(c.indexOf('>') + 1)
      return { v: vm ? vm[1] : null, text: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
    })
    if (cells.length !== columns) throw new MissingError('三江页数据行列数变化：' + cells.length + '（表头 ' + columns + ' 列）')
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
  const t = String(s).trim()
  // ★ 票 48 口径同源：空串不是 0（`Number('') === 0` 会把「没给值」写成真实的 0）
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 首订榜（/shouding/）：表头 = [#, [分类]书名, 首订, 收藏, 收订比, 字数, 粉丝, 作者, 首V时刻]。
 * ★ 口径（与三江一致）：**首订是计数类 —— 负值/0 ⇒ null**，页面偶尔出现的负数行不是「负首订」，
 *   面板一律显示「—」，绝不把负数当数值展示（使用者 2026-10-14 反馈）。
 */
export function parseShouding(html: string): { date: string | null; rows: Row[] } {
  // 日期在日期选择器的 value 里（标题不含日期）
  const dm = html.match(/id="datePicker"\s+value='(\d{4}-\d{2}-\d{2})'/) || html.match(/首订（(\d{4}-\d{2}-\d{2})/)
  const rows: Row[] = []
  let columns = 0
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const info = tr.match(/<a href="\/info\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/)
    if (!info) continue
    // ★ 票 49：有数据行才校验表头（空榜页不校验 —— 「该日期无数据」是正常 200）
    if (!columns) columns = assertShoudingHead(html)
    const cells = cellsOf(tr)
    if (cells.length !== columns) throw new MissingError('起点图首订榜数据行列数变化：' + cells.length + '（表头 ' + columns + ' 列）')
    // 计数类：负值 / 0 一律 null（本页实测有负值行；使用反馈过「怎么还有负数」）
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
      // 既定口径（2026-10-15）：起点图的作品要跳到**起点作品页**，不是起点图的 /info 页
      //   起点图 bookId 与起点 bookId 同源（均为起点书号）⇒ 直接拼起点书页
      url: 'https://www.qidian.com/book/' + info[1] + '/',
      extra: {
        qidiantuUrl: 'https://www.qidiantu.com/info/' + info[1],
        cat: (tr.match(/\[([^\]]+)\]/) || [])[1] || null,
        collect: cnt(cells[3] && cells[3].v),
        // ★ 票 49：收订比走 cnt() 口径 —— 站点在缺数据时给 -1 / 0（真实夹具 27 行里 7 行 -1、9 行 0），
        //   那是「没算出来」不是「比值是 -1」，一律 null（沿用既有的负数/0 = 计数类缺失口径）
        ratio: cnt(cells[4] && cells[4].v),
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
  /** ★ 票 50：本适配器用的请求闸门（缺省 = 全局限速器；测试替身可用假时钟/假 sleep） */
  rateGate?: RequestGate
} = {}): SiteAdapter {
  const boards = opts.boards && opts.boards.length ? opts.boards : ['qidiantu.shouding']
  // ★ 票 50：默认请求通道过全局限速器（三江「空期回退上一期」的连发也算同一时间线）
  const fetchText = opts.fetchText || withRateLimit(async (url: string, c?: BoardCtx) => {
    const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs })) as unknown as {
      status: number
      ok: boolean
      text(): Promise<string>
    }
    if (res.status === 404) throw new MissingError('起点图 404')
    if (!res.ok) throw new MissingError('HTTP ' + res.status)
    return await res.text()
  }, () => opts.rateGate || defaultRequestGate())
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
      // 既定口径：面板要能看「之前的日期数据」，不必依赖本地是否存过那天的快照
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