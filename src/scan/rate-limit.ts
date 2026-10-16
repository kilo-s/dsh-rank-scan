/**
 * ★ 票 50：全局限速器 —— 「相邻两次**真实请求** ≥1s」下沉到统一请求通道。
 *
 * 背景（审计-2 实证）：采集纪律写着「限速 1s/请求」（spec-扫榜插件-v1:87，不可协商），
 * 但实现里只有**榜与榜之间**的 `betweenBoardsMs: 500`（src/index.ts），而
 *   - 番茄分类榜翻页（offset 步进 10）在同一循环里 0ms 连发；
 *   - 刺猬猫周期榜 `/{page}` 翻页同样 0ms 连发；
 *   - 起点图三江「空期回退上一期」最多 3 次请求也是连发。
 * 攒到 100 条时一轮就是 9 次连发 ⇒ 站点侧看到的是突发流量。
 *
 * 口径（Q34 冻结）：限速不看「榜」，只看**真实请求**。所以闸门做成模块级单例：
 * 所有站点适配器的默认请求包装共用同一个闸门 —— 跨站、跨榜、跨翻页都在同一条时间线上。
 *
 * 可测性：`nowMs` / `sleep` 全部可注入 ⇒ 测试用假时钟 + 假 sleep 断言
 * 「相邻真实请求间隔 ≥1s」，**不真等 1 秒**；适配器也可以传自己的 `rateGate`（测试替身不碰全局）。
 *
 * 边界：闸门只管**请求通道**。适配器注入的 `fetchText`/`fetchJson`（测试替身、补全注入）
 * 刻意**不带闸门** —— 通道是「真实网络请求」，不是「调用适配器」。
 */

/** 采集纪律：相邻两次真实请求的最小间隔（spec-扫榜插件-v1:87「限速 1s/请求（不可协商）」） */
export const MIN_REQUEST_INTERVAL_MS = 1000

export interface RateLimitDeps {
  /** 当前时刻（毫秒）。默认 `Date.now`；测试注入假时钟 */
  nowMs?: () => number
  /** 等待实现。默认 `setTimeout`；测试注入假 sleep（同时推进假时钟） */
  sleep?: (ms: number) => Promise<void>
  /** 最小间隔（毫秒），默认 {@link MIN_REQUEST_INTERVAL_MS}；0 = 关闭限速 */
  minIntervalMs?: number
}

export interface RequestGate {
  /** 真实请求前的闸门：必要时等待，然后**登记本次请求时刻**；返回实际等待的毫秒数 */
  beforeRequest(): Promise<number>
  /** 最近一次登记的真实请求时刻（从未请求过 ⇒ null） */
  lastRequestAt(): number | null
  /** 清空登记（仅测试/诊断用） */
  reset(): void
}

/**
 * 纯函数：给定「上一次真实请求时刻」与「现在」，返回本次还需要等待的毫秒数（0 = 直接发）。
 * 时钟回拨（now < lastAt）按最小间隔处理 —— 绝不因为时钟跳一下就允许连发。
 */
export function waitMsBefore(
  lastAtMs: number | null | undefined,
  nowMs: number,
  minIntervalMs: number = MIN_REQUEST_INTERVAL_MS,
): number {
  if (lastAtMs == null || !Number.isFinite(lastAtMs) || !Number.isFinite(nowMs)) return 0
  const min = Number.isFinite(minIntervalMs) && minIntervalMs > 0 ? minIntervalMs : 0
  if (min === 0) return 0
  const wait = lastAtMs + min - nowMs
  return wait > 0 ? Math.ceil(wait) : 0
}

/** 建一个闸门（`nowMs`/`sleep`/`minIntervalMs` 可注入） */
export function createRequestGate(deps: RateLimitDeps = {}): RequestGate {
  const nowMs = deps.nowMs || (() => Date.now())
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const min = deps.minIntervalMs == null ? MIN_REQUEST_INTERVAL_MS : deps.minIntervalMs
  let lastAt: number | null = null
  let tail: Promise<unknown> = Promise.resolve()
  const enter = async (): Promise<number> => {
      const t0 = nowMs()
      const wait = waitMsBefore(lastAt, t0, min)
      if (wait > 0) await sleep(wait)
      const t1 = wait > 0 ? nowMs() : t0
      // 登记时刻取「实际发请求的时刻」与「上次 + 最小间隔」的较大者：
      // 假 sleep 不推进时钟（或真实 sleep 少睡了几毫秒）时也不会退化成 0 间隔
      const floor = lastAt == null ? 0 : lastAt + (Number.isFinite(min) && min > 0 ? min : 0)
      lastAt = Math.max(t1, floor)
      return wait
  }
  return {
    beforeRequest() {
      const next = tail.then(enter)
      tail = next.catch(() => {})
      return next
    },
    lastRequestAt: () => lastAt,
    reset: () => { lastAt = null },
  }
}

let globalGate: RequestGate | null = null
let globalMinIntervalMs = MIN_REQUEST_INTERVAL_MS

/** 全局限速器（懒建）：所有适配器的默认请求通道共用它 */
export function defaultRequestGate(): RequestGate {
  if (!globalGate) globalGate = createRequestGate({ minIntervalMs: globalMinIntervalMs })
  return globalGate
}

/**
 * ★ 2026-10-17：(3) 把全局最小间隔做成**可配置**（默认仍是 1000ms，即原纪律）。
 * 为什么可以配：那个 1s 没有外部依据，是本项目当年的保守取整（spec-扫榜插件-v1:87 是我们自己写的规格，
 * 不是站点的要求）；它的唯一真实保护是「别把站点打毛了」。所以把它降格成配置项 + 面板可见的取舍，
 * 默认不打折，需要时由使用者显式下调（下限 200ms 兜底，防止手滑写成 0 变成连发）。
 * 注意：改的是「真实请求通道」的间隔，不碰采集纪律里的「每日 1 次」。
 */
export function setMinRequestIntervalMs(ms: number | undefined | null): number {
  const n = Number(ms)
  globalMinIntervalMs = Number.isFinite(n) && n >= 0 ? Math.max(n === 0 ? 0 : 200, n) : MIN_REQUEST_INTERVAL_MS
  globalGate = null // 下次取闸门时按新间隔重建（闸门自身不可变）
  return globalMinIntervalMs
}

/** 当前生效的全局最小间隔（面板/诊断用） */
export function minRequestIntervalMs(): number {
  return globalMinIntervalMs
}

/** 替换全局限速器（测试用；传 null/undefined 恢复懒建的真实实现） */
export function setDefaultRequestGate(gate: RequestGate | null | undefined): void {
  globalGate = gate || null
}

/**
 * 把一个「请求实现」套上闸门：**每个真实请求前**先 await 闸门。
 * `gate` 每次调用都重新解析（默认取当前全局闸门）⇒ 测试可以在建好适配器之后再换闸门。
 */
export function withRateLimit<A extends unknown[], R>(
  impl: (...args: A) => Promise<R>,
  gate: () => RequestGate = defaultRequestGate,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    await gate().beforeRequest()
    return impl(...args)
  }
}