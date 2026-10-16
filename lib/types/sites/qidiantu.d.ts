import { type BoardCtx, type Row, type SiteAdapter } from '../scan/types.js';
/**
 * 起点图（qidiantu.com）适配器 —— 首订榜。实测（2026-10-14，只读取证）：
 * - /shouding/ 当日榜（27 条）、/shouding/{YYYY-MM-DD} 单日、/shouding/{YYYY-MM} 整月（634 条）
 * - SSR HTML 表格，无 JSON 接口；**精确数值在 td[value] 属性里**（显示文本是 1.72w 这类缩写）
 * - 陷阱：合法但无数据的日期返回 200 且 0 行 ⇒ 判 missing 只能看行数，不能看状态码
 */
export declare const QIDIANTU_BOARDS: Record<string, string>;
/** 某一周的三江期首日（周日） */
export declare function periodStartOf(d: Date): string;
/** 统一的本地日期串。★ **必须补零**：`/shouding/2026-10-1` 只返回 26 字节空页
 *  ⇒ 会被误判成「该日期无数据」（2026-10-15 属主截图里就是这个）。 */
export declare function ymd(d: Date): string;
/**
 * 三江·推荐效果（/bang/1/6/<期首日>）：
 * 数据行恒 16 cell = [0]# [1]分类 [2]书名 [3]作者 [4]等级 [5]首订 [6]日期 [7]初始 [8]总增量 [9..15]第1..7天增量
 * 数值一律取单元格 value 属性（显示值是 8k / +3603 这类缩写）。
 * ★ 列级 null 策略（照搬生产侧、别一律把负数当缺失）：
 *   - 首订 / 日期 / 初始 = 计数类：负值或 0 ⇒ null
 *   - 总增量与日增量 = 差值类：**负数是真实净下降，必须原样保留**
 *   - 未到的天页面给 value=0（不是缺失）⇒ 按「列日期 > 今天」判 null
 */
export declare function parseSanjiang(html: string, today: string, periodStart: string): Row[];
/**
 * 首订榜（/shouding/）：表头 = [#, [分类]书名, 首订, 收藏, 收订比, 字数, 粉丝, 作者, 首V时刻]。
 * ★ 口径（与三江一致）：**首订是计数类 —— 负值/0 ⇒ null**，页面偶尔出现的负数行不是「负首订」，
 *   面板一律显示「—」，绝不把负数当数值展示（属主 2026-10-14 反馈）。
 */
export declare function parseShouding(html: string): {
    date: string | null;
    rows: Row[];
};
export declare function makeQidiantuSite(opts?: {
    boards?: string[];
    fetchText?: (url: string, ctx: BoardCtx) => Promise<string>;
}): SiteAdapter;
