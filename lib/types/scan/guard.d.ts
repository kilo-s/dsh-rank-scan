/**
 * ★ 2026-10-16（票 23）：插件路由的**来源校验**（同源闸）。
 *
 * 背景：宿主不覆盖 /api/rank-scan/* 的鉴权 —— 实测 `POST /repair` 带 `Content-Type: text/plain`
 * 也能执行（简单请求不触发预检）。浏览器里的恶意页面正是用这一手去打 localhost 上别人的服务。
 *
 * 规则（属主 2026-10-16 口径）：
 *   - 带 Origin/Referer 且 host 与本次请求的 Host 不一致 ⇒ 拒绝；
 *   - Origin 为 `null`（沙箱 iframe / file://）⇒ 拒绝；
 *   - 两者都没有 ⇒ **放行**（curl、PowerShell 脚本、本地进程本来就能直接操作系统，
 *     这道闸门防的是「浏览器里的第三方页面」，不是本机可控进程）；
 *   - localhost 与 127.0.0.1 在端口一致时互认。
 */
export interface SameOriginInput {
    origin?: string | null;
    referer?: string | null;
    host?: string | null;
}
export declare function sameOriginOk(input: SameOriginInput): {
    ok: boolean;
    reason: string;
};
/** 直接吃 Node 的 req.headers（键小写），供路由入口一行调用 */
export declare function requestAllowed(headers: any): {
    ok: boolean;
    reason: string;
};
