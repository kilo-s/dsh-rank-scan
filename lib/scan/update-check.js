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
/** 大版段数字比较；两端都不是纯数字时退化成字符串比较（够用：这里只比版本） */
function cmpSegment(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb))
        return na === nb ? 0 : na > nb ? 1 : -1;
    return a === b ? 0 : a > b ? 1 : -1;
}
/**
 * 版本比较：a > b ⇒ 1，a < b ⇒ -1，相等 ⇒ 0。
 * 支持 semver 与「数字.数字.数字[-预发布]」；预发布**低于**同号正式版（1.0.0-rc.1 < 1.0.0）。
 * 拿不准时**保守判「不更新」**（相等）——宁可少提示一次，也不给用户一个点下去会降级的按钮。
 */
export function compareVersions(a, b) {
    const split = (v) => {
        const s = String(v || '').trim().replace(/^v/i, '');
        const dash = s.indexOf('-');
        if (dash < 0)
            return { core: s.split('.'), pre: null };
        return { core: s.slice(0, dash).split('.'), pre: s.slice(dash + 1) };
    };
    const A = split(a);
    const B = split(b);
    const n = Math.max(A.core.length, B.core.length);
    for (let i = 0; i < n; i++) {
        const c = cmpSegment(A.core[i] == null ? '0' : A.core[i], B.core[i] == null ? '0' : B.core[i]);
        if (c !== 0)
            return c;
    }
    if (A.pre == null && B.pre == null)
        return 0;
    if (A.pre == null)
        return 1;
    if (B.pre == null)
        return -1;
    return cmpSegment(A.pre, B.pre);
}
/** 能力探测 → 三态。**没有提供方 / 提供方不支持就地更新**都不算错，是正常的降级。 */
export function updateAvailability(p) {
    if (!p)
        return { availability: 'no-provider', reason: '没探测到更新提供方（未安装 dsh-market）' };
    const ends = p.endpoints || {};
    const hasApi = !!p.apiVersion;
    const hasUpdate = !!ends.updates;
    const hasOp = !!ends.updateOperation;
    if (!hasApi)
        return { availability: 'provider-unsupported', reason: '更新提供方没有回报 API 版本（可能过旧）' };
    if (!hasUpdate || !hasOp)
        return { availability: 'provider-unsupported', reason: '更新提供方缺少更新端点（updates/operations）' };
    if (p.canUpdate === false)
        return { availability: 'provider-unsupported', reason: '更新提供方明确表示本宿主不能就地更新' };
    return { availability: 'ok', reason: null };
}
/**
 * 主判定（纯函数、零副作用）。
 * ★ 一条硬规则写在这里：**永远不自己决定重启**。
 *   只有「终态要求重启 + 提供方支持重启」同时成立，action 才是 'restart'；
 *   否则退回 'manual'（面板文案：请自己重启 DSH）。
 */
export function planUpdateCheck(input) {
    // ★ 空串/纯空白一律归一成「没有版本」：面板显示「检查更新」，而不是拿空串去比出一个假更新
    const current = String(input.current == null ? '' : input.current).trim();
    const latestRaw = input.latest == null ? '' : String(input.latest).trim();
    const latest = latestRaw === '' ? null : latestRaw;
    const { availability, reason } = updateAvailability(input.provider);
    const op = input.operation || null;
    // 进行中：按钮禁用，显示状态机，不提供任何变更动作
    if (op && (op.state === 'queued' || op.state === 'running')) {
        return {
            state: 'busy',
            canUpdateInPlace: false,
            reason: null,
            current,
            latest,
            action: 'none',
            buttonLabel: op.state === 'queued' ? '排队中…' : '更新中…',
        };
    }
    // 失败 / 回滚：说清原因，按可重试性给文案
    if (op && (op.state === 'failed' || op.state === 'cancelled' || op.state === 'rolled-back')) {
        const msg = op.message || (op.state === 'rolled-back' ? '已回滚到更新前的版本' : '更新失败');
        return {
            state: 'failed',
            canUpdateInPlace: availability === 'ok' && op.retryable === true && !!latest && compareVersions(latest, current) > 0,
            reason: msg + (op.code ? '（' + op.code + '）' : ''),
            current,
            latest,
            action: 'none',
            buttonLabel: op.retryable === true ? '重试更新' : '更新失败',
        };
    }
    // 成功：按终态标志决定用户下一步；**不猜**，只读宿主回报
    if (op && op.state === 'succeeded') {
        const installed = op.installedVersion ? String(op.installedVersion) : null;
        const restart = op.restartRequired === true;
        const refresh = op.refreshRequired === true;
        // ★ 只有提供方说支持重启、且真的要求重启，才给重启动作
        const canRestart = restart && !!(input.provider && input.provider.restartSupported === true);
        const action = canRestart ? 'restart' : restart ? 'manual' : refresh ? 'refresh' : 'none';
        // ★ 面板上永远要能看到「现在是哪一版」：installedVersion 缺失时退回本插件自报的 current，
        //   不许出现「更新完成」但看不出装的是哪版（那正是用户最需要确认的一刻）。
        const shown = installed || current;
        return {
            state: 'latest',
            canUpdateInPlace: false,
            reason: installed ? '已更新到 ' + installed : shown ? '更新完成，当前 ' + shown : '更新完成',
            current: shown,
            latest: installed || latest,
            action,
            buttonLabel: action === 'restart' ? '重启 DSH 生效' : refresh ? '刷新页面' : '已最新',
        };
    }
    // 无操作记录：纯比较版本
    if (availability !== 'ok') {
        return {
            state: 'unavailable',
            canUpdateInPlace: false,
            reason,
            current,
            latest,
            action: 'manual',
            buttonLabel: '去下载新版',
        };
    }
    if (latest == null) {
        return { state: 'unavailable', canUpdateInPlace: false, reason: '还没查到线上版本', current, latest: null, action: 'manual', buttonLabel: '检查更新' };
    }
    const cmp = compareVersions(latest, current);
    if (cmp > 0) {
        return { state: 'update-available', canUpdateInPlace: true, reason: null, current, latest, action: 'none', buttonLabel: '更新到 ' + latest };
    }
    return { state: 'latest', canUpdateInPlace: false, reason: null, current, latest, action: 'none', buttonLabel: '已最新' };
}
/** 面板展示用的一句话（纯函数：给定状态机结果与来源，产出人话） */
export function describeCheck(r, source) {
    const src = source ? '（' + source + '）' : '';
    switch (r.state) {
        case 'unavailable': return r.reason || '更新检查不可用';
        case 'latest': return r.reason ? r.reason : '当前 ' + r.current + '，已是最新' + src;
        case 'update-available': return '当前 ' + r.current + ' → 可更新到 ' + (r.latest || '?') + src;
        case 'busy': return r.buttonLabel;
        case 'failed': return '更新未成功：' + (r.reason || '未知原因');
    }
}
//# sourceMappingURL=update-check.js.map