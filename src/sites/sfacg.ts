import { MissingError, type BoardCtx, type BoardResult, type Row, type SiteAdapter } from '../scan/types.js'
import { boundedFetch } from '../scan/bounded-fetch.js'

/**
 * 菠萝包轻小说（book.sfacg.com）适配器 —— 首页 SSR 的三个榜（2026-10-14 属主定）。
 * 实测事实：
 * - 首页 15 个区块，用 span.main-title 的文本定位；周期 tab 是**同页 div.tab-item**（不是 URL 参数），
 *   两个 tab 的数据都在 SSR 里；每个 tab 固定 10 条
 * - 名次 1–2 是图文形态 li.figure（书名被站点截断成「...」，另有 评分/字数/收藏），
 *   名次 3+ 是 li.list（i.num 是零填充名次，书名同样截断，**没有数值也没有作者**）
 * - 错误页也返回 HTTP 200（title「出错了」/「糟糕,页面找不到了」）⇒ 判 missing 不能只看状态码
 */
export const SFACG_BOARDS: Record<string, { title: string; tab: string; name: string }> = {
  'sfacg.new.click': { title: '新书榜', tab: '点击', name: '新书榜（点击）' },
  'sfacg.hot.week': { title: '轻小说热榜', tab: '周', name: '轻小说热榜（周）' },
  'sfacg.vip.week': { title: 'VIP热销榜', tab: '周', name: 'VIP热销榜（周）' },
}

const num = (s?: string | null): number | null => {
  if (s == null) return null
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? n : null
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
      },
    })
  }
  // 前两名是图文形态，没有显式名次 ⇒ 按出现顺序补 1、2
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
} = {}): SiteAdapter {
  const boards = opts.boards && opts.boards.length ? opts.boards : Object.keys(SFACG_BOARDS)
  const fetchText = opts.fetchText || (async (url: string, c?: BoardCtx) => {
    const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs })) as unknown as {
      status: number
      ok: boolean
      text(): Promise<string>
    }
    if (!res.ok) throw new MissingError('HTTP ' + res.status)
    return await res.text()
  })
  return {
    id: 'sfacg',
    site: '菠萝包',
    metric: 'rank',
    boards,
    async fetchBoard(id: string, ctx: BoardCtx): Promise<BoardResult> {
      const spec = SFACG_BOARDS[id]
      if (!spec) throw new MissingError('未知榜 id：' + id)
      const t0 = Date.now()
      const html = await fetchText('https://book.sfacg.com/', ctx)
      if (/<title>出错了<\/title>|糟糕,页面找不到了|小说不存在/.test(html)) throw new MissingError('菠萝包错误页')
      if (html.length < 5000) throw new MissingError('页面过小（可能被拦）')
      const rows = parseHomeBoard(html, spec.title, spec.tab)
      if (!rows) throw new MissingError('页面里找不到该榜/该 tab：' + spec.title + ' - ' + spec.tab)
      if (!rows.length) throw new MissingError('该 tab 无条目')
      const warnings: string[] = []
      if (rows.some((r) => r.extra && r.extra.titleTruncated)) warnings.push('书名被站点截断（首页榜通病）：点面板「补全本榜」可换成全名并补作者（约 10 请求）')
      return { boardId: id, status: 'ok', rows, requests: 1, durationMs: Date.now() - t0, warnings }
    },
  }
}
