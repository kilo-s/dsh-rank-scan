import { type BoardCtx, type Row, type SiteAdapter } from '../scan/types.js';
/**
 * 刺猬猫（ciweimao.com）适配器 —— 周期榜。实测（2026-10-14，只读取证）：
 * - 榜页 /rank-index/{rank_id}-{period}[/{page}]；每页 10 条；免 cookie、免登录
 * - 条目是 <li data-book-id="…">：名次 <i class="rank-top …">、书名 h3.tit > a、作者「小说作者：」后的 a
 * - **条目里没有任何数值字段** ⇒ 指标是名次型
 * - 陷阱：未知周期后缀仍 200（不能靠状态码判周期）；未知 rank_id 才 404，且错误页 <title>刺猬猫</title>
 */
export declare const CIWEIMAO_BOARDS: Record<string, string>;
/** 首订（约）：**第三方**接口，不在刺猬猫站上。注意是 http（https 在本机会被重置） */
export declare const CIWEIMAO_BUY_URL = "http://newmmapi.yukirus.com/CiweiMaoRank/GetFavorite10KBuyRank";
export declare const CIWEIMAO_BUY_BOARD = "ciweimao.buy.latest";
export declare function parseBuy(json: any): Row[];
export declare function parseRankPage(html: string): Row[];
export declare function makeCiweimaoSite(opts?: {
    boards?: string[];
    fetchText?: (url: string, ctx: BoardCtx) => Promise<string>;
    /** 每榜取多少条（榜页支持 /{page}，每页 10 条，上限 100） */
    depthOf?: (boardId: string) => number;
}): SiteAdapter;
