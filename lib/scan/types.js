/** 扫榜插件 · 领域类型（词汇一律对齐 docs/rank-scan/CONTEXT.md） */
export const DEFAULT_BUDGET = {
    maxRequests: 600,
    maxDurationMs: 15 * 60 * 1000,
    requestTimeoutMs: 15 * 1000,
    boardTimeoutMs: 90 * 1000,
    noProgressMs: 120 * 1000,
    enrichTimeoutMs: 5 * 60 * 1000,
};
/** 抓取异常：适配器用它表达「没抓到 / 可疑 / 需登录」，由 runScan 映射为状态 */
export class MissingError extends Error {
}
export class StaleError extends Error {
}
export class LoginRequiredError extends Error {
}
//# sourceMappingURL=types.js.map