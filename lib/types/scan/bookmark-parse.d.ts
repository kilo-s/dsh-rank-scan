/**
 * 书签 · 输入解析（纯函数，可单测）。host 与 client **共用同一份规则**，避免两处解析不一致。
 * 词汇对齐 docs/rank-scan/CONTEXT.md：书签 / 我的书签 / 书签夹 / 备注；bookKey = 站命名空间 + 站内书号。
 */
export type SiteId = 'qidian' | 'qidiantu' | 'ciweimao' | 'sfacg' | 'fanqie';
export interface ParsedBookRef {
    site: SiteId;
    key: string;
    bookKey: string;
    url: string;
}
/**
 * 归一化书号：去前后空白、去尾斜杠；**只对纯数字做「去前导零」**，番茄的 19 位十进制一律按字符串原样保留。
 * ★ 番茄书号是 19 位十进制 —— 绝不能 Number() 化（7685322774750956568 → 7685322774750956000，精度直接丢）。
 */
export declare function normalizeBookId(raw: unknown): string;
export declare function bookKeyOf(site: SiteId, id: string): string;
/**
 * 解析用户输入 ⇒ 作品引用。接受：
 * - 整条书页 URL（qidian / ciweimao / sfacg / qidiantu.com/info / fanqienovel.com/page）
 * - 带命名空间前缀：qidian:1039… / fanqie:7632… / qidiantu:… / ciweimao:… / sfacg:…
 * - 纯书号（需给出 site；起点图会归并到 qidian 命名空间）
 * 解析不出来就返回 null —— 不猜。
 */
export declare function parseBookInput(input: unknown, site?: string): ParsedBookRef | null;
export declare function urlFor(site: SiteId, id: string): string;
/** 备注里的 #标签 提取（去重、保持出现顺序，最多 20 个） */
export declare function extractTags(note: unknown): string[];
/** 书签里该显示的文字：书名优先，其次用户输入（输入永不被自动更新覆盖），最后退化到书号 */
export declare function displayLabel(b: {
    title?: string | null;
    input?: string | null;
    bookKey: string;
}): string;
/** 距今天数（本地自然日口径，与「数据日期」一致）。传 dateOnly 时按 YYYY-MM-DD 比。 */
export declare function daysSince(iso: string | null | undefined, nowMs: number): number | null;
