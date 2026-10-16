/**
 * 更新检查 / 一键更新 的**纯逻辑**（2026-10-16）。
 *
 * 定位：本文件**不发请求、不碰文件系统、不知道 dsh-market 的实现细节**。
 * 它只回答三个问题：
 *   ① 装的那版 vs 线上那版，谁新？（版本比较，含预发布）
 *   ② 现在这个宿主能不能「点一下就地更新」？（能力探测结果 → 三态）
 *   ③ 更新跑完了，用户接下来该做什么？（按终态标志给出动作）
 *
 * ★ 为什么坚持「纯」：本插件的对外承诺是「轻量 / 零依赖 / 坏了也没事」，
 *   更新这条链路最容易把别人的环境搞坏（spawn 包管理器、自己换文件、偷偷重启）。
 *   把判定收在一个纯函数里，就能用单测把「不许自己发明进程控制路径」这条钉住：
 *   重启与否**只**取决于宿主/市场回报的 restartRequired + restart.supported。
 *
 * 上游规范：dsh-market 的公开更新 API v1（`GET /dsh-market/api/v1/capabilities` 等）。
 * 状态目前是 beta ⇒ 必须先探测能力再启用变更按钮，探测不到就优雅退化，不许硬赌。
 */
/** 面板要显示的三态：能不能就地更新，为什么不能 */
export type UpdateAvailability = 'ok' | 'no-provider' | 'provider-unsupported';
export interface ProviderCaps {
    /** 探测到市场提供的版本（决定用哪套字段解析） */
    apiVersion?: string | null;
    /** 端点路径（来自 capabilities.endpoints），缺哪条就少哪条能力 */
    endpoints?: {
        updates?: string | null;
        updateOperation?: string | null;
        restart?: string | null;
        capabilities?: string | null;
    } | null;
    /** 市场自己是否支持重启宿主（false ⇒ 客户端**必须隐藏**重启按钮） */
    restartSupported?: boolean | null;
    /** 市场是否能就地更新（capabilities.features 里与更新相关的位） */
    canUpdate?: boolean | null;
}
export interface UpdateCheckInput {
    /** 本插件当前版本（读自己的 package.json） */
    current: string;
    /** 线上最新版本；null = 还没查到 / 查不到 */
    latest: string | null;
    /** 版本来源：npm 包 or 仓库（面板要如实标注） */
    source?: string | null;
    /** 能力探测结果；null/undefined = 没有探测到任何更新提供方 */
    provider?: ProviderCaps | null;
    /** 上一次更新操作的终态（可选） */
    operation?: UpdateOperationOutcome | null;
}
export interface UpdateOperationOutcome {
    state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled-back';
    beforeVersion?: string | null;
    installedVersion?: string | null;
    targetVersion?: string | null;
    /** 需要刷新页面才能生效 */
    refreshRequired?: boolean | null;
    /** 需要重启宿主才能生效 */
    restartRequired?: boolean | null;
    /** 可重试？（失败时给出「再试一次」按钮的依据） */
    retryable?: boolean | null;
    /** 稳定失败码 / 人话消息 */
    code?: string | null;
    message?: string | null;
}
export interface UpdateCheckResult {
    /** 面板状态机：unavailable 只读展示 / latest 已最新 / update-available 可更新 / busy 进行中 / failed 失败 */
    state: 'unavailable' | 'latest' | 'update-available' | 'busy' | 'failed';
    /** 能不能就地更新（按钮可点） */
    canUpdateInPlace: boolean;
    /** 为什么不能（人话；不可用时面板直接显示这句） */
    reason: string | null;
    current: string;
    latest: string | null;
    /** 用户下一步该做什么：none / refresh / restart / manual */
    action: 'none' | 'refresh' | 'restart' | 'manual';
    /** 面板上「更新」按钮的文案 */
    buttonLabel: string;
}
/**
 * 版本比较：a > b ⇒ 1，a < b ⇒ -1，相等 ⇒ 0。
 * 支持 semver 与「数字.数字.数字[-预发布]」；预发布**低于**同号正式版（1.0.0-rc.1 < 1.0.0）。
 * 拿不准时**保守判「不更新」**（相等）——宁可少提示一次，也不给用户一个点下去会降级的按钮。
 */
export declare function compareVersions(a: string, b: string): number;
/** 能力探测 → 三态。**没有提供方 / 提供方不支持就地更新**都不算错，是正常的降级。 */
export declare function updateAvailability(p?: ProviderCaps | null): {
    availability: UpdateAvailability;
    reason: string | null;
};
/**
 * 主判定（纯函数、零副作用）。
 * ★ 一条硬规则写在这里：**永远不自己决定重启**。
 *   只有「终态要求重启 + 提供方支持重启」同时成立，action 才是 'restart'；
 *   否则退回 'manual'（面板文案：请自己重启 DSH）。
 */
export declare function planUpdateCheck(input: UpdateCheckInput): UpdateCheckResult;
/** 面板展示用的一句话（纯函数：给定状态机结果与来源，产出人话） */
export declare function describeCheck(r: UpdateCheckResult, source?: string | null): string;
