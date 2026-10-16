/**
 * 定时判定的纯函数（原有，2026-10-15「重启即重扫」事故的回归面）
 */

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** 'HH:mm' 合法性（面板输入校验用） */
export function validTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))
}

/** 本地时刻 → 'HH:mm' */
export function hhmm(d: Date): string {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 本地自然日 → 'YYYY-MM-DD'（与 index.ts 的 localDate 同口径：Asia/Shanghai 本机时区） */
export function localYmd(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 到点没？（只看开关/到点/当天是否已扫完；重启重复扫由 shouldFireTimer 的落盘记录挡） */
export function dueNow(now: Date, scanTime: string, enabled: boolean, hasCompletedToday: boolean): boolean {
  if (!enabled) return false
  if (hasCompletedToday) return false
  return hhmm(now) >= scanTime
}

export interface FireInput {
  now: Date
  scanTime: string
  enabled: boolean
  hasCompletedToday: boolean
  lastTimerRun: string | null
  startedAtMs: number
  freshMs: number
}

/**
 * 该不该跑定时扫描：
 * - 启动宽限期内不跑（宿主刚起来不抢资源）
 * - 落盘的 lastTimerRun = 今天 ⇒ 不跑（★ 关键：跨重启有效，否则重启即重扫）
 */
export function shouldFireTimer(i: FireInput): boolean {
  if (!i.enabled) return false
  if (i.now.getTime() - i.startedAtMs < i.freshMs) return false
  if (i.lastTimerRun === localYmd(i.now)) return false
  if (i.hasCompletedToday) return false
  return hhmm(i.now) >= i.scanTime
}

/**
 * ★ 2026-10-16（维护者授权自定抓取时刻）：**按站分时抓取**的纯函数部分。
 *
 * 为什么按站分：各站当天刷新榜单的时刻不一样（起点凌晨换榜、起点图中午结算…）。
 * 原来只有一个全局 scanTime，抓早了的站会拿到「昨天那版却记在今天」⇒ 变化列出现假持平。
 * 现在每个站放在「它自己刷新点之后留足余量」的时刻抓，且**每站当天只跑一次**。
 *
 * 这里只放纯逻辑（便于离线单测）；真正的调度在 index.ts 的 checkTimerInner。
 */

/** 各站默认抓取时刻（经验值，可被面板覆盖；都留了 1–2 小时余量防站点更新抖动） */
export const DEFAULT_SITE_TIMES: Record<string, string> = {
  qidian: '01:30',   // 起点：凌晨换榜（00:00 前后）
  sfacg: '02:30',    // 菠萝包：首页周榜/新书榜凌晨刷新
  fanqie: '08:30',   // 番茄：在读是小时级更新，早晨口径稳定
  ciweimao: '10:40', // 刺猬猫：10K 买断榜（第三方）上午更新
  qidiantu: '12:40', // 起点图：三江/首订统计中午前后结算
}

/** 兜底时刻：当天某站没跑成（失败/关机/晚开机）时，到这个点再补跑一次该站 */
export const DEFAULT_FALLBACK_TIME = '22:30'

/** 站点顺序（面板与调度都按它来，稳定输出） */
export const SITE_ORDER = ['qidian', 'sfacg', 'fanqie', 'ciweimao', 'qidiantu']

/** 榜 id 的站点前缀：qidian.sign.cat4 → qidian；fanqie.derived.period → fanqie */
export function siteOfBoard(boardId: string): string {
  return String(boardId).split('.')[0]
}

/** 本地时刻 → 'HH:mm' */
export function hmOf(d: Date): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** 'HH:mm' 比较（同长度字符串可以直接比） */
export function timeReached(nowHM: string, target: string): boolean {
  return nowHM >= target
}

export interface PlanInput {
  /** 现在几点（'HH:mm'） */
  nowHM: string
  /** 今天的数据日 */
  today: string
  /** 抓取集（榜 id 列表） */
  boards: string[]
  siteTimes: Record<string, string>
  /** 每站最近一次成功跑过的数据日 */
  siteLastRun: Record<string, string>
  fallbackTime: string
  /** 今天已经有当天快照的站（就算 siteLastRun 没记也当已跑） */
  ranToday?: string[]
  /** ★ 疑似未刷新的站（与上一数据日整榜全等）⇒ 到兜底时刻重跑一次 */
  stale?: string[]
  /** 已经重跑过的站 → 数据日（每站每天最多重跑一次，防止反复打站点） */
  retried?: Record<string, string>
}

export interface PlanResult {
  /** 到点该跑的站（按时刻升序） */
  due: string[]
  /** 到兜底时间还没跑成的站 */
  fallback: string[]
  /** 今天已完成（siteLastRun=今天 或 已有当天快照） */
  done: string[]
  /** 还没到点的站 */
  waiting: string[]
}

/**
 * 决定「这一轮该跑哪个站」。一次只跑一个站（index.ts 的调用方取 due[0] || fallback[0]），
 * 免得 5 个站同时开跑把站点请求打满、也免得互相抢扫描锁。
 */
export function planSiteRuns(i: PlanInput): PlanResult {
  const ranToday = new Set((i.ranToday || []).map(String))
  const sites = SITE_ORDER.filter((s) => (i.boards || []).some((b) => siteOfBoard(b) === s))
  const due: { site: string; at: string }[] = []
  const fallback: string[] = []
  const done: string[] = []
  const waiting: string[] = []
  const stale = new Set((i.stale || []).map(String))
  for (const s of sites) {
    const doneBySnapshot = i.siteLastRun[s] === i.today || ranToday.has(s)
    // ★ C（2026-10-16）：抓到了但「疑似未刷新」⇒ 到兜底时刻重跑一次（每站每天最多一次）
    const canRetry = stale.has(s) && (i.retried || {})[s] !== i.today
    if (doneBySnapshot) {
      // 抓到过但疑似未刷新 ⇒ 到兜底时刻**只走补跑队列**（走 due 会绕开「每天最多补一次」的记录）
      if (canRetry && timeReached(i.nowHM, i.fallbackTime)) { fallback.push(s); continue }
      done.push(s)
      continue
    }
    const at = i.siteTimes[s] || DEFAULT_SITE_TIMES[s] || i.fallbackTime
    if (timeReached(i.nowHM, at)) due.push({ site: s, at })
    else if (timeReached(i.nowHM, i.fallbackTime)) fallback.push(s)
    else waiting.push(s)
  }
  due.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { due: due.map((x) => x.site), fallback, done, waiting }
}
