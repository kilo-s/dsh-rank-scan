import { type ProviderCaps, type UpdateCheckResult, type UpdateOperationOutcome } from './update-check.js';
export interface FetchLike {
    (url: string, init?: any): Promise<{
        ok?: boolean;
        status?: number;
        json(): Promise<any>;
        text?(): Promise<string>;
    }>;
}
/**
 * 本插件自己的版本：从包根 package.json 读。
 *
 * ★ 2026-10-16 实测修正：**宿主侧没有 `__dirname`**（插件是 ESM，全仓唯一那处用它就是我新写的路由，
 *   一上线就 500 `__dirname is not defined`）。所以入参接受 **`import.meta.url` 的 file:// URL** 或目录：
 *   自带 lib 的插件，模块在 `lib/index.js` ⇒ 从 `lib/` 回上一层就是包根。
 */
export declare function readOwnVersion(from: string): {
    version: string | null;
    name: string | null;
};
/** 市场能力端点（固定同源路径；用它而不是猜其它路径） */
export declare const MARKET_CAPABILITIES = "/dsh-market/api/v1/capabilities";
/**
 * 探测 dsh-market。返回 null = 没装 / 不可用 / 不支持 ⇒ 面板只读降级。
 * cookie 必须**原样透传**（新版宿主对 `/dsh-market/*` 也做浏览器登录校验，缺 cookie 会 401）。
 */
export declare function probeMarket(fetchImpl: FetchLike, opts: {
    origin: string;
    cookie?: string | null;
    timeoutMs?: number;
}): Promise<ProviderCaps | null>;
/** 查 npm registry 的 latest（市场不可用时的降级读数）。拿不到 ⇒ null（面板显示「查不到」，不报错） */
export declare function fetchNpmLatest(fetchImpl: FetchLike, packageName: string, timeoutMs?: number): Promise<{
    version: string | null;
    reason: string;
}>;
/** 归一化 dsh-market 的操作对象 → 本插件状态机认识的形状（字段缺失一律 null，不猜） */
export declare function normalizeOperation(j: any): UpdateOperationOutcome | null;
/**
 * 组装面板要的一次完整回答（纯计算 + 已取回的数据）。
 * `market` 与 `npmLatest` 都由调用方先取好（便于离线测试与超时隔离）。
 */
export declare function buildUpdateView(input: {
    current: string;
    name: string | null;
    market: ProviderCaps | null;
    marketLatest?: string | null;
    npmLatest?: string | null;
    npmReason?: string | null;
    operation?: UpdateOperationOutcome | null;
}): UpdateCheckResult & {
    latestSource: 'market' | 'npm' | null;
    npmReason: string | null;
};
