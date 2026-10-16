import { type BoardCtx, type Row, type SiteAdapter } from '../scan/types.js';
/**
 * 番茄（fanqienovel.com）适配器 —— 分类榜（数值型：在读人数）。
 * 实测（2026-10-14，只读取证）：
 * - 接口 /api/rank/category/list；每页 10 条、每榜上限 100（offset 步进 10）
 * - 字段：bookId / bookName / author / wordNumber / read_count（真实在读；readCount 恒 "0" 是废弃字段）
 * - ⚠ 字体反爬：bookName/author/abstract 会缺字（榜单接口与 SSR 都缺），
 *   要干净文本需再打 /api/book/info?bookId=（每本 1 请求）⇒ 默认不补，标记 titleSuspect
 * - ⚠ rankMold 语义：菜单显示 1=新书榜、2=阅读榜，但本轮未实测确认（只验证了字符串 read 的写法不可靠）
 * - 分类 37 个（男 19 / 女 18），其中 8 / 746 / 539 三个 id 男女频共用 ⇒ 复合键 (gender, catId)
 */
export declare const FANQIE_MALE: [number, string][];
export declare const FANQIE_FEMALE: [number, string][];
export declare const FANQIE_MOLDS: Record<string, string>;
export declare function fanqieBoardId(gender: 'm' | 'f', mold: 'read' | 'new', catId: number): string;
/**
 * 解析榜单接口。`decode` = 字体映射解码器（见 scan/fontmap.ts）：
 * 原始文本存进 extra.titlePua / authorPua，供补全时学映射；解码后若仍有私用区码点 ⇒ titleSuspect 仍为 true。
 */
export declare function parseRankApi(json: any, decode?: (s: string) => string): Row[];
export declare function makeFanqieSite(opts?: {
    boards?: string[];
    fetchJson?: (url: string, ctx: BoardCtx) => Promise<any>;
    limit?: number;
    /** 字体映射解码器（番茄 bookName/author 有私用区码点） */
    decode?: (s: string) => string;
    /** 每个榜取多少条（面板可逐分类调，上限 30；默认 10 = 1 页） */
    depthOf?: (boardId: string) => number;
}): SiteAdapter;
