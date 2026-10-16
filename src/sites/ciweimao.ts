import { MissingError, type BoardCtx, type BoardResult, type Row, type SiteAdapter } from '../scan/types.js'
import { boundedFetch } from '../scan/bounded-fetch.js'
import { defaultRequestGate, withRateLimit, type RequestGate } from '../scan/rate-limit.js'

/**
 * 刺猬猫（ciweimao.com）适配器 —— 周期榜。实测（2026-10-14，只读取证）：
 * - 榜页 /rank-index/{rank_id}-{period}[/{page}]；每页 10 条；免 cookie、免登录
 * - 条目是 <li data-book-id="…">：名次 <i class="rank-top …">、书名 h3.tit > a、作者「小说作者：」后的 a
 * - **条目里没有任何数值字段** ⇒ 指标是名次型
 * - 陷阱：未知周期后缀仍 200（不能靠状态码判周期）；未知 rank_id 才 404，且错误页 <title>刺猬猫</title>
 */
export const CIWEIMAO_BOARDS: Record<string, string> = {
  'ciweimao.no-vip-click.week': '/rank-index/no-vip-click-week',
  'ciweimao.yp_new.week': '/rank-index/yp_new-week',
}

/** 首订（约）：**第三方**接口，不在刺猬猫站上。注意是 http（https 在本地会被重置） */
export const CIWEIMAO_BUY_URL = 'http://newmmapi.yukirus.com/CiweiMaoRank/GetFavorite10KBuyRank'
export const CIWEIMAO_BUY_BOARD = 'ciweimao.buy.latest'

/**
 * 有效书号：纯数字。★ 票 48：字段改名（book_id → BookId）时旧写法产出 `key="undefined"`、
 * url 指向 `/book/undefined`，且会被 `seen` 去重后整榜塌成 1 行 —— 直接跳过该行更诚实。
 */
function bookIdOf(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return /^\d+$/.test(s) ? s : null
}

/** 数值清洗：缺失 / 空串 / 占位串（"暂无" / "--"）一律 null —— `Number('') === 0` 会把「没给数」写成真实的 0 */
function approxOf(raw: string | null): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/\+/g, '').replace(/[^\d.]/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parseBuy(json: any): Row[] {
  const list = json && json.data && json.data.list
  if (!Array.isArray(list)) return []
  const out: Row[] = []
  for (const x of list) {
    const id = bookIdOf(x && x.book_id)
    if (!id) continue
    const raw = x.buy_num == null ? null : String(x.buy_num)
    out.push({
      key: id,
      // 名次 = 站点给的顺序（接口没有名次字段）；跳过坏行后仍连续
      rank: out.length + 1,
      value: approxOf(raw),
      title: x.book_name ? String(x.book_name) : '',
      author: x.author ? String(x.author) : null,
      url: 'https://www.ciweimao.com/book/' + id,
      extra: {
        issue: x.issue != null && String(x.issue).trim() !== '' ? Number(x.issue) : null,
        buyNumRaw: raw,
        approx: true,
        isLock: x.is_lock === true,
        firstBuyableAt: x.first_buyable_chapta_publish_time || null,
        source: '第三方（newmmapi.yukirus.com）· 约值',
      },
    })
  }
  return out
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

export function parseRankPage(html: string): Row[] {
  const rows: Row[] = []
  const parts = html.split(/<li data-book-id="/).slice(1)
  for (const part of parts) {
    const idm = part.match(/^(\d+)"/)
    if (!idm) continue
    // ★ 票 49：条目边界 = 下一个 <li data-book-id="；原来是硬编码 `slice(0, 4000)`，
    //   条目比 4000 字符长（长简介）时后面的作者/最近更新会被静默切掉
    const block = part.split('<li data-book-id="')[0]
    if (!block) continue
    // 名次：前三名 <i class="rank-top topN">N</i>，第 4 名起 <i >N</i> ⇒ 取块内第一个带数字的 <i>
    const rankM = block.match(/<i[^>]*>\s*(\d{1,3})\s*<\/i>/)
    const titleM = block.match(/<h3 class="tit"><a[^>]*>([^<]+)<\/a>/) || block.match(/<h3 class="tit"><a[^>]*title="([^"]+)"/)
    const authorM = block.match(/小说作者：<a[^>]*>([^<]+)<\/a>/)
    rows.push({
      key: idm[1],
      rank: rankM ? Number(rankM[1]) : null,
      value: null,
      title: titleM ? decode(titleM[1]).trim() : '',
      author: authorM ? authorM[1].trim() : null,
      url: 'https://www.ciweimao.com/book/' + idm[1],
      extra: { update: (block.match(/最近更新：([^<]+)</) || [])[1] || null },
    })
  }
  return rows
}

export function makeCiweimaoSite(opts: {
  boards?: string[]
  fetchText?: (url: string, ctx: BoardCtx) => Promise<string>
  /** 每榜取多少条（榜页支持 /{page}，每页 10 条，上限 100） */
  depthOf?: (boardId: string) => number
  /** ★ 票 50：本适配器用的请求闸门（缺省 = 全局限速器；测试替身可用假时钟/假 sleep） */
  rateGate?: RequestGate
} = {}): SiteAdapter {
  const boards = opts.boards && opts.boards.length ? opts.boards : Object.keys(CIWEIMAO_BOARDS)
  // ★ 票 50：默认请求通道过全局限速器（翻页 / 首订回退都算同一时间线）
  const fetchText = opts.fetchText || withRateLimit(async (url: string, c?: BoardCtx) => {
    const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs })) as unknown as {
      status: number
      ok: boolean
      text(): Promise<string>
    }
    if (res.status === 404) throw new MissingError('刺猬猫 404（rank_id 不存在）')
    // ★ 票 49 顺带：401/403 是站点改了门禁（本站实测免 cookie、免登录），给个能看懂的 reason。
    //   刻意**不**映射成 `login_required`：冻结口径 spec-扫榜插件-v1:73 写明该状态
    //   「仅桌面档，v1 不会出现」（v1 全部站点免登录，见 adr/0001），面板对它配的是
    //   「需更新 cookie」引导 —— 免登录站给出这个状态只会误导使用者。
    if (res.status === 401 || res.status === 403) throw new MissingError('HTTP ' + res.status + '（站点门禁变化，可能需要登录）')
    if (!res.ok) throw new MissingError('HTTP ' + res.status)
    return await res.text()
  }, () => opts.rateGate || defaultRequestGate())
  return {
    id: 'ciweimao',
    site: '刺猬猫',
    metric: 'rank',
    boards,
    async fetchBoard(id: string, ctx: BoardCtx): Promise<BoardResult> {
      if (id === CIWEIMAO_BUY_BOARD) {
        const t0 = Date.now()
        let requests = 0
        const getJson = async (url: string) => {
          requests += 1
          const t = await fetchText(url, ctx)
          try { return JSON.parse(t) } catch (e) { throw new MissingError('首订接口返回非 JSON') }
        }
        let j = await getJson(CIWEIMAO_BUY_URL)
        let rows = parseBuy(j)
        let issue = j && j.data ? Number(j.data.issue) : null
        const warnings: string[] = ['第三方约值（带 + 号），非官方数据']
        // 空期回退上一期（照搬生产侧：最多回退 2 期）
        for (let k = 1; k <= 2 && !rows.length && issue; k++) {
          j = await getJson(CIWEIMAO_BUY_URL + '?issue=' + (issue - k))
          rows = parseBuy(j)
          if (rows.length) {
            issue = j && j.data ? Number(j.data.issue) : issue
            warnings.push('当期为空，已回退到第 ' + issue + ' 期')
          }
        }
        if (!rows.length) throw new MissingError('首订接口无数据（含回退仍为空）')
        return { boardId: id, status: 'ok', metric: 'value', rows, requests, durationMs: Date.now() - t0, warnings }
      }
      const path = CIWEIMAO_BOARDS[id]
      if (!path) throw new MissingError('未知榜 id：' + id)
      const t0 = Date.now()
      // 深度：榜页 /rank-index/{rank_id}-{period}[/{page}]，每页 10 条 ⇒ 翻页取到 depth 条
      const depth = Math.max(10, Math.min(100, opts.depthOf ? opts.depthOf(id) : 10))
      const pages = Math.ceil(depth / 10)
      let requests = 0
      const seen = new Set<string>()
      const rows: Row[] = []
      for (let page = 1; page <= pages; page++) {
        const url = 'https://www.ciweimao.com' + path + (page > 1 ? '/' + page : '')
        const html = await fetchText(url, ctx)
        requests += 1
        if (/<title>刺猬猫<\/title>/.test(html)) {
          if (page === 1) throw new MissingError('刺猬猫错误页（无该榜）')
          break
        }
        const part = parseRankPage(html)
        if (!part.length) break
        for (const x of part) {
          if (seen.has(x.key)) continue
          seen.add(x.key)
          rows.push(x)
        }
      }
      if (!rows.length) throw new MissingError('页面无 data-book-id（结构变化或榜单为空）')
      // 翻页后站点给的 rank 是页内名次 ⇒ 按取回顺序重排行号
      const ranked = rows.map((x, i) => ({ ...x, rank: i + 1 }))
      return { boardId: id, status: 'ok', rows: ranked, requests, durationMs: Date.now() - t0, warnings: requests > 1 ? ['已翻 ' + requests + ' 页取 ' + ranked.length + ' 条'] : [] }
    },
  }
}