export async function boundedFetch(url, opts = {}) {
    const ms = Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
    const ctl = new AbortController();
    const abort = (why) => { try {
        ctl.abort(new Error(why));
    }
    catch {
        try {
            ctl.abort();
        }
        catch { /* 忽略 */ }
    } };
    const ext = opts.signal;
    const onExtAbort = () => abort('cancelled');
    if (ext) {
        if (ext.aborted)
            onExtAbort();
        else if (typeof ext.addEventListener === 'function')
            ext.addEventListener('abort', onExtAbort, { once: true });
    }
    const timer = setTimeout(() => abort('timeout after ' + ms + 'ms'), ms);
    try {
        return await fetch(url, { headers: opts.headers, signal: ctl.signal });
    }
    finally {
        clearTimeout(timer);
        if (ext && typeof ext.removeEventListener === 'function')
            ext.removeEventListener('abort', onExtAbort);
    }
}
//# sourceMappingURL=bounded-fetch.js.map