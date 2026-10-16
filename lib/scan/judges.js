/** 与上一次有效快照的交集条数 */
export function overlapCount(current, previous) {
    const prev = new Set(previous.map((r) => r.key));
    return current.filter((r) => prev.has(r.key)).length;
}
/** 换榜 / 降级：与上次有效快照交集 ≤ 2（刺猬猫判据） */
export function looksSwapped(current, previous, threshold = 2) {
    if (!current.length || !previous.length)
        return false;
    return overlapCount(current, previous) <= threshold;
}
/** 未刷新：与最近若干天里的任一版本完全一致（菠萝包判据） */
export function looksUnchanged(current, versions) {
    if (!current.length)
        return false;
    const sig = (rows) => rows.map((r) => r.key).join(',');
    const cur = sig(current);
    return versions.some((v) => v.length > 0 && sig(v) === cur);
}
//# sourceMappingURL=judges.js.map