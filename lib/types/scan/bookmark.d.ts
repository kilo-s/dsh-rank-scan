import { bookKeyOf, displayLabel, extractTags, normalizeBookId, type SiteId } from './bookmark-parse.js';
export declare const BOOKMARKS_VERSION = 1;
export declare const TRASH_KEEP_DAYS = 30;
export declare const BACKUP_ROTATION = 3;
export type BookmarkSource = 'board' | 'manual';
export type ValueFrom = 'snapshot' | 'book-page' | 'manual';
export interface SeenOnBoard {
    boardId: string;
    rank: number | null;
    dataDate: string;
}
export interface Bookmark {
    bookKey: string;
    site: SiteId;
    url: string;
    source: BookmarkSource;
    firstSeen: SeenOnBoard | null;
    seenBoards: SeenOnBoard[];
    title: string | null;
    author: string | null;
    words: number | null;
    metric: {
        name: string;
        value: number | null;
    } | null;
    metricBoard: string | null;
    /** 该指标对应的数据日期（用于判断「有没有比现在更新」） */
    metricDate?: string | null;
    /**
     * 站方数据（与榜的「主指标」分开存，避免口径互相覆盖）：
     *   起点/起点图/刺猬猫/菠萝包 = 收藏；番茄 = 在读（readCount）。
     * collectFrom 记来源（snapshot / qidian-book-cache / book-page / none），便于排查「这个数哪来的」。
     */
    collect?: number | null;
    collectLabel?: string;
    collectFrom?: string;
    capturedAt: string;
    valueFrom: ValueFrom;
    /** 用户手动添加时的原始输入（永不覆盖；书名取不到时用它兜底显示） */
    input?: string | null;
    note: string;
    folders: string[];
    createdAt: string;
    updatedAt: string;
    /** 软删除标记（有值即在回收站） */
    deletedAt?: string;
}
export interface BookmarksFile {
    bookmarksVersion: number;
    bookmarks: Bookmark[];
    savedAt: string;
}
/** 面向前端的精简形态（不含回收站） */
/** stale：数据超过 STALE_DAYS 天没变新（面板据此标「可能已无法更新」，避免旧值被当成现值） */
export interface BookmarkView extends Bookmark {
    label: string;
    tags: string[];
    ageDays: number | null;
    stale: boolean;
}
/** 超过这个天数没变新，就提示用户「这本可能取不到数了」 */
export declare const STALE_DAYS = 7;
export declare class BookmarkStore {
    readonly root: string;
    readonly file: string;
    constructor(root: string);
    /** 读；损坏/非法一律回退空表（绝不抛给调用方）。recovered 标记是否从备份救回 */
    read(): {
        file: BookmarksFile;
        error: string | null;
        recoveredFrom: string | null;
    };
    private tryRead;
    /** 原子写 + 轮转备份（.1 最新） */
    write(f: BookmarksFile): void;
}
export interface ServiceDeps {
    store: BookmarkStore;
    now: () => Date;
}
export declare class BookmarkService {
    private store;
    private now;
    private lastError;
    private recoveredFrom;
    constructor(deps: ServiceDeps);
    private load;
    /** 面板要能看到「文件坏了/从备份恢复」这件事 */
    health(): {
        error: string | null;
        recoveredFrom: string | null;
    };
    private save;
    private view;
    /** 全部书签（不含回收站），按打签时间倒序 */
    all(): BookmarkView[];
    /** 回收站：按删除时间倒序，附剩余天数 */
    trash(): (BookmarkView & {
        deletedAt: string;
        daysLeft: number;
    })[];
    has(bookKey: string): boolean;
    /** 精简 map：面板挂载时一次拉取，避免逐行请求 */
    sync(): {
        total: number;
        map: Record<string, {
            hasNote: boolean;
            folders: string[];
            updatedAt: string;
        }>;
    };
    get(bookKey: string): Bookmark | null;
    /** 已有则合并（幂等），否则新建。★ add 永不覆盖用户内容 */
    add(patch: Partial<Bookmark> & {
        bookKey: string;
    }, opts?: {
        note?: string;
        folders?: string[];
        seen?: SeenOnBoard;
    }): {
        created: boolean;
        bookmark: Bookmark;
    };
    /** 只改用户内容（备注/夹） */
    setUserContent(bookKey: string, patch: {
        note?: string;
        folders?: string[];
    }): Bookmark | null;
    /** 自动更新（机会式/书籍页刷新）：只允许动第 2、3 类字段 —— 备注与夹永不触碰 */
    autoUpdate(bookKey: string, patch: Partial<Pick<Bookmark, 'title' | 'author' | 'words' | 'metric' | 'metricBoard' | 'metricDate' | 'valueFrom' | 'capturedAt' | 'url' | 'site' | 'collect' | 'collectLabel' | 'collectFrom'>>, seen?: SeenOnBoard, opts?: {
        promoteToBoard?: boolean;
    }): Bookmark | null;
    /** 软删除 */
    remove(bookKey: string): boolean;
    /**
     * 恢复。若同 bookKey 的现行条目已存在（删除期间又被重新打签）⇒ **合并**（备注/夹并入、取更早 createdAt），
     * 不产生第二条 —— 否则列表里会出现两条看起来一样的书签。
     */
    restore(bookKey: string): {
        restored: boolean;
        merged: boolean;
    };
    /** 物理清空回收站（全部或指定） */
    purge(bookKeys?: string[]): number;
    /** 启动清理：物理清除超过 TRASH_KEEP_DAYS 天的软删除条目（用注入的时钟，测里不 sleep） */
    pruneTrash(): number;
    folders(): string[];
    /**
     * 导出：★ 默认不含回收站；损坏时可用部分照常导出。
     * 2026-10-16（属主需求）：① 可按**选择集**导出（bookKeys，空=全部）② 支持 csv ③ 可选含回收站。
     */
    exportData(format?: 'json' | 'md' | 'csv', opts?: {
        bookKeys?: string[] | null;
        includeTrash?: boolean;
    }): {
        format: string;
        content: string;
        count: number;
    };
}
export { bookKeyOf, extractTags, displayLabel, normalizeBookId };
