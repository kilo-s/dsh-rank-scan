import { MissingError, type BoardCtx, type BoardResult, type Row, type SiteAdapter } from '../scan/types.js'
import { boundedFetch } from '../scan/bounded-fetch.js'
import { defaultRequestGate, withRateLimit, type RequestGate } from '../scan/rate-limit.js'

/**
 * 菠萝包轻小说适配器 —— 三个榜通过 DaoSearch（daosearch.io）SSR 榜页采集。
 * 实测事实：
 * - 每页 20 条，翻页参数 `&page={N}`，支持按 depthOf 截取（对齐刺猬猫默认 30 条、上限 100）
 * - 每条直接带完整书名、作者、字数与收藏（书号为 SF 原始 ID，链接统一拼回 book.sfacg.com）
 * - 未知/失效 rank_type 会静默回退默认月票月榜（HTTP 200）⇒ 需核对 canonical 里的 rank_type
 */
export const SFACG_BOARDS: Record<string, { title: string; tab: string; name: string; rankType: string }> = {
  'sfacg.new.click': { title: '新书榜', tab: '点击', name: '新书榜（点击）', rankType: 'new_collections_all' },
  'sfacg.hot.week': { title: '轻小说热榜', tab: '周', name: '轻小说热榜（周）', rankType: 'clicks_week' },
  'sfacg.vip.week': { title: 'VIP热销榜', tab: '周', name: 'VIP热销榜（周）', rankType: 'bestselling_week' },
}

const DAOSEARCH_BASE = 'https://daosearch.io/sfacg/rankings'
const DAOSEARCH_PAGE_SIZE = 20
const DEFAULT_UA = 'dsh-rank-scan/0.6'

const num = (s?: string | null): number | null => {
  if (s == null) return null
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? n : null
}

const decodeHtml = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))

/** 解析中文缩写数量（如 "192.1万字"、"1.6万"、"1亿"、"7017"）；缺失/非法一律 null */
export function parseCnCount(raw?: string | null): number | null {
  if (raw == null) return null
  const t = String(raw).replace(/[,，\s字]/g, '').trim()
  if (!t) return null
  const yi = t.match(/^(\d+(?:\.\d+)?)亿$/)
  if (yi) return Math.round(Number(yi[1]) * 100000000)
  const wan = t.match(/^(\d+(?:\.\d+)?)万$/)
  if (wan) return Math.round(Number(wan[1]) * 10000)
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 解析 DaoSearch SF轻小说榜页 SSR（每页 20 条，完整书名/作者/字数/收藏） */
export function parseDaoSearchRankPage(html: string): Row[] {
  const rows: Row[] = []
  const parts = html.split(/<li class="row-with-save">/).slice(1)
  for (const part of parts) {
    const block = part.split('</li>')[0]
    if (!block) continue
    const idm = block.match(/href="\/sfacg\/book\/(\d+)\//)
    if (!idm) continue
    const rankM = block.match(/class="browse-num"[^>]*>\s*(\d+)\s*</)
    const titleM = block.match(/<strong>([\s\S]*?)<\/strong>/)
    const title = titleM ? decodeHtml(titleM[1].replace(/<[^>]*>/g, '')).trim() : ''
    const authorM = block.match(/class="chart-byline"[^>]*>([\s\S]*?)<\/span>/)
    const authorRaw = authorM ? decodeHtml(authorM[1].replace(/<[^>]*>/g, '')).trim() : ''
    const wordsM = block.match(/<use href="#i-lines"\s*\/?><\/svg>([^<]+)</) || block.match(/([\d.,]+(?:亿|万)?\s*字)/)
    const words = parseCnCount(wordsM ? wordsM[1] : null)
    let collect: number | null = null
    let monthlyTickets: number | null = null
    let popularity: number | null = null
    for (const sm of block.matchAll(/class="chart-stat-val">([^<]+)<\/span><span class="chart-stat-lbl">([^<]+)<\/span>/g)) {
      const lbl = sm[2].trim()
      if (lbl === '收藏') collect = parseCnCount(sm[1])
      else if (lbl === '月票') monthlyTickets = parseCnCount(sm[1])
      else if (lbl === '人气') popularity = parseCnCount(sm[1])
    }
    rows.push({
      key: idm[1],
      rank: rankM ? Number(rankM[1]) : null,
      value: null,
      title,
      author: authorRaw || null,
      url: 'https://book.sfacg.com/Novel/' + idm[1] + '/',
      extra: {
        score: null,
        words,
        collect,
        monthlyTickets,
        popularity,
        titleTruncated: /\.\.\.$/.test(title),
        rankFromPage: rankM != null,
      },
    })
  }
  return rows
}

/**
 * 从菠萝包**书页** <title> 里取作者（纯函数，可单测）。
 * 首页三个榜都拿不到作者：1–2 名是图文卡（只有评分/字数/收藏），3+ 名连数值都没有 ⇒ 适配器里 author 恒 null，
 * 只能靠书页补全。实测形态（2026-10-15 取 /Novel/783717/）：
 *   「越狱失败后成了典狱长小姐的玩物 - 小说全文阅读 - 纯爱运动女性主角变身橘味 - 日升之时 - SF轻小说」
 * 口径：按 ' - ' 取**倒数第二段**（'SF轻小说' 前一段）；段数不合预期时用正则兜底。
 */
export function authorFromBookTitle(title: string): string | null {
  const raw = String(title || '').trim()
  if (!raw) return null
  const segs = raw.split(' - ').map((x) => x.trim()).filter(Boolean)
  if (segs.length >= 5) return segs[segs.length - 2] || null
  // 兜底 ①：锚定「阅读」到「SF轻小说」之间那段（不管分隔符有没有空格）
  const m = raw.match(/阅读\s*[-·]\s*([^-·]+?)\s*[-·]\s*SF轻小说/)
  if (m) return m[1].trim() || null
  // 兜底 ②：连段数都不够（如「书名 - 分类 - 作者 - SF轻小说」）⇒ 取「SF轻小说」前的最后一段
  const m2 = raw.match(/^(.*?)\s*[-·]\s*SF轻小说\s*$/)
  if (!m2) return null
  const parts = m2[1].split(/\s+-\s+|\s+[·]\s+|\s*[-·]\s*/).map((x) => x.trim()).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 1] : null
}

/**
 * 解析菠萝包原站单书页简介与标签（纯函数，零额外请求复用已抓书页 HTML）。
 */
export function parseSfacgBookMeta(html: string): { desc: string | null; tags: string[] } {
  if (!html || typeof html !== 'string') return { desc: null, tags: [] }
  let desc: string | null = null
  const dm = html.match(/<(?:p|div)[^>]*class="[^"]*introduce[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i)
  if (dm) {
    const raw = dm[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
    const lines = decodeHtml(raw)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((ln) => ln.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
      .filter(Boolean)
    if (lines.length) desc = lines.join('\n')
  }
  const tags: string[] = []
  const seen = new Set<string>()
  const tb = html.match(/<(?:ul|div)[^>]*class="[^"]*tag-list[^"]*"[^>]*>([\s\S]*?)<\/(?:ul|div)>/i)
  if (tb) {
    for (const m of tb[1].matchAll(/<(?:span|a)[^>]*>([\s\S]*?)<\/(?:span|a)>/gi)) {
      const t = decodeHtml(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
      if (t.length >= 2 && t.length <= 20 && !seen.has(t)) {
        seen.add(t)
        tags.push(t)
        if (tags.length >= 16) break
      }
    }
  }
  return { desc, tags }
}

/** 取某个榜某个 tab 的条目（找不到榜/tab ⇒ null） */
export function parseHomeBoard(html: string, title: string, tab: string): Row[] | null {
  const at = html.indexOf('>' + title + '<')
  if (at < 0) return null
  const navAt = html.indexOf('class="tab-nav', at)
  const conAt = html.indexOf('class="tab-content"', at)
  if (navAt < 0 || conAt < 0 || conAt < navAt) return null
  const navNames = Array.from(html.slice(navAt, conAt).matchAll(/<div class="nav-item[^"]*">\s*<a[^>]*>([^<]+)<\/a>/g)).map((m) => m[1].trim())
  const idx = navNames.indexOf(tab)
  if (idx < 0) return null
  const chunks = html.slice(conAt).split(/<div class="tab-item/).slice(1)
  const chunk = chunks[idx]
  if (!chunk) return null
  const end = chunk.indexOf('</div><!-- /tab-content') >= 0 ? chunk.indexOf('</div><!-- /tab-content') : chunk.length
  const body = chunk.slice(0, end)
  const rows: Row[] = []
  const pieces = body.split('<li ').slice(1)
  for (const piece of pieces) {
    const idm = piece.match(/\/Novel\/(\d+)\//)
    if (!idm) continue
    const rankM = piece.match(/<i class="num">\s*(\d+)\s*<\/i>/)
    const figM = piece.match(/<p class="figcaption">([^<]*)/)
    const txtM = piece.match(/class="text"[^>]*>([^<]*)/)
    const title2 = (figM ? figM[1] : txtM ? txtM[1] : '').trim()
    const score = (piece.match(/评分：([\d.]+)/) || [])[1]
    const words = (piece.match(/字数：(\d+)/) || [])[1]
    const collect = (piece.match(/收藏：(\d+)/) || [])[1]
    rows.push({
      key: idm[1],
      rank: rankM ? Number(rankM[1]) : null,
      value: null,
      title: title2,
      author: null,
      url: 'https://book.sfacg.com/Novel/' + idm[1] + '/',
      extra: {
        score: score ? Number(score) : null,
        words: num(words),
        collect: num(collect),
        titleTruncated: /\.\.\.$/.test(title2),
        // ★ 票 49：名次到底来自页面还是按位置补号 —— 让上面那条「位置补号」不再不可见
        //   （夹具曾经把 <i class="num"> 裁掉，于是这条路径从没被走过）
        rankFromPage: rankM != null,
      },
    })
  }
  // 前两名是图文形态（li.figure），页面**确实没有**名次 ⇒ 只能按出现顺序补 1、2（1-2 名的既定口径）；
  // 第 3 名起页面给了 <i class="num">03</i> ⇒ 名次来自页面，不该再走这条补号路径
  let auto = 1
  for (const r of rows) {
    if (r.rank == null) r.rank = auto
    auto = (r.rank || auto) + 1
  }
  return rows
}

export function makeSfacgSite(opts: {
  boards?: string[]
  fetchText?: (url: string, ctx: BoardCtx) => Promise<string>
  /** 每榜取多少条（每页 20 条，上限 100；缺省 30 对齐刺猬猫） */
  depthOf?: (boardId: string) => number
  /** ★ 票 50：本适配器用的请求闸门（缺省 = 全局限速器；测试替身可用假时钟/假 sleep） */
  rateGate?: RequestGate
} = {}): SiteAdapter {
  const boards = opts.boards && opts.boards.length ? opts.boards : Object.keys(SFACG_BOARDS)
  // ★ 票 50：默认请求通道过全局限速器
  const fetchText = opts.fetchText || withRateLimit(async (url: string, c?: BoardCtx) => {
    const res = (await boundedFetch(url, { headers: { 'User-Agent': DEFAULT_UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs })) as unknown as {
      status: number
      ok: boolean
      text(): Promise<string>
    }
    if (!res.ok) throw new MissingError('HTTP ' + res.status)
    return await res.text()
  }, () => opts.rateGate || defaultRequestGate())
  return {
    id: 'sfacg',
    site: '菠萝包',
    metric: 'rank',
    boards,
    async fetchBoard(id: string, ctx: BoardCtx): Promise<BoardResult> {
      const spec = SFACG_BOARDS[id]
      if (!spec) throw new MissingError('未知榜 id：' + id)
      const t0 = Date.now()
      const depth = Math.max(1, Math.min(100, opts.depthOf ? opts.depthOf(id) : 30))
      const pages = Math.ceil(depth / DAOSEARCH_PAGE_SIZE)
      let requests = 0
      const seen = new Set<string>()
      const rows: Row[] = []
      for (let page = 1; page <= pages; page++) {
        const url = DAOSEARCH_BASE + '?lang=zh&rank_type=' + spec.rankType + (page > 1 ? '&page=' + page : '')
        const html = await fetchText(url, ctx)
        requests += 1
        if (/<title>(?:Just a moment|出错了|404)|cf-browser-verification|糟糕,页面找不到了|小说不存在/i.test(html)) {
          if (page === 1) throw new MissingError('菠萝包榜单异常页')
          break
        }
        if (html.length < 1500) {
          if (page === 1) throw new MissingError('页面过小（可能被拦）')
          break
        }
        const canonM = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)
        if (canonM && !canonM[1].includes('rank_type=' + spec.rankType)) {
          if (page === 1) throw new MissingError('页面未命中目标榜（可能 rank_type 已变更）：' + spec.rankType)
          break
        }
        const part = parseDaoSearchRankPage(html)
        if (!part.length) {
          if (page === 1) throw new MissingError('页面里找不到榜单条目：' + spec.rankType)
          break
        }
        let added = 0
        for (const x of part) {
          if (seen.has(x.key)) continue
          seen.add(x.key)
          rows.push(x)
          added += 1
          if (rows.length >= depth) break
        }
        if (!added || rows.length >= depth) break
      }
      if (!rows.length) throw new MissingError('榜单无条目')
      // 名次优先用页面自带 browse-num；缺失时才顺位补号并留警告（票 49）
      let auto = 1
      for (const r of rows) {
        if (r.rank == null) r.rank = auto
        auto = (r.rank || auto) + 1
      }
      const warnings: string[] = []
      if (rows.some((r) => r.extra && r.extra.titleTruncated)) warnings.push('书名被站点截断：点面板「补全本榜」可换成全名')
      if (rows.some((r) => r.extra && r.extra.rankFromPage === false)) {
        warnings.push('有名次不是页面给的（browse-num 缺失？）—— 已按出现顺序补号，请核对')
      }
      return { boardId: id, status: 'ok', rows, requests, durationMs: Date.now() - t0, warnings }
    },
  }
}
