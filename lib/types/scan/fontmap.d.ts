/**
 * 番茄「字体反爬」解码表（2026-10-15 实测发现）：
 * 榜单接口返回的 bookName / author 里，部分汉字是**私用区码点**（U+E000–U+F8FF，例：转\uE4C2…），
 * 站点用自己的 webfont 把码点渲染成字。实测同一本书多次请求码点**稳定** ⇒ 可以学一张映射表。
 * 学的方式：补全时同时拿到「PUA 标题」与「干净标题」，**等长则逐位对齐**记录 PUA 码点 → 真实字。
 * 用的时候：扫描落盘前 / 面板渲染前做一次替换，解不出来的位置保持原样并标 titleSuspect。
 */
export type FontMap = Record<string, string>;
export declare function isPuaChar(ch: string): boolean;
export declare function hasPua(s: string | null | undefined): boolean;
export declare function loadFontMap(root: string): FontMap;
export declare function saveFontMap(root: string, map: FontMap): void;
/** 用「PUA 文本 + 干净文本」学映射；等长才学（长度不等说明站点截断/改写，宁可不学） */
export declare function learnPair(puaText: string | null | undefined, cleanText: string | null | undefined, map: FontMap): number;
/**
 * 番茄书名/作者可能是私用区码点（字体反爬）⇒ 落盘/出网前解一次；无码点或还没学到映射时原样返回。
 *
 * ★ 抽成模块函数（原来只有 index.ts 内部的闭包版）是为了让**书签**这条路径也能被离线测试钉住：
 *   书签的书名是从快照搬过来的，这里若漏了，用户的「我的书签」里就会长期留着方框乱码。
 */
export declare function decodeIfPua(root: string, s: string | null | undefined): string | null;
/** 解码：能查到的 PUA 换成真字，查不到的保留（并计数，供面板标「仍可疑」） */
export declare function decodePua(text: string | null | undefined, map: FontMap): {
    text: string;
    unknown: number;
    total: number;
};
