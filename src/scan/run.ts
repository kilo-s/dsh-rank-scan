import {
  DEFAULT_BUDGET,
  LoginRequiredError,
  MissingError,
  StaleError,
  type BoardResult,
  type Budget,
  type ScanRecord,
  type SiteAdapter,
  type Snapshot,
} from './types.js'

export interface Clock { now(): Date }

export interface LockInfo {
  startedAt: string
  heartbeatAt: string
  pid?: number
}

export interface ScanStore {
  getCancelFlag(): Promise<boolean>
  setCancelFlag(v: boolean): Promise<void>
  writeSnapshot(s: Snapshot): Promise<void>
  writeScan(r: ScanRecord): Promise<void>
  /** 读当天已有扫描记录（重试模式要用；缺省视为不支持） */
  readScan?(dataDate: string): Promise<ScanRecord | null>
  /** 某榜某天的重试次数（缺省视为不限） */
  getRetryCount?(boardId: string, dataDate: string): Promise<number>
  bumpRetryCount?(boardId: string, dataDate: string): Promise<void>
  /** 扫描锁：同一时刻只允许一轮。心跳过期（> staleMs）视为上一轮 crashed，可接管 */
  acquireLock?(info: LockInfo, staleMs: number): Promise<{ ok: boolean; previous: LockInfo | null }>
  heartbeatLock?(at: string): Promise<void>
  releaseLock?(): Promise<void>
}

export interface RunScanDeps {
  sites: SiteAdapter[]
  clock: Clock
  store: ScanStore
  budget?: Partial<Budget>
  trigger?: 'manual' | 'timer'
  /** 只扫这些榜（默认全部） */
  boards?: string[]
  /** 是否补字段（默认关闭；开启会显著增加请求数） */
  enrich?: boolean
  /** 只重跑当天非 ok 的榜（已 ok 的榜不动），结果并回同一天的记录 */
  retryNonOk?: boolean
  /** 同一个站连续失败到该次数 ⇒ 熔断：本站剩余榜不再请求 */
  maxSiteFailures?: number
  /** 每榜每天最大重试次数（默认 2） */
  maxRetryPerBoard?: number
  /** 取消标志轮询间隔（默认 500ms；测试可调小） */
  pollMs?: number
  /** 榜与榜之间的最小间隔（默认 0；采集纪律建议 1000ms） */
  betweenBoardsMs?: number
  /** ★ 2026-10-17 失败榜自动重试前的等待（默认 5000ms；测试传 0） */
  retryDelayMs?: number
  /**
   * ★ 2026-10-22（工作包 A）：这次扫描是「按站/单榜的部分扫描」。
   *   只影响记录里的 batch 元信息（scan.json 仍是批次记录）；当天每榜最终状态由
   *   doScan 合并进 <date>/day-index.json，不会因为后一批把前一批覆盖掉。
   */
  partial?: boolean
  /** 部分扫描的站 id（仅为记录与诊断） */
  batchSite?: string | null
  signal?: AbortSignal
  onProgress?: (r: ScanRecord) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 数据日期 = 本地自然日（忌用 toISOString：北京时间凌晨会差一天） */
export function localDate(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * 落盘时间戳 = **绝对时刻**（ISO 8601 UTC）。
 * ★ 审计-2/42（Q23）：旧实现把本地墙钟拼成硬编码 '+08:00'，非 +08 时区下算出的时刻整体偏移
 *   (offset−8h)：UTC+12 以上时，崩溃残留锁的心跳会被判成「未来」⇒ 几小时扫不动且不自愈；
 *   负偏移区则永远判过期、锁形同虚设。数据日期仍走 localDate（不受影响）。
 */
function stamp(d: Date): string {
  return d.toISOString()
}

/** 唯一的扫描用例（测试 seam）：依赖全部注入 */
export async function runScan(deps: RunScanDeps): Promise<ScanRecord> {
  const budget: Budget = { ...DEFAULT_BUDGET, ...(deps.budget || {}) }
  const pollMs = typeof deps.pollMs === 'number' ? deps.pollMs : 500
  const betweenBoardsMs = typeof deps.betweenBoardsMs === 'number' ? deps.betweenBoardsMs : 0
  const maxSiteFailures = typeof deps.maxSiteFailures === 'number' ? deps.maxSiteFailures : 3
  const maxRetryPerBoard = typeof deps.maxRetryPerBoard === 'number' ? deps.maxRetryPerBoard : 2
  /** ★ 2026-10-17：失败榜自动重试前的等待（默认 5s；测试注入 0 免得每个用例白等 5 秒） */
  const retryDelayMs = typeof deps.retryDelayMs === 'number' ? deps.retryDelayMs : 5000
  const start = deps.clock.now()
  const dataDate = localDate(start)

  // 重试模式：读当天记录 → 只挑非 ok 的榜
  // ★ 审计-2/35：这段必须放在**拿锁之前**。旧实现先 acquireLock 再在这里提前 return，
  //   提前返回时锁没释放 ⇒ 之后 120s 内（心跳过期前）所有扫描都被「已有扫描在进行中」挡住，
  //   用户表现为「点了扫描但数据没动」。
  let previous: ScanRecord | null = null
  let selected: Set<string> | null = null
  if (deps.retryNonOk && deps.store.readScan) {
    previous = await deps.store.readScan(dataDate)
    if (previous) selected = new Set(previous.boards.filter((b) => b.status !== 'ok').map((b) => b.boardId))
    if (previous && selected && selected.size === 0) {
      return { ...previous, warnings: [...previous.warnings, '没有需要重试的榜（当天全部 ok）'] }
    }
  }

  // 扫描锁：拿不到就说明已有一轮在跑
  let crashedNote: string | null = null
  if (deps.store.acquireLock) {
    const got = await deps.store.acquireLock(
      { startedAt: stamp(start), heartbeatAt: stamp(start), pid: process.pid },
      budget.noProgressMs,
    )
    if (!got.ok) {
      const prev = deps.store.readScan ? await deps.store.readScan(dataDate) : null
      if (prev) return { ...prev, warnings: [...prev.warnings, '已有扫描在进行中，本次未启动'] }
      throw new Error('已有扫描在进行中（扫描锁未释放）')
    }
    if (got.previous) crashedNote = '检测到上一次扫描残留（心跳过期）⇒ 判为 crashed 并已接管'
  }

  const record: ScanRecord = previous
    ? {
        ...previous,
        startedAt: stamp(start),
        finishedAt: null,
        outcome: 'running',
        progress: { done: 0, total: 0, attempts: 0 },
        heartbeatAt: stamp(start),
        budget,
        attempt: (previous.attempt || 1) + 1,
        warnings: [...previous.warnings],
      }
    : {
        dataDate,
        startedAt: stamp(start),
        finishedAt: null,
        trigger: deps.trigger || 'manual',
        outcome: 'running',
        progress: { done: 0, total: 0, attempts: 0 },
        heartbeatAt: stamp(start),
        budget,
        boards: [],
        warnings: [],
        attempt: 1,
      }
  const baseBoards: BoardResult[] = previous ? [...previous.boards] : []

  const jobs: { site: SiteAdapter; boardId: string }[] = []
  for (const site of deps.sites) {
    for (const boardId of site.boards) {
      if (deps.boards && !deps.boards.includes(boardId)) continue
      if (selected && !selected.has(boardId)) continue
      jobs.push({ site, boardId })
    }
  }
  /**
   * ★ 工作包 A：total = **要跑的不同榜数**；done = 已完成的不同榜数（自动重试不重复计）。
   *   旧实现每次尝试都 done+1，而自动重试会再跑一遍失败榜 ⇒ 日志出现 progress=3/2（体检 P2-A）。
   */
  record.progress.total = jobs.length
  record.progress.done = 0
  record.progress.attempts = 0
  record.batch = { site: deps.batchSite ?? null, partial: !!deps.partial, boards: jobs.map((j) => j.boardId) }

  const abort = new AbortController()
  const cancelled = () => abort.signal.aborted || (deps.signal ? deps.signal.aborted : false)

  const results = new Map<string, BoardResult>()
  /** ★ 工作包 A：已计入 progress.done 的榜（同一榜的自动重试不再 +1） */
  const completedBoards = new Set<string>()
  /** ★ 2026-10-17：本榜本次尝试次数（自动重试用它防「同一个榜反复打」） */
  const boardAttempts = new Map<string, number>()
  let jobIndex = 0
  const siteFailures = new Map<string, number>()
  let requests = 0
  let lastProgress = start.getTime()

  /**
   * ★ 2026-07-17（失败榜自动重试）：把「跑一个榜列表」抽成局部函数，主体循环一行未改。
   * 这样「抓完发现有的榜 fetch failed ⇒ 隔一会儿再打一次」可以复用同一段逻辑与同一套护栏
   * （取消/预算/无进展/站点熔断/重试上限），不需要复制粘贴。
   */
  const runJobs = async (jobsToRun: { site: SiteAdapter; boardId: string }[]): Promise<void> => {
    const poller = setInterval(() => {
      deps.store
        .getCancelFlag()
        .then((f) => { if (f) abort.abort() })
        .catch(() => {})
    }, pollMs)
    try {
    for (const job of jobsToRun) {
      if (jobIndex > 0 && betweenBoardsMs > 0) await sleep(betweenBoardsMs)
      jobIndex += 1
      const now = deps.clock.now()
      if (cancelled() || (await deps.store.getCancelFlag())) {
        if (!abort.signal.aborted) abort.abort()
        // ★ 审计-2/35：取消被**消费**后立刻复位。原来全仓只有置位、没有复位（唯一写点是 /cancel 路由），
        //   于是用户点一次「停止本次」之后，此后每一轮扫描（含定时、含重启后）都在第一个榜被判取消，
        //   只能手删 state/cancel.json。口径：需求确认-扫榜插件-v1:155「再次扫描不受影响」。
        //   放在「消费点」而不是「扫描开始」：预置位的那一轮仍然要被取消（既有行为不变）。
        await deps.store.setCancelFlag(false)
        record.outcome = 'cancelled'
        results.set(job.boardId, truncated(job.boardId, 'cancelled'))
        continue
      }
      if (requests >= budget.maxRequests || now.getTime() - start.getTime() > budget.maxDurationMs) {
        record.outcome = 'over_budget'
        results.set(job.boardId, truncated(job.boardId, 'over_budget'))
        continue
      }
      const sinceProgress = now.getTime() - lastProgress
      if (sinceProgress > budget.noProgressMs) {
        record.outcome = 'aborted_stalled'
        results.set(job.boardId, truncated(job.boardId, 'no_progress'))
        continue
      }
      if ((siteFailures.get(job.site.id) || 0) >= maxSiteFailures) {
        results.set(job.boardId, truncated(job.boardId, 'site_unhealthy'))
        continue
      }
      if (selected && deps.store.getRetryCount) {
        const n = await deps.store.getRetryCount(job.boardId, dataDate)
        if (n >= maxRetryPerBoard) {
          results.set(job.boardId, truncated(job.boardId, 'retry_limit'))
          continue
        }
      }

      const t0 = Date.now()
      boardAttempts.set(job.boardId, (boardAttempts.get(job.boardId) || 0) + 1)
      record.heartbeatAt = stamp(deps.clock.now())
      let res: BoardResult
      try {
        const boardCtx = {
          now: () => deps.clock.now(),
          signal: abort.signal,
          requestTimeoutMs: budget.requestTimeoutMs,
        }
        const fetched = await withTimeout(
          job.site.fetchBoard(job.boardId, boardCtx),
          Math.min(budget.boardTimeoutMs, Math.max(1, budget.noProgressMs - sinceProgress)),
          job.boardId,
        )
        let rows = fetched.rows
        let enrichRequests = 0
        let enrichIncomplete = false
        if (deps.enrich && job.site.enrich && rows.length && !cancelled()) {
          // ★ 票 29：补全纳入超时（旧实现无超时无取消 ⇒ 整轮可挂到小时级、锁不释放）。
          //   超时/失败**不判本榜失败**：保留榜单原始行 + 记警告，面板「补全本榜」可重试。
          try {
            const e = await withTimeout(
              job.site.enrich(fetched.boardId, rows, boardCtx),
              budget.enrichTimeoutMs,
              fetched.boardId + ' 补全',
            )
            rows = e.rows
            enrichRequests = e.requests
          } catch (err) {
            enrichIncomplete = true
            record.warnings.push('补全未完成（' + fetched.boardId + '）：' + String(err).slice(0, 80) + ' —— 可点「补全本榜」重试')
          }
        }
        requests += fetched.requests + enrichRequests
        res = { ...fetched, rows, enrichIncomplete, capturedAt: stamp(deps.clock.now()) }
        if (res.rows.length) {
          await deps.store.writeSnapshot({
            boardId: res.boardId,
            dataDate: record.dataDate,
            metric: res.metric || job.site.metric,
            rows,
          })
        }
      } catch (e) {
        requests += 1
        res = classify(job.boardId, e, Date.now() - t0)
      }
      results.set(job.boardId, res)
      siteFailures.set(job.site.id, res.status === 'ok' ? 0 : (siteFailures.get(job.site.id) || 0) + 1)
      if (selected && res.status === 'ok' && deps.store.bumpRetryCount) {
        await deps.store.bumpRetryCount(job.boardId, dataDate)
      }
      record.progress.attempts = (record.progress.attempts || 0) + 1
      if (!completedBoards.has(job.boardId)) {
        completedBoards.add(job.boardId)
        record.progress.done += 1
      }
      lastProgress = deps.clock.now().getTime()
      record.heartbeatAt = stamp(deps.clock.now())
      if (deps.store.heartbeatLock) await deps.store.heartbeatLock(record.heartbeatAt)
      deps.onProgress?.(record)
    }
    } finally { clearInterval(poller) }
  }

  try {
    await runJobs(jobs)
    /**
     * ★ 2026-10-17（失败榜自动重试）：一次网络抖动不该把整个榜判成 missing 一整天
     * （实测 2026-10-17 凌晨 19 榜里挂了 4 个，全是 5~7 秒内 failure 的 transient fetch failed）。
     * 口径：**失败榜最多自动重试一次**，隔 5 秒再打；成功的榜不动（不需要重抓）。
     * 仍受原有护栏约束：取消立即停、预算/无进展/站点熔断照旧、每榜累计尝试 ≤ maxRetryPerBoard。
     */
    const retryList = jobs.filter((j) => {
      const r = results.get(j.boardId)
      return r && r.status !== 'ok' && (boardAttempts.get(j.boardId) || 0) < maxRetryPerBoard
    })
    if (retryList.length && !cancelled() && requests < budget.maxRequests) {
      record.warnings.push('以下是第一次没抓到的榜，隔 ' + Math.round(retryDelayMs / 1000) + ' 秒自动重试一次：' + retryList.map((j) => j.boardId).join('、'))
      if (retryDelayMs > 0) await sleep(retryDelayMs)
      const before = new Map(([...results]).map(([k, v]) => [k, v.status]))
      await runJobs(retryList)
      const recovered = [...results].filter(([k, v]) => v.status === 'ok' && before.get(k) !== 'ok').map(([k]) => k)
      record.warnings.push(recovered.length
        ? '自动重试成功 ' + recovered.length + ' 个榜：' + recovered.join('、')
        : '自动重试后仍有 ' + retryList.length + ' 个榜没抓到（站点可能真的不可达）')
    }
  } finally {
    // ★ 审计-2/35：兜底 —— 取消可能落在最后一个榜之后（或只被 poller 观察到），那时消费点不会执行
    try { if (await deps.store.getCancelFlag()) await deps.store.setCancelFlag(false) } catch { /* 复位失败不阻塞收尾 */ }
    if (deps.store.releaseLock) await deps.store.releaseLock()
  }

  // 合并：重试模式下保留未重跑的榜（已 ok 的），替换重跑过的
  const merged: BoardResult[] = []
  const seen = new Set<string>()
  for (const b of baseBoards) {
    merged.push(results.get(b.boardId) || b)
    seen.add(b.boardId)
  }
  for (const [boardId, r] of results) {
    if (!seen.has(boardId)) merged.push(r)
  }
  record.boards = merged

  if (record.outcome === 'running') record.outcome = 'completed'
  if (crashedNote) record.warnings.push(crashedNote)
  const hasSiteUnhealthy = record.boards.some((b) => b.reason === 'site_unhealthy')
  if (hasSiteUnhealthy) record.warnings.push('有站点连续失败已熔断，本站剩余榜本次未抓')
  record.finishedAt = stamp(deps.clock.now())
  record.heartbeatAt = record.finishedAt
  await deps.store.writeScan(record)
  return record
}

function truncated(boardId: string, reason: string): BoardResult {
  return { boardId, status: 'truncated', rows: [], requests: 0, durationMs: 0, warnings: [], reason }
}

function classify(boardId: string, e: unknown, durationMs: number): BoardResult {
  const reason = e instanceof Error ? e.message : String(e)
  const base = { boardId, rows: [], requests: 1, durationMs, warnings: [] as string[], reason }
  if (e instanceof MissingError) return { ...base, status: 'missing' }
  if (e instanceof StaleError) return { ...base, status: 'stale' }
  if (e instanceof LoginRequiredError) return { ...base, status: 'login_required' }
  return { ...base, status: 'missing' }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('board timeout: ' + label)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }).catch((e) => { clearTimeout(t); reject(e) })
  })
}