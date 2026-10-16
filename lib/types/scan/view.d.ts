/** 面板视图层（宿主侧）：列随榜逻辑 + 按站编组 + 变化分组。**渲染不联网**，全部由已落盘快照算出。 */
export interface Column {
    key: string;
    label: string;
    note?: string;
    source?: string;
}
export interface BoardMeta {
    boardId: string;
    site: string;
    siteName: string;
    name: string;
    metric: 'rank' | 'value';
    /** 榜本身已限定分类 ⇒ 不显示分类列 */
    categoryScoped: boolean;
    /** 非默认抓取/非默认显示时给出提示 */
    extended?: boolean;
    caliber?: string;
    /** 数据来源（第三方等）要标出来 */
    source?: string;
}
export declare function boardMeta(boardId: string): BoardMeta;
/**
 * 列随榜：核心列固定 + 该榜能给的列；没有的字段**整列不出现**。
 * 2026-10-14 属主反馈后的口径：
 * - **数值型必带主指标列**（起点图首订=首订、番茄=在读、刺猬猫首订约=首订（约）、派生榜=在读/七日累计）
 * - 番茄删「站方升降 / 更新时间」（属主点名不要）；「在榜天数」只在真有历史（≥2 数据日）时出现
 * - 菠萝包评分/字数/收藏只在前 2 名有值（首页 SSR 限制），列保留、空格显示「—」
 */
export interface ColumnFlags {
    /** 是否存在上一个数据日（决定「变化/在读变化/在榜天数」是否有意义） */
    hasBaseline: boolean;
    /** 是否有任何历史精简索引（决定「在榜天数」是否值得占一列） */
    hasHistory: boolean;
}
export declare function columnsFor(meta: BoardMeta, flags?: ColumnFlags): Column[];
/** 变化分组：按站编组，组内固定四组（新入榜 / 上升 / 下降 / 退榜；回榜单独标） */
export interface ChangeEntry {
    site: string;
    siteName: string;
    boardId: string;
    boardName: string;
    group: string;
    title: string;
    delta: string;
    days: number | null;
}
export declare function groupChanges(entries: ChangeEntry[]): {
    site: string;
    siteName: string;
    groups: {
        group: string;
        items: ChangeEntry[];
    }[];
}[];
/** 概览：按站编组 + 五态计数 + 隐藏榜数 */
export interface BoardSummaryRow {
    boardId: string;
    name: string;
    status: string;
    up: number | null;
    newCount: number | null;
    out: number | null;
    lastCapture: string | null;
    note: string | null;
    extended?: boolean;
    source?: string;
}
export declare function groupBySite(rows: {
    boardId: string;
    status: string;
}[]): {
    site: string;
    siteName: string;
    count: number;
    statuses: string[];
}[];
/**
 * 「在榜天数」列该不该出（纯函数、可单测）。口径（属主 2026-10-15）：
 *  - **起点图不出**：它是第三方聚合源、本身不是榜单，行是「按首订/收藏增量捞出来的书」，
 *    跨天连续在榜对它没有意义。
 *  - 其余站：该榜**有任何本地数据**就给。一天也出（新书/首次抓到的榜每行显示 1 天，
 *    而不是整列消失或一片「—」）。★ 2026-10-15 二次修正：原来要求「该榜有 ≥2 个数据日」，
 *    结果起点其它子分类、番茄部分分类（都只有当天一份快照）整列不出，看起来像「分类之间没统一」。
 */
export declare function shouldShowDays(site: string, dataDatesForBoard: number): boolean;
/**
 * 该榜**不该出**的列（纯函数、可单测）。口径全部来自属主 2026-10-15 的逐条反馈：
 *  - 起点图（第三方聚合源，非官方榜单）：没有「名次变化」这种概念 ⇒ 不出 delta；
 *    且整站不出「在榜天数」（见 shouldShowDays）。
 *  - 起点图三江：变化已由「今日增量 / 每日增量 7 列」表达 ⇒ delta 重复，去掉。
 *  - 刺猬猫「首订（约）」：第三方约值榜，不出「在榜天数」。
 *  - 菠萝包/番茄等其余榜：照旧。
 */
export declare function hideColumnsFor(boardId: string): string[];
/** 按口径过滤列集合（列表页每次渲染都过一遍，保证「不该出的列」永不出） */
export declare function applyColumnPolicy(cols: Column[], boardId: string): Column[];
/**
 * 「变化」列该以**名次变化**为准的榜（纯函数、可单测）。属主 2026-10-15 口径：
 *  - 有真实名次的榜（番茄新书榜、起点、刺猬猫榜单、菠萝包榜单）⇒ 变化 = 名次变化，
 *    否则「变化」会退化成主指标的数值差（番茄就是在读差），与「在读变化」列 **完全重复**。
 *  - 起点图不是榜单（第三方聚合）/刺猬猫「首订（约）」是第三方约值榜 ⇒ 没有名次变化，
 *    变化交给它自己的增量列表达（三江的今日增量 + 每日增量 7 列），不出名次列。
 */
export declare function usesRankDelta(boardId: string): boolean;
/**
 * 数值型排序的比较器（**一律倒序**，属主 2026-10-15：按字数/收藏/首订要「最大的在前」）。
 * 缺失值统一成 +Infinity ⇒ 倒序时排到最后，不会污染榜首。
 * 抽成纯函数是为了能被单测钉住方向（之前是内联的 num(a)-num(b)，被写成了正序）。
 */
export declare function compareDesc(a: number | null, b: number | null): number;
/**
 * 该榜在**没有显式选排序**时该按什么排（纯函数、可单测）。返回 null = 保持站点原始顺序。
 * 属主 2026-10-15：起点图三江默认按**期初收藏**（它是收藏增量榜，期初体量决定量级）。
 */
export declare function defaultSortFor(boardId: string): string | null;
/**
 * 番茄分类 id → 中文名（纯函数、可单测）。
 * ★ 2026-10-15 属主反馈「周榜的作品分类为什么不显示」：番茄的行把分类存在 `extra.catId`（数字），
 *   而列渲染读的是 `extra.cat`（起点/起点图/刺猬猫那是文本）⇒ 番茄这边**永远显示「—」**。
 *   修法：宿主侧把 catId 解析成名字写进 `extra.cat`，客户端不用知道映射表。
 *   同一 bug 也影响**番茄各个单分类榜**（它们同样只有 catId）—— 一并修掉。
 */
export declare function fanqieCatName(catId: unknown): string | null;
/** 番茄行统一在此补 `extra.cat`（有文本就不用动；只有 catId 就解析成名字） */
export declare function withFanqieCat(extra: Record<string, any> | undefined): Record<string, any>;
