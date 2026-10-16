/**
 * ★ 票 29：站点抓取统一走这里 —— **带超时、带取消**。
 *
 * 审计（2026-10-16）发现：五个适配器的默认 fetchText 都是裸 `fetch(url, { headers })`，
 * 既不传 `ctx.signal` 也不设超时 ⇒ 一个挂住的请求能把整轮扫描拖到小时级（undici 默认 headersTimeout 300s），
 * `finishedAt` 永不写、锁不释放；而 `/cancel` 也只在「榜与榜之间」生效。
 *
 * 这里把两件事一起做掉：① 超时（默认 15s，可用站点 ctx.requestTimeoutMs 覆盖）；
 * ② 外部 signal（扫描的取消信号）联级 abort，让在途请求也能被取消。
 */
export interface BoundedFetchOpts {
  timeoutMs?: number
  signal?: AbortSignal | null
  headers?: Record<string, string>
}

export async function boundedFetch(url: string, opts: BoundedFetchOpts = {}): Promise<any> {
  const ms = Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000
  const ctl = new AbortController()
  const abort = (why: string) => { try { ctl.abort(new Error(why)) } catch { try { ctl.abort() } catch { /* 忽略 */ } } }
  const ext: any = opts.signal
  const onExtAbort = () => abort('cancelled')
  if (ext) {
    if (ext.aborted) onExtAbort()
    else if (typeof ext.addEventListener === 'function') ext.addEventListener('abort', onExtAbort, { once: true })
  }
  const timer = setTimeout(() => abort('timeout after ' + ms + 'ms'), ms)
  try {
    return await fetch(url, { headers: opts.headers as any, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
    if (ext && typeof ext.removeEventListener === 'function') ext.removeEventListener('abort', onExtAbort)
  }
}
