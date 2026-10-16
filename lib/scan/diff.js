const pad = (n) => String(n).padStart(2, '0');
export function parseLocalDate(s) {
    const parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}
export function addDays(s, n) {
    const d = parseLocalDate(s);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
/** 某个日期所在「周」的期首日 = 本地**本周日**（起点图三江口径，URL 形如 bang/1/6 加期首日，每周日滚一期） */
export function sundayOf(date) {
    const d = parseLocalDate(date);
    d.setDate(d.getDate() - d.getDay()); // 0=周日 ⇒ 减到本周日
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
/**
 * ★ 跨期不可比保护（2026-10-16，收尾缺口 #2）。
 *
 * 为什么要有它：变化列一律拿「上一数据日」当基准，而**周期榜换期当天**上一数据日属于
 * **上一期**：两边的数值根本不是同一件事（三江是「本期的收藏增量」，刺猬猫首订(约)是
 * 「上一期的名次」）⇒ 直接相减（或相减名次）会报出一个**看起来真实、其实毫无意义**的变化。
 *
 * 口径（与属主 2026-10-16 的「显示『新期』/空」一致）：
 *   - 只有**周期榜**需要保护（按 boardId 显式列出；番茄在读周榜由 derive.ts 自己保证期内口径）；
 *   - periodKeyOf 由调用方注入（刺猬猫的「期」= 第三方接口的 issue 号，只有调用方拿得到快照）；
 *   - 没给 periodKeyOf 的周期榜用**本周日**当期键（三江）。
 * 返回可比性判定：crossed = true ⇒ 调用方必须把该榜的变化列判为「不可比」（置空 / 显示「新期」）。
 */
export function guardCrossPeriod(input) {
    const periodic = input.boardId === 'qidiantu.sanjiang' || input.boardId === 'ciweimao.buy.latest';
    const keyOf = (d) => {
        const k = input.periodKeyOf ? input.periodKeyOf(d) : sundayOf(d);
        return k == null ? null : String(k);
    };
    const prevPeriod = input.prevDate ? keyOf(input.prevDate) : null;
    const curPeriod = keyOf(input.date);
    // 只有「有上一数据日」且**期键不同**才算跨期；任一侧推不出期 ⇒ 保守判不可比
    const crossed = periodic && !!input.prevDate && (prevPeriod == null || curPeriod == null || prevPeriod !== curPeriod);
    return { periodic, crossed, comparable: !crossed, prevPeriod, curPeriod };
}
/** 连续在榜天数：从今天往回数，断档归零 */
export function daysOnBoard(key, dataDate, history) {
    const dates = new Set((history && history.get(key) ? history.get(key).dates : []) || []);
    let n = 1;
    let cur = addDays(dataDate, -1);
    while (dates.has(cur)) {
        n += 1;
        cur = addDays(cur, -1);
    }
    return n;
}
function entry(r, prevRank, delta, days) {
    return {
        key: r.key,
        title: r.title,
        author: r.author,
        url: r.url,
        rank: r.rank,
        prevRank,
        delta,
        days,
    };
}
/**
 * 变化集：本次 vs 上一次成功扫描。
 * - 新入榜 = 历史第一次出现；回榜 = 历史出现过、上次不在、这次回来（分开计数）
 * - 名次型：|Δ| ≤ jitter（默认 2，并列抖动）算作持平，不计入上升/下降
 * - 无基准（没有更早的快照）⇒ firstEver = true，各类均为空（不报 0）
 */
export function computeBoardDiff(input) {
    const { boardId, metric, current, previous, history } = input;
    const jitter = typeof input.jitter === 'number' ? input.jitter : 2;
    const base = {
        boardId,
        metric,
        baselineDate: previous ? previous.dataDate : null,
        firstEver: !previous,
        newEntry: [],
        rebound: [],
        up: [],
        down: [],
        flat: [],
        out: [],
        metricDelta: [],
    };
    if (!previous)
        return base;
    /**
     * ★ 跨期不可比保护（2026-10-16）：基准日与本次不属于同一期 ⇒ **变化列一律置空**。
     *   只对周期榜生效（guardCrossPeriod 里的显式清单）；非周期榜 crossed 恒 false，行为不变。
     */
    const guard = guardCrossPeriod({ boardId, prevDate: previous.dataDate, date: current.dataDate, periodKeyOf: input.periodKeyOf });
    if (guard.crossed)
        base.crossPeriod = true;
    const prevRows = new Map();
    for (const r of previous.rows)
        prevRows.set(r.key, r);
    const curKeys = new Set();
    for (const r of current.rows) {
        curKeys.add(r.key);
        const prev = prevRows.get(r.key);
        const days = daysOnBoard(r.key, current.dataDate, history);
        if (!prev) {
            const seen = !!(history && history.get(r.key));
            const e = entry(r, null, null, days);
            if (seen)
                base.rebound.push(e);
            else
                base.newEntry.push(e);
            continue;
        }
        if (metric === 'rank') {
            const pr = prev.rank;
            const cr = r.rank;
            const raw = pr != null && cr != null ? pr - cr : null;
            // 跨期：名次是「上一期那一榜上的位置」，与本期不可比 ⇒ 置空（分组按持平，不报假升降）
            const delta = guard.crossed ? null : raw;
            const e = entry(r, pr, delta, days);
            if (delta == null || Math.abs(delta) <= jitter)
                base.flat.push(e);
            else if (delta > 0)
                base.up.push(e);
            else
                base.down.push(e);
        }
        else {
            const pv = prev.value;
            const cv = r.value;
            const raw = pv != null && cv != null ? cv - pv : null;
            const delta = guard.crossed ? null : raw;
            const e = entry(r, null, delta, days);
            if (delta == null || delta === 0)
                base.flat.push(e);
            else if (delta > 0)
                base.up.push(e);
            else
                base.down.push(e);
            if (delta != null && delta !== 0)
                base.metricDelta.push({ key: r.key, title: r.title, delta, value: cv == null ? 0 : cv });
        }
    }
    for (const r of previous.rows) {
        if (curKeys.has(r.key))
            continue;
        base.out.push(entry(r, r.rank, null, daysOnBoard(r.key, current.dataDate, history)));
    }
    const byDelta = (a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
    base.up.sort(byDelta);
    base.down.sort(byDelta);
    base.metricDelta.sort((a, b) => b.delta - a.delta);
    return base;
}
//# sourceMappingURL=diff.js.map