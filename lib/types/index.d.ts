interface PluginCtx {
    tools: {
        register(tool: any): unknown;
    };
    setInterval?(fn: () => void, ms: number): any;
    effect?(setup: () => () => void): void;
    /** cordis 依赖光纤：服务晚绑定（webServer 在运行时注入的实例上常常此时还不可见） */
    inject?(deps: string[], cb: (scope: any) => void): void;
    webServer?: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: any, res: any) => void | Promise<void>;
        }): () => void;
    };
    logger?: {
        info?(msg: string): void;
    };
}
export declare const name = "@dsh-external/dsh-rank-scan";
/**
 * ★ 票 24：**不写硬注入**。写进 inject 的服务只要缺失或改名，cordis 就让整个插件停在 pending，
 * 面板与路由一起消失（宿主只会打一行 "pending (waiting for services: ...)"）。本插件对这三个服务的态度：
 *   - `tools`：从未注册过任何工具 ⇒ 直接删掉；
 *   - `webServer` / `timer`：apply 时直取 + `ctx.inject` 晚绑定（见文件末尾），拿不到就**半激活** ——
 *     面板照常打开，由概览诊断栏告诉你缺哪个能力。
 */
/**
 * ★ 票 24：只声明**没有它就等于没有这个插件**的服务。
 *   实验记录（2026-10-16 实测，注入器判据 = `hasActiveEntry()`，即 loader 里该 entry 的 fiber 是否 active）：
 *     - `['tools','timer','webServer']`（原始）⇒ host ✓
 *     - `['timer','webServer']`（去掉从未使用的 tools）⇒ host ✓
 *     - `['webServer']` ⇒ host ✗（两次复现）｜`[]` ⇒ host ✗｜**完全不导出 inject** ⇒ host ✗
 *   ⇒ 结论（暂时）：本宿主/装载器上「少声明到只剩一个或零个服务」会让 entry 落成 [failed]，
 *     所以**只能做到把 `tools` 摘掉**这一步；`timer`/`webServer` 仍是硬声明。
 *   ⚠ 残留风险（票 24 未完成部分）：若将来 DSH 改名/移除 `timer` 或 `webServer`，本插件会 pending
 *     （宿主日志会写 "pending (waiting for services: ...)"）。晚绑定代码仍在，等宿主行为查明后再动。
 */
export declare const inject: string[];
export declare function apply(ctx: PluginCtx, config: any): void;
export {};
