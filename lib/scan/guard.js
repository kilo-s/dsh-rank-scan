const loopbackName = (n) => n === 'localhost' || n === '127.0.0.1' || n === '[::1]' || n === '::1';
const portOf = (h) => (h.includes(':') ? h.slice(h.lastIndexOf(':')) : '');
const nameOf = (h) => h.replace(/:\d+$/, '');
export function sameOriginOk(input) {
    const raw = String(input.origin || '').trim() || String(input.referer || '').trim();
    if (!raw)
        return { ok: true, reason: 'no-origin-header' };
    if (raw === 'null')
        return { ok: false, reason: 'origin-null' };
    let host = '';
    try {
        host = new URL(raw).host;
    }
    catch {
        return { ok: false, reason: 'origin-unparsable:' + raw };
    }
    const expect = String(input.host || '').trim();
    if (!expect)
        return { ok: true, reason: 'no-host-header' };
    if (host === expect)
        return { ok: true, reason: 'same-origin' };
    if (portOf(host) === portOf(expect) && loopbackName(nameOf(host)) && loopbackName(nameOf(expect))) {
        return { ok: true, reason: 'loopback-alias' };
    }
    return { ok: false, reason: 'cross-origin:' + host + '!=' + expect };
}
/** 直接吃 Node 的 req.headers（键小写），供路由入口一行调用 */
export function requestAllowed(headers) {
    const h = headers || {};
    return sameOriginOk({ origin: h.origin, referer: h.referer, host: h.host });
}
//# sourceMappingURL=guard.js.map