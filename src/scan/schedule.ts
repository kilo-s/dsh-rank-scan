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

/** 本地自然日 → 'YYYY-MM-DD'（与 index.ts 的 localDate 同口径：Asia/Shanghai 本地时区） */
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
 * ★ 2026-10-16（允许自定抓取时刻）：**按站分时抓取**的纯函数部分。
 *
 * 为什么按站分：各站当天刷新榜单的时刻不一样（起点凌晨换榜、起点图中午结算…）。
 * 原来只有一个全局 scanTime，抓早了的站会拿到「昨天那版却记在今天」⇒ 变化列出现假持平。
 * 现在每个站放在「它自己刷新点之后留足余量」的时刻抓，且**每站当天只跑一次**。
 *
 * 这里只放纯逻辑（便于离线单测）；真正的调度在 index.ts 的 checkTimerInner。
 */

/**
 * 各站默认抓取时刻（可被面板覆盖）。**2026-10-30 复核**：用 ~/.dsh/data/rank-scan 下 16 天快照
 * 逐站回放（版本签名 = key/rank/收藏/字数/评分），结论见每行注释 —— 时刻对"内容对不对"的影响分三种：
 *   ① 站点的"整代对象"一天里会换代 ⇒ 抓早了拿旧代（菠萝包）；
 *   ② 站点按日结算、24:00 后切换 ⇒ 当天任意时刻都是同一版（番茄）；
 *   ③ 名单由"上架日"决定、抓早抓晚相同，但**数值仍在长**（起点图首订）。
 */
export const DEFAULT_SITE_TIMES: Record<string, string> = {
  qidian: '01:30',   // 起点：凌晨换榜（00:00 前后）；16 天 16 个不同版本、零重复，且与云端采集同刻（novel-stats 每日 01:30）
  /**
   * 菠萝包：**09:30 ⇒ 14:30（2026-10-30 改）**。首页是站点自己生成的"整代"对象：
   *   云端实测 02:15 仍是上一代、13:48 已见新代；10-03 探针 03:00/04:00/05:00/06:00/07:00/07:45 六次
   *   boardSig16 全同 ⇒ 刷新落在 07:45–13:48 这段窗口里，09:30 正踩在中间（本地面板 10-24/25/26
   *   三榜连续三天同一版、10-26 还被记成 ok ⇒ 假持平）。挪到 14:30 之后才在"已换代"的一侧。
   *   ⚠ 只改时刻治不了"整天不换代"（10-18 22:30 抓仍是旧代）⇒ 判据见 scan/freshness.ts 的多日版本集合。
   */
  sfacg: '14:30',
  fanqie: '08:30',   // 番茄：榜按日结算、24:00 之后才切换（09-19 实测 17:31/17:50 仍标「截止 09-18 24:00」）⇒ 当天任意时刻抓都是同一版，08:30 不会抓早
  ciweimao: '10:40', // 刺猬猫：三个榜是周榜/批榜，一天内内容不随时刻变（16 天 16 个版本、每版跨多天）⇒ 时刻不敏感，10:40 属安全值
  /**
   * 起点图：**12:40 ⇒ 21:30（2026-10-30 改）**。首订榜抓的是「上架日 D-1」整批：
   *   名单抓早抓晚相同（实测 showDate 恒 = 抓取日−1、firstV 覆盖 00:00–23:59），
   *   但**首订数值**要到「首V + 24h」才收盘：固定 12:40 抓平均 40% 的书未收盘（09:30 是 66%），21:30 降到 13%（22:30 才 9%）。
   *   三江是期榜，抓晚一点更贴近当天最后一次滚动值（起点图滚动值滞后 1.9–2.3h）。
   */
  qidiantu: '21:30',
}

/** 兜底时刻：当天某站没跑成（失败/关机/晚开机）时，到这个点再补跑一次该站 */
export const DEFAULT_FALLBACK_TIME = '22:30'

/**
 * ★ 2026-10-30：**失败后不必等到兜底时刻**。以前一次失败（站点不可达/晚开机）就把该站压到 22:30，
 * 中途十几个小时空转；现在冷却 N 分钟就能补那一次（仍然是**每站每天最多补一次**，含首跑共 ≤2 次请求轮）。
 */
export const RETRY_COOLDOWN_MIN = 30

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
  /**
   * ★ 2026-10-17：今天**定时跑过但没跑成**的站（跑失败、或没有任何一榜在计划时刻之后成功抓到）。
   *   这类站以前会被 siteLastRun 记成「今天已跑」⇒ 不会再试，兜底也够不着；现在进兜底队列。
   *   ★ 2026-10-30：不再死等 fallbackTime —— 见 minutesSinceAttempt / retryCooldownMin。
   */
  failed?: string[]
  /**
   * ★ 2026-10-30：每站**今天最后一次尝试**距今多少分钟（调用方按 siteLastTimerAt / 快照时刻算好）。
   *   只给 failed 站用：冷却到了就立刻补跑一次，不必压到 22:30（晚开机/站点抖动的日子能当天补上）。
   */
  minutesSinceAttempt?: Record<string, number>
  /** 失败后冷却分钟数（默认 RETRY_COOLDOWN_MIN） */
  retryCooldownMin?: number
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
  const failed = new Set((i.failed || []).map(String))
  const cooldownMin = typeof i.retryCooldownMin === 'number' ? i.retryCooldownMin : RETRY_COOLDOWN_MIN
  /** 失败站的冷却是否已过（拿不到时刻 ⇒ 不当冷却已过，退回原行为：等兜底） */
  const cooledDown = (s: string) => {
    const m = (i.minutesSinceAttempt || {})[s]
    return typeof m === 'number' && m >= cooldownMin
  }
  for (const s of sites) {
    const doneBySnapshot = i.siteLastRun[s] === i.today || ranToday.has(s)
    /**
     * ★ C（2026-10-16）「疑似未刷新」 + ★ 2026-10-17「今天跑过但没跑成」都在这里兜：
     *   两者都要到兜底时刻再试一次，且**每站每天最多一次**（retried 记录）。
     *   以前只有 stale 一条路 ⇒ 跑失败的站永远没人管（siteLastRun 已经记成今天跑过了）。
     */
    const needRetry = stale.has(s) || failed.has(s)
    const canRetry = needRetry && (i.retried || {})[s] !== i.today
    if (doneBySnapshot) {
      /**
       * 抓到过但需要重试 ⇒ **只走补跑队列**（走 due 会绕开「每天最多补一次」的记录）。
       * 触发条件二选一：① 跑失败且冷却已过（2026-10-30 新增，当天就能补）；② 到了兜底时刻。
       */
      if (canRetry && ((failed.has(s) && cooledDown(s)) || timeReached(i.nowHM, i.fallbackTime))) { fallback.push(s); continue }
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
