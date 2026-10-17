/** 扫榜插件 · 领域类型（词汇一律对齐 docs/rank-scan/CONTEXT.md） */

export type BoardStatus = 'ok' | 'missing' | 'stale' | 'login_required' | 'truncated'
export type ScanOutcome = 'running' | 'completed' | 'cancelled' | 'over_budget' | 'aborted_stalled'
export type Metric = 'rank' | 'value'

export interface Row {
  key: string
  rank: number | null
  value: number | null
  title: string
  author: string | null
  url: string | null
  extra?: Record<string, unknown>
}

export interface BoardResult {
  /** 覆盖站点级 metric（例如刺猬猫的「首订(约)」榜是数值型、其余是名次型） */
  metric?: Metric
  boardId: string
  status: BoardStatus
  rows: Row[]
  requests: number
  durationMs: number
  warnings: string[]
  reason?: string
  /** ★ 票 29：这一榜的补全（enrich）被超时/失败打断 —— 行是榜单原始数据，可在面板重试补全 */
  enrichIncomplete?: boolean
  /**
   * ★ 2026-10-17：**这一榜自己的**抓取时刻（ISO 绝对时刻）。
   *   以前面板「上次抓取」取的是整轮扫描记录的 finishedAt ⇒ 20 个榜全显示同一个时间
   *   （比如番茄 08:30 那一轮），看着像「按站抓取没生效」。只有成功抓到的榜才写。
   */
  capturedAt?: string
  /**
   * ★ 2026-10-17（数据正确性）：**这份内容自己声称的日期**（页面日期）。
   *   番茄/起点图这类站对历史 URL 仍返回「当下」榜面 —— 这个字段是唯一能核对
   *   「抓到的是不是那一天的榜面」的信号。/day 与 /repair 写历史日期前必须比对它。
   */
  contentDate?: string | null
}

export interface ScanRecord {
  dataDate: string
  startedAt: string
  finishedAt: string | null
  trigger: 'manual' | 'timer'
  /** 第几次扫描（同日重试会 +1） */
  attempt: number
  outcome: ScanOutcome
  progress: { done: number; total: number }
  heartbeatAt: string
  budget: Budget
  boards: BoardResult[]
  warnings: string[]
}

export interface Budget {
  maxRequests: number
  maxDurationMs: number
  requestTimeoutMs: number
  boardTimeoutMs: number
  noProgressMs: number
  /**
   * ★ 票 29：单榜**补全**（enrich）的时长上限。补全是「逐本进书页」的长任务，
   * 旧实现没有超时也没有取消 ⇒ 一个挂住的请求能把整轮扫描拖到小时级、锁不释放。
   * 超时不等于失败：保留榜单原始行 + 记一条警告，面板「补全本榜」可以重试。
   */
  enrichTimeoutMs: number
}

export const DEFAULT_BUDGET: Budget = {
  maxRequests: 600,
  maxDurationMs: 15 * 60 * 1000,
  requestTimeoutMs: 15 * 1000,
  boardTimeoutMs: 90 * 1000,
  noProgressMs: 120 * 1000,
  enrichTimeoutMs: 5 * 60 * 1000,
}

export interface Snapshot {
  boardId: string
  dataDate: string
  metric: Metric
  rows: Row[]
}

export interface BoardCtx {
  now(): Date
  signal: AbortSignal
  requestTimeoutMs: number
}

/** 站点适配器 = 测试 seam 的注入点 */
export interface SiteAdapter {
  id: string
  site: string
  metric: Metric
  boards: string[]
  fetchBoard(boardId: string, ctx: BoardCtx): Promise<BoardResult>
  /**
   * 可选：数据日期 → **期望的内容日期**（该榜把 dataDate 当「扫描日」时，页面应当承载哪一天的榜面）。
   * 声明了才允许按历史日期抓取落盘（如起点图首订锚 n-1）；未声明 = 该站没有可核对的历史页，
   * /day 与 /repair 一律拒绝写历史日期（见 index.ts 的 dayWriteVerdict）。
   */
  contentDateFor?(boardId: string, dataDate: string): string | null
  /** 可选：抓完后补字段（如书页收藏/字数）。只在 runScan 传 enrich: true 时调用。 */
  enrich?(boardId: string, rows: Row[], ctx: BoardCtx): Promise<{ rows: Row[]; requests: number }>
  /** 可选：单本取统计（供书页缓存跳过重复下载）。一次调用 = 一次请求，失败抛错、不内部重试。 */
  fetchBookStats?(bid: string, ctx: BoardCtx): Promise<{ collect: number | null; wordsCnt: number | null }>
}

/** 抓取异常：适配器用它表达「没抓到 / 可疑 / 需登录」，由 runScan 映射为状态 */
export class MissingError extends Error {}
export class StaleError extends Error {}
export class LoginRequiredError extends Error {}