import { DEFAULT_BUDGET, LoginRequiredError, MissingError, StaleError, } from './types.js';
const pad = (n) => String(n).padStart(2, '0');
/** 数据日期 = 本地自然日（忌用 toISOString：北京时间凌晨会差一天） */
export function localDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function stamp(d) {
    return localDate(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '+08:00';
}
/** 唯一的扫描用例（测试 seam）：依赖全部注入 */
export async function runScan(deps) {
    const budget = { ...DEFAULT_BUDGET, ...(deps.budget || {}) };
    const pollMs = typeof deps.pollMs === 'number' ? deps.pollMs : 500;
    const betweenBoardsMs = typeof deps.betweenBoardsMs === 'number' ? deps.betweenBoardsMs : 0;
    const maxSiteFailures = typeof deps.maxSiteFailures === 'number' ? deps.maxSiteFailures : 3;
    const maxRetryPerBoard = typeof deps.maxRetryPerBoard === 'number' ? deps.maxRetryPerBoard : 2;
    const start = deps.clock.now();
    const dataDate = localDate(start);
    // 扫描锁：拿不到就说明已有一轮在跑
    let crashedNote = null;
    if (deps.store.acquireLock) {
        const got = await deps.store.acquireLock({ startedAt: stamp(start), heartbeatAt: stamp(start), pid: process.pid }, budget.noProgressMs);
        if (!got.ok) {
            const prev = deps.store.readScan ? await deps.store.readScan(dataDate) : null;
            if (prev)
                return { ...prev, warnings: [...prev.warnings, '已有扫描在进行中，本次未启动'] };
            throw new Error('已有扫描在进行中（扫描锁未释放）');
        }
        if (got.previous)
            crashedNote = '检测到上一次扫描残留（心跳过期）⇒ 判为 crashed 并已接管';
    }
    // 重试模式：读当天记录 → 只挑非 ok 的榜
    let previous = null;
    let selected = null;
    if (deps.retryNonOk && deps.store.readScan) {
        previous = await deps.store.readScan(dataDate);
        if (previous)
            selected = new Set(previous.boards.filter((b) => b.status !== 'ok').map((b) => b.boardId));
        if (previous && selected && selected.size === 0) {
            return { ...previous, warnings: [...previous.warnings, '没有需要重试的榜（当天全部 ok）'] };
        }
    }
    const record = previous
        ? {
            ...previous,
            startedAt: stamp(start),
            finishedAt: null,
            outcome: 'running',
            progress: { done: 0, total: 0 },
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
            progress: { done: 0, total: 0 },
            heartbeatAt: stamp(start),
            budget,
            boards: [],
            warnings: [],
            attempt: 1,
        };
    const baseBoards = previous ? [...previous.boards] : [];
    const jobs = [];
    for (const site of deps.sites) {
        for (const boardId of site.boards) {
            if (deps.boards && !deps.boards.includes(boardId))
                continue;
            if (selected && !selected.has(boardId))
                continue;
            jobs.push({ site, boardId });
        }
    }
    record.progress.total = jobs.length;
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted || (deps.signal ? deps.signal.aborted : false);
    const poller = setInterval(() => {
        deps.store
            .getCancelFlag()
            .then((f) => { if (f)
            abort.abort(); })
            .catch(() => { });
    }, pollMs);
    const results = new Map();
    let jobIndex = 0;
    const siteFailures = new Map();
    let requests = 0;
    let lastProgress = start.getTime();
    try {
        for (const job of jobs) {
            if (jobIndex > 0 && betweenBoardsMs > 0)
                await sleep(betweenBoardsMs);
            jobIndex += 1;
            const now = deps.clock.now();
            if (cancelled() || (await deps.store.getCancelFlag())) {
                if (!abort.signal.aborted)
                    abort.abort();
                record.outcome = 'cancelled';
                results.set(job.boardId, truncated(job.boardId, 'cancelled'));
                continue;
            }
            if (requests >= budget.maxRequests || now.getTime() - start.getTime() > budget.maxDurationMs) {
                record.outcome = 'over_budget';
                results.set(job.boardId, truncated(job.boardId, 'over_budget'));
                continue;
            }
            const sinceProgress = now.getTime() - lastProgress;
            if (sinceProgress > budget.noProgressMs) {
                record.outcome = 'aborted_stalled';
                results.set(job.boardId, truncated(job.boardId, 'no_progress'));
                continue;
            }
            if ((siteFailures.get(job.site.id) || 0) >= maxSiteFailures) {
                results.set(job.boardId, truncated(job.boardId, 'site_unhealthy'));
                continue;
            }
            if (selected && deps.store.getRetryCount) {
                const n = await deps.store.getRetryCount(job.boardId, dataDate);
                if (n >= maxRetryPerBoard) {
                    results.set(job.boardId, truncated(job.boardId, 'retry_limit'));
                    continue;
                }
            }
            const t0 = Date.now();
            record.heartbeatAt = stamp(deps.clock.now());
            let res;
            try {
                const boardCtx = {
                    now: () => deps.clock.now(),
                    signal: abort.signal,
                    requestTimeoutMs: budget.requestTimeoutMs,
                };
                const fetched = await withTimeout(job.site.fetchBoard(job.boardId, boardCtx), Math.min(budget.boardTimeoutMs, Math.max(1, budget.noProgressMs - sinceProgress)), job.boardId);
                let rows = fetched.rows;
                let enrichRequests = 0;
                let enrichIncomplete = false;
                if (deps.enrich && job.site.enrich && rows.length && !cancelled()) {
                    // ★ 票 29：补全纳入超时（旧实现无超时无取消 ⇒ 整轮可挂到小时级、锁不释放）。
                    //   超时/失败**不判本榜失败**：保留榜单原始行 + 记警告，面板「补全本榜」可重试。
                    try {
                        const e = await withTimeout(job.site.enrich(fetched.boardId, rows, boardCtx), budget.enrichTimeoutMs, fetched.boardId + ' 补全');
                        rows = e.rows;
                        enrichRequests = e.requests;
                    }
                    catch (err) {
                        enrichIncomplete = true;
                        record.warnings.push('补全未完成（' + fetched.boardId + '）：' + String(err).slice(0, 80) + ' —— 可点「补全本榜」重试');
                    }
                }
                requests += fetched.requests + enrichRequests;
                res = { ...fetched, rows, enrichIncomplete };
                if (res.rows.length) {
                    await deps.store.writeSnapshot({
                        boardId: res.boardId,
                        dataDate: record.dataDate,
                        metric: res.metric || job.site.metric,
                        rows,
                    });
                }
            }
            catch (e) {
                requests += 1;
                res = classify(job.boardId, e, Date.now() - t0);
            }
            results.set(job.boardId, res);
            siteFailures.set(job.site.id, res.status === 'ok' ? 0 : (siteFailures.get(job.site.id) || 0) + 1);
            if (selected && res.status === 'ok' && deps.store.bumpRetryCount) {
                await deps.store.bumpRetryCount(job.boardId, dataDate);
            }
            record.progress.done += 1;
            lastProgress = deps.clock.now().getTime();
            record.heartbeatAt = stamp(deps.clock.now());
            if (deps.store.heartbeatLock)
                await deps.store.heartbeatLock(record.heartbeatAt);
            deps.onProgress?.(record);
        }
    }
    finally {
        clearInterval(poller);
        if (deps.store.releaseLock)
            await deps.store.releaseLock();
    }
    // 合并：重试模式下保留未重跑的榜（已 ok 的），替换重跑过的
    const merged = [];
    const seen = new Set();
    for (const b of baseBoards) {
        merged.push(results.get(b.boardId) || b);
        seen.add(b.boardId);
    }
    for (const [boardId, r] of results) {
        if (!seen.has(boardId))
            merged.push(r);
    }
    record.boards = merged;
    if (record.outcome === 'running')
        record.outcome = 'completed';
    if (crashedNote)
        record.warnings.push(crashedNote);
    const hasSiteUnhealthy = record.boards.some((b) => b.reason === 'site_unhealthy');
    if (hasSiteUnhealthy)
        record.warnings.push('有站点连续失败已熔断，本站剩余榜本次未抓');
    record.finishedAt = stamp(deps.clock.now());
    record.heartbeatAt = record.finishedAt;
    await deps.store.writeScan(record);
    return record;
}
function truncated(boardId, reason) {
    return { boardId, status: 'truncated', rows: [], requests: 0, durationMs: 0, warnings: [], reason };
}
function classify(boardId, e, durationMs) {
    const reason = e instanceof Error ? e.message : String(e);
    const base = { boardId, rows: [], requests: 1, durationMs, warnings: [], reason };
    if (e instanceof MissingError)
        return { ...base, status: 'missing' };
    if (e instanceof StaleError)
        return { ...base, status: 'stale' };
    if (e instanceof LoginRequiredError)
        return { ...base, status: 'login_required' };
    return { ...base, status: 'missing' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, label) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('board timeout: ' + label)), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
    });
}
//# sourceMappingURL=run.js.map