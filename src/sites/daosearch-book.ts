import { boundedFetch } from '../scan/bounded-fetch.js'
import { defaultRequestGate, withRateLimit, type RequestGate } from '../scan/rate-limit.js'
import type { BookHonour } from '../scan/book-cache.js'

/**
 * DaoSearch 单书页解析与按需拉取（零运行时依赖）：
 *   · 覆盖起点（含起点图复用起点书号）、番茄、刺猬猫、菠萝包全部五站；
 *   · 仅在用户展开行详情且 7 天本地缓存未命中时按需请求 1 次，不拖慢日常扫榜；
 *   · 统一走 boundedFetch 超时保护 + 全局限速器，失败/404 静默返回 null 由原站字段兜底。
 */
export type DaoSearchSite = 'qidian' | 'fanqie' | 'ciweimao' | 'sfacg'

export interface DaoSearchBookDetail {
  desc: string | null
  tags: string[]
  status: string | null
  category: string | null
  honours: BookHonour[]
}

const DEFAULT_UA = 'dsh-rank-scan/0.6'

export function daoSearchSiteOf(site: string): DaoSearchSite | null {
  const s = String(site || '').trim().toLowerCase()
  if (s === 'qidian' || s === 'qidiantu') return 'qidian'
  if (s === 'fanqie' || s === 'ciweimao' || s === 'sfacg') return s
  return null
}

const decodeHtml = (s: string): string =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
    })

const stripTags = (s: string): string => decodeHtml(s.replace(/<[^>]+>/g, ''))

/** 解析 DaoSearch 单书页 SSR HTML（纯函数，可离线单测） */
export function parseDaoSearchBookPage(html: string): DaoSearchBookDetail | null {
  if (!html || typeof html !== 'string') return null
  if (/<title>\s*(?:Just a moment|404|Not Found|出错了)/i.test(html)) return null
  if (!html.includes('book-detail-header') && !html.includes('book-page')) return null

  // ① 简介：保留真实段落换行，去掉全角首行缩进与空段
  let desc: string | null = null
  const synM = html.match(/<div class="reading-copy[^"]*"[^>]*>([\s\S]*?)<\/div>/)
  if (synM) {
    const raw = synM[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
    const paras = stripTags(raw)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((ln) => ln.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
      .filter(Boolean)
    if (paras.length) desc = paras.join('\n')
  }

  // ② 标签：去重保序，保留站方属性芯片与题材标签
  const tags: string[] = []
  const seenTags = new Set<string>()
  const tagsSec = html.match(/<section class="detail-section book-tags"[\s\S]*?<\/section>/)
  if (tagsSec) {
    for (const m of tagsSec[0].matchAll(/class="meta-chip[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/g)) {
      const t = stripTags(m[1]).replace(/\s+/g, ' ').trim()
      if (t && !seenTags.has(t)) {
        seenTags.add(t)
        tags.push(t)
      }
    }
  }

  // ③ 事实条：状态 / 分类
  let status: string | null = null
  let category: string | null = null
  const factsSec = html.match(/<dl class="book-facts"[\s\S]*?<\/dl>/)
  if (factsSec) {
    for (const m of factsSec[0].matchAll(/<div[^>]*>\s*<dt[^>]*>([^<]+)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>\s*<\/div>/g)) {
      const k = stripTags(m[1]).trim()
      const v = stripTags(m[2]).replace(/\s+/g, ' ').trim()
      if (!v) continue
      if (k === '状态') status = v
      else if (k === '分类') category = v
    }
  }

  // ④ 上榜徽章：兼容普通徽章与主榜+分榜复合徽章（如「13 月票月榜 魔幻第7名」及内嵌 channel 的「推荐榜 轻小说」）
  const honours: BookHonour[] = []
  const honSec = html.match(/<section class="detail-section book-honours"[\s\S]*?<\/section>/)
  if (honSec) {
    for (const m of honSec[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const li = m[1]
      const rankM = li.match(/class="honour-rank"[^>]*>\s*(\d+)\s*</)
      const subM = li.match(/class="honour-channel"[^>]*>([\s\S]*?)<\/span>/)
      const sub = subM ? stripTags(subM[1]).replace(/\s+/g, ' ').trim() : null
      // 某些站点（如起点）把 <span class="honour-channel"> 嵌在 <span class="honour-label"> 内部，先摘掉内层 channel 再取纯榜名
      const liNoSub = li.replace(/<span class="honour-channel"[^>]*>[\s\S]*?<\/span>/g, '')
      const labelM = liNoSub.match(/class="honour-label"[^>]*>([\s\S]*?)<\/span>/)
      let label = labelM ? stripTags(labelM[1]).replace(/\s+/g, ' ').trim() : ''
      if (!label) continue
      if (sub && label.endsWith(' ' + sub)) label = label.slice(0, -(sub.length + 1)).trim()
      const rank = rankM ? Number(rankM[1]) : null
      honours.push({ rank: Number.isFinite(rank as number) ? rank : null, label, sub: sub || null, source: 'daosearch' })
    }
  }

  if (!desc && !tags.length && !status && !category && !honours.length) return null
  return { desc, tags, status, category, honours }
}

/** 规范化榜名用于跨源去重（过滤掉与当前正浏览榜单重复的条目） */
function normHonourKey(label: string): string {
  return String(label || '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .replace(/×/g, '')
    .toLowerCase()
}

/** 当前榜对应的 DaoSearch 同义榜名（避免同一张榜在详情卡里重复亮一次） */
const CURRENT_BOARD_ALIASES: Record<string, string[]> = {
  'sfacg.new.click': ['新书榜', '新书收藏榜'],
  'sfacg.hot.week': ['轻小说热榜', '点击周榜', '人气周榜'],
  'sfacg.vip.week': ['vip热销榜', '热销周榜'],
  'ciweimao.no-vip-click.week': ['点击榜', '点击周榜'],
  'ciweimao.yp_new.week': ['新书榜', '新书月票周榜'],
}

/**
 * 合并「本地同日跨榜」与「DaoSearch 全站上榜」：
 *   · 排除当前正在浏览的那张榜（不重复说废话）；
 *   · 本地优先（保留你追踪的新书榜/签约榜/三江/首订），再补 DaoSearch 的其余全站官方榜；
 *   · 按规范化榜名去重并限制上限，防止爆行高。
 */
export function mergeBookHonours(
  localHonours: BookHonour[],
  dsHonours: BookHonour[],
  currentBoardId?: string | null,
  currentBoardName?: string | null,
  maxItems = 8,
): BookHonour[] {
  const curId = String(currentBoardId || '').trim()
  const excluded = new Set<string>()
  if (currentBoardName) excluded.add(normHonourKey(currentBoardName))
  for (const alias of CURRENT_BOARD_ALIASES[curId] || []) excluded.add(normHonourKey(alias))

  const out: BookHonour[] = []
  const seen = new Set<string>()
  const push = (it: BookHonour) => {
    if (!it || !it.label) return
    if (curId && it.boardId && it.boardId === curId) return
    let label = String(it.label).trim()
    const sub = it.sub ? String(it.sub).trim() : null
    // 兼容已落盘旧缓存：若 label 末尾已经带了 sub（如「推荐榜 轻小说」+「轻小说」），去掉重复尾缀
    if (sub && label.endsWith(' ' + sub)) label = label.slice(0, -(sub.length + 1)).trim()
    const k = normHonourKey(label)
    if (!k || excluded.has(k) || seen.has(k)) return
    seen.add(k)
    if (it.boardId) {
      for (const alias of CURRENT_BOARD_ALIASES[it.boardId] || []) seen.add(normHonourKey(alias))
    }
    out.push(label === it.label ? it : { ...it, label, sub })
  }

  for (const x of localHonours || []) push(x)
  for (const x of dsHonours || []) push(x)
  return out.slice(0, Math.max(1, maxItems))
}

/** 按需拉取单本 DaoSearch 详情页（带超时与限速；失败返回 null 不抛错） */
export async function fetchDaoSearchBook(
  site: string,
  bookId: string,
  opts: { timeoutMs?: number; rateGate?: RequestGate } = {},
): Promise<DaoSearchBookDetail | null> {
  const dsSite = daoSearchSiteOf(site)
  const id = String(bookId || '').trim()
  if (!dsSite || !/^\d+$/.test(id)) return null
  const url = 'https://daosearch.io/' + dsSite + '/book/' + id + '?lang=zh'
  const gateFn = opts.rateGate ? () => opts.rateGate! : defaultRequestGate
  const doGet = withRateLimit(async (u: string) => {
    const res = (await boundedFetch(u, {
      headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      timeoutMs: opts.timeoutMs ?? 10_000,
    })) as unknown as { status: number; ok: boolean; text(): Promise<string> }
    if (!res.ok) return null
    return res.text()
  }, gateFn)
  try {
    const html = await doGet(url)
    return html ? parseDaoSearchBookPage(html) : null
  } catch {
    return null
  }
}
