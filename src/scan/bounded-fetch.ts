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
import { defaultRequestGate } from './rate-limit.js'

export interface BoundedFetchOpts {
  rateLimit?: boolean
  timeoutMs?: number
  signal?: AbortSignal | null
  headers?: Record<string, string>
}

export async function boundedFetch(url: string, opts: BoundedFetchOpts = {}): Promise<any> {
  const ms = Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000
  if (opts.rateLimit) await defaultRequestGate().beforeRequest()
  const ctl = new AbortController()
  const abort = (why: string) => { try { ctl.abort(new Error(why)) } catch { try { ctl.abort() } catch { /* 忽略 */ } } }
  const ext: any = opts.signal
  const onExtAbort = () => abort('cancelled')
  if (ext) {
    if (ext.aborted) onExtAbort()
    else if (typeof ext.addEventListener === 'function') ext.addEventListener('abort', onExtAbort, { once: true })
  }
  let timer: ReturnType<typeof setTimeout>
  let rejectAbort: (error: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(ctl.signal.reason instanceof Error ? ctl.signal.reason : new Error('cancelled'))
  ctl.signal.addEventListener('abort', onAbort, { once: true })
  if (ctl.signal.aborted) onAbort()
  timer = setTimeout(() => abort('timeout after ' + ms + 'ms'), ms)
  try {
    // fetch resolves on headers; keep the deadline through body consumption.
    return await Promise.race([aborted, (async () => {
      const response = await fetch(url, { headers: opts.headers as any, signal: ctl.signal })
      const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json())
      return new Proxy(response, { get(target, key) {
        if (key === 'text') return async () => text
        if (key === 'json') return async () => JSON.parse(text)
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })()])
  } finally {
    ctl.signal.removeEventListener('abort', onAbort)
    clearTimeout(timer)
    if (ext && typeof ext.removeEventListener === 'function') ext.removeEventListener('abort', onExtAbort)
  }
}
