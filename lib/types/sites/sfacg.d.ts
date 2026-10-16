import { type BoardCtx, type Row, type SiteAdapter } from '../scan/types.js';
/**
 * 菠萝包轻小说（book.sfacg.com）适配器 —— 首页 SSR 的三个榜（2026-10-14 属主定）。
 * 实测事实：
 * - 首页 15 个区块，用 span.main-title 的文本定位；周期 tab 是**同页 div.tab-item**（不是 URL 参数），
 *   两个 tab 的数据都在 SSR 里；每个 tab 固定 10 条
 * - 名次 1–2 是图文形态 li.figure（书名被站点截断成「...」，另有 评分/字数/收藏），
 *   名次 3+ 是 li.list（i.num 是零填充名次，书名同样截断，**没有数值也没有作者**）
 * - 错误页也返回 HTTP 200（title「出错了」/「糟糕,页面找不到了」）⇒ 判 missing 不能只看状态码
 */
export declare const SFACG_BOARDS: Record<string, {
    title: string;
    tab: string;
    name: string;
}>;
/**
 * 从菠萝包**书页** <title> 里取作者（纯函数，可单测）。
 * 首页三个榜都拿不到作者：1–2 名是图文卡（只有评分/字数/收藏），3+ 名连数值都没有 ⇒ 适配器里 author 恒 null，
 * 只能靠书页补全。实测形态（2026-10-15 取 /Novel/783717/）：
 *   「越狱失败后成了典狱长小姐的玩物 - 小说全文阅读 - 纯爱运动女性主角变身橘味 - 日升之时 - SF轻小说」
 * 口径：按 ' - ' 取**倒数第二段**（'SF轻小说' 前一段）；段数不合预期时用正则兜底。
 */
export declare function authorFromBookTitle(title: string): string | null;
/** 取某个榜某个 tab 的条目（找不到榜/tab ⇒ null） */
export declare function parseHomeBoard(html: string, title: string, tab: string): Row[] | null;
export declare function makeSfacgSite(opts?: {
    boards?: string[];
    fetchText?: (url: string, ctx: BoardCtx) => Promise<string>;
}): SiteAdapter;
