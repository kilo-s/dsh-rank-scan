/**
 * 更新链路里**真正碰网络与文件**的那一层（可注入 fetcher ⇒ 离线可测）。
 *
 * 分工：
 *   - `update-check.ts`：纯判定（版本比较、能力三态、五态状态机）；
 *   - `update.ts`（本文件）：取自家版本 / 探测 dsh-market 能力 / 查 npm registry / 归一化操作终态。
 *
 * 三条纪律（与 update-check.ts 的注释同源）：
 *   ① 一切网络调用**有超时**，失败一律退化成「查不到」，**绝不抛出到路由层**；
 *   ② 探测不到市场 ⇒ `market: null`（面板只读降级），不当错误；
 *   ③ 自己**不实现**安装/重启：更新与重启只通过 dsh-market 的公开 API 发起（桌面/被监管宿主由它裁决）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planUpdateCheck } from './update-check.js';
/**
 * 本插件自己的版本：从包根 package.json 读。
 *
 * ★ 2026-10-16 实测修正：**宿主侧没有 `__dirname`**（插件是 ESM，全仓唯一那处用它就是我新写的路由，
 *   一上线就 500 `__dirname is not defined`）。所以入参接受 **`import.meta.url` 的 file:// URL** 或目录：
 *   自带 lib 的插件，模块在 `lib/index.js` ⇒ 从 `lib/` 回上一层就是包根。
 */
export function readOwnVersion(from) {
    let base = String(from || '');
    if (base.startsWith('file:')) {
        try {
            base = dirname(fileURLToPath(base));
        }
        catch {
            base = '';
        }
    }
    for (const rel of ['..', '.']) {
        try {
            const j = JSON.parse(readFileSync(join(base, rel, 'package.json'), 'utf8'));
            if (j && j.version)
                return { version: String(j.version), name: j.name ? String(j.name) : null };
        }
        catch { /* 试下一层 */ }
    }
    return { version: null, name: null };
}
/** 市场能力端点（固定同源路径；用它而不是猜其它路径） */
export const MARKET_CAPABILITIES = '/dsh-market/api/v1/capabilities';
/**
 * 探测 dsh-market。返回 null = 没装 / 不可用 / 不支持 ⇒ 面板只读降级。
 * cookie 必须**原样透传**（新版宿主对 `/dsh-market/*` 也做浏览器登录校验，缺 cookie 会 401）。
 */
export async function probeMarket(fetchImpl, opts) {
    try {
        const res = await fetchImpl(opts.origin + MARKET_CAPABILITIES, {
            headers: { Accept: 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
            signal: AbortSignal.timeout(opts.timeoutMs == null ? 4000 : opts.timeoutMs),
        });
        if (!res || res.ok === false)
            return null;
        const j = await res.json();
        if (!j)
            return null;
        const eps = j.endpoints || {};
        const feats = j.features || {};
        // 只认它自己声明的端点路径；缺失就当作不支持（交给 updateAvailability 判三态）
        return {
            apiVersion: j.apiVersion || j.version || (j.schema ? '1' : null),
            endpoints: {
                capabilities: MARKET_CAPABILITIES,
                updates: eps.updates || eps.updateCheck || null,
                updateOperation: eps.operations || eps.operation || null,
                restart: eps.restart || null,
            },
            restartSupported: j.restart && typeof j.restart.supported === 'boolean' ? j.restart.supported : null,
            canUpdate: typeof feats.update === 'boolean' ? feats.update : feats.updates === true ? true : (feats.update === false ? false : null),
        };
    }
    catch {
        return null;
    }
}
/** 查 npm registry 的 latest（市场不可用时的降级读数）。拿不到 ⇒ null（面板显示「查不到」，不报错） */
export async function fetchNpmLatest(fetchImpl, packageName, timeoutMs = 6000) {
    const enc = String(packageName).replace('/', '%2F'); // scoped 包名要转义斜杠
    try {
        const res = await fetchImpl('https://registry.npmjs.org/' + enc + '/latest', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res || res.ok === false)
            return { version: null, reason: 'registry HTTP ' + ((res && res.status) || '?') };
        const j = await res.json();
        return { version: j && j.version ? String(j.version) : null, reason: j && j.version ? 'ok' : 'no version field' };
    }
    catch (e) {
        return { version: null, reason: 'registry 不可达：' + String(e).slice(0, 60) };
    }
}
/** 归一化 dsh-market 的操作对象 → 本插件状态机认识的形状（字段缺失一律 null，不猜） */
export function normalizeOperation(j) {
    if (!j || typeof j !== 'object')
        return null;
    const st = String(j.state || j.status || '');
    const allowed = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'rolled-back'];
    if (allowed.indexOf(st) < 0)
        return null;
    return {
        state: st,
        beforeVersion: j.beforeVersion == null ? null : String(j.beforeVersion),
        installedVersion: j.installedVersion == null ? null : String(j.installedVersion),
        targetVersion: j.targetVersion == null ? null : String(j.targetVersion),
        refreshRequired: typeof j.refreshRequired === 'boolean' ? j.refreshRequired : null,
        restartRequired: typeof j.restartRequired === 'boolean' ? j.restartRequired : null,
        retryable: typeof j.retryable === 'boolean' ? j.retryable : null,
        code: j.code == null ? null : String(j.code),
        message: j.message == null ? (j.error == null ? null : String(j.error)) : String(j.message),
    };
}
/**
 * 组装面板要的一次完整回答（纯计算 + 已取回的数据）。
 * `market` 与 `npmLatest` 都由调用方先取好（便于离线测试与超时隔离）。
 */
export function buildUpdateView(input) {
    // 有市场就用市场给的版本；否则用 npm 的（降级读数）
    const latest = input.marketLatest != null ? input.marketLatest : (input.npmLatest != null ? input.npmLatest : null);
    const latestSource = input.marketLatest != null ? 'market' : input.npmLatest != null ? 'npm' : null;
    const base = {
        current: input.current,
        latest,
        source: latestSource === 'market' ? 'dsh-market' : latestSource === 'npm' ? 'npm' : null,
        provider: input.market,
        operation: input.operation || null,
    };
    return { ...planUpdateCheck(base), latestSource, npmReason: input.npmReason == null ? null : String(input.npmReason) };
}
//# sourceMappingURL=update.js.map