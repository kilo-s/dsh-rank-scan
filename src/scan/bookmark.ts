/**
 * 书签 · 存储与服务（host 侧）。
 * 词汇对齐 CONTEXT.md：书签 / 我的书签 / 书签夹 / 备注。
 *
 * 四类字段的**更新权限**是本模块的核心约束：
 *   1 身份（bookKey/url/site）—— 建签时写，此后只读
 *   2 发现语境（firstSeen/seenBoards/source）—— 自动更新可追加
 *   3 作品快照（title/author/words/metric/capturedAt/valueFrom）—— 自动更新可覆盖
 *   4 用户内容（note/folders/createdAt/updatedAt）—— ★ 只有用户能改，任何自动更新都不许触碰
 * 存储：单文件 + 原子写（.tmp + rename）+ 最近 3 份轮转备份；删除是软删除（写 deletedAt），30 天后物理清除。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bookKeyOf, displayLabel, extractTags, normalizeBookId, type SiteId } from './bookmark-parse.js'

export const BOOKMARKS_VERSION = 1
export const TRASH_KEEP_DAYS = 30
export const BACKUP_ROTATION = 3

export type BookmarkSource = 'board' | 'manual'
export type ValueFrom = 'snapshot' | 'book-page' | 'manual'

export interface SeenOnBoard { boardId: string; rank: number | null; dataDate: string }

export interface Bookmark {
  // 1 身份
  bookKey: string
  site: SiteId
  url: string
  // 2 发现语境
  source: BookmarkSource
  firstSeen: SeenOnBoard | null
  seenBoards: SeenOnBoard[]
  // 3 作品快照
  title: string | null
  author: string | null
  words: number | null
  metric: { name: string; value: number | null } | null
  metricBoard: string | null
  /** 该指标对应的数据日期（用于判断「有没有比现在更新」） */
  metricDate?: string | null
  /**
   * 站方数据（与榜的「主指标」分开存，避免口径互相覆盖）：
   *   起点/起点图/刺猬猫/菠萝包 = 收藏；番茄 = 在读（readCount）。
   * collectFrom 记来源（snapshot / qidian-book-cache / book-page / none），便于排查「这个数哪来的」。
   */
  collect?: number | null
  collectLabel?: string
  collectFrom?: string
  capturedAt: string
  valueFrom: ValueFrom
  /** 用户手动添加时的原始输入（永不覆盖；书名取不到时用它兜底显示） */
  input?: string | null
  // 4 用户内容（★ 自动更新永不触碰）
  note: string
  folders: string[]
  createdAt: string
  updatedAt: string
  /** 软删除标记（有值即在回收站） */
  deletedAt?: string
}

export interface BookmarksFile { bookmarksVersion: number; bookmarks: Bookmark[]; savedAt: string }

/** 面向前端的精简形态（不含回收站） */
/** stale：数据超过 STALE_DAYS 天没变新（面板据此标「可能已无法更新」，避免旧值被当成现值） */
export interface BookmarkView extends Bookmark { label: string; tags: string[]; ageDays: number | null; stale: boolean }

/** 超过这个天数没变新，就提示用户「这本可能取不到数了」 */
export const STALE_DAYS = 7

function emptyFile(): BookmarksFile {
  return { bookmarksVersion: BOOKMARKS_VERSION, bookmarks: [], savedAt: new Date(0).toISOString() }
}

/** 迁移钩子：幂等，将来加字段时在这里补（写法对齐 timerSchemaV） */
function migrate(raw: any): BookmarksFile {
  if (!raw || typeof raw !== 'object') return emptyFile()
  const list = Array.isArray(raw.bookmarks) ? raw.bookmarks : []
  return {
    bookmarksVersion: BOOKMARKS_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date(0).toISOString(),
    bookmarks: list.filter((b: any) => b && typeof b === 'object' && typeof b.bookKey === 'string').map((b: any) => ({
      bookKey: String(b.bookKey),
      site: (b.site || 'qidian') as SiteId,
      url: String(b.url || ''),
      source: b.source === 'manual' ? 'manual' : 'board',
      firstSeen: b.firstSeen || null,
      seenBoards: Array.isArray(b.seenBoards) ? b.seenBoards : [],
      title: b.title == null ? null : String(b.title),
      author: b.author == null ? null : String(b.author),
      words: typeof b.words === 'number' ? b.words : null,
      metric: b.metric || null,
      metricBoard: b.metricBoard || null,
      metricDate: b.metricDate == null ? null : String(b.metricDate),
      collect: typeof b.collect === 'number' ? b.collect : null,
      collectLabel: typeof b.collectLabel === 'string' ? b.collectLabel : undefined,
      collectFrom: typeof b.collectFrom === 'string' ? b.collectFrom : undefined,
      capturedAt: String(b.capturedAt || new Date(0).toISOString()),
      valueFrom: (b.valueFrom || 'snapshot') as ValueFrom,
      input: b.input == null ? null : String(b.input),
      note: String(b.note || ''),
      folders: Array.isArray(b.folders) ? b.folders.map(String) : [],
      createdAt: String(b.createdAt || new Date(0).toISOString()),
      updatedAt: String(b.updatedAt || new Date(0).toISOString()),
      // 归一：文件里写成了 null 或空串也当「未删除」，避免软删除标记的假象（曾经踩过：赋 undefined → JSON 变 null）
      deletedAt: typeof b.deletedAt === 'string' && b.deletedAt ? b.deletedAt : undefined,
    })),
  }
}

export class BookmarkStore {
  readonly file: string
  constructor(readonly root: string) { this.file = join(root, 'state', 'bookmarks.json') }

  /** 读；损坏/非法一律回退空表（绝不抛给调用方）。recovered 标记是否从备份救回 */
  read(): { file: BookmarksFile; error: string | null; recoveredFrom: string | null } {
    // ★ 2026-10-16（票 28）：主文件**缺失**也必须走备份轮转。
    //   最常见的损坏形态就是「写盘崩在中间 ⇒ 主文件不见了」（旧实现先 rm 再 rename），
    //   此时盘上明明还有 .1/.2/.3，旧代码却直接返回空表且 error=null —— 静默丢书签。
    const main = this.tryRead(this.file)
    if (main) return { file: migrate(main), error: null, recoveredFrom: null }
    for (let i = 1; i <= BACKUP_ROTATION; i++) {
      const bak = this.file + '.' + i
      const got = this.tryRead(bak)
      if (got) {
        const why = existsSync(this.file) ? '主文件损坏，已从备份恢复：' : '主文件缺失，已从备份恢复：'
        return { file: migrate(got), error: why + bak, recoveredFrom: bak }
      }
    }
    if (!existsSync(this.file)) return { file: emptyFile(), error: null, recoveredFrom: null }
    return { file: emptyFile(), error: '书签文件损坏且无可用备份（已按空表处理，原文件保留）', recoveredFrom: null }
  }

  private tryRead(p: string): any | null {
    try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
  }

  /** 原子写 + 轮转备份（.1 最新） */
  write(f: BookmarksFile): void {
    mkdirSync(dirname(this.file), { recursive: true })
    if (existsSync(this.file)) {
      for (let i = BACKUP_ROTATION; i > 1; i--) {
        const src = this.file + '.' + (i - 1)
        if (existsSync(src)) { try { copyFileSync(src, this.file + '.' + i) } catch { /* 备份失败不该挡住写入 */ } }
      }
      try { copyFileSync(this.file, this.file + '.1') } catch { /* 同上 */ }
    }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify({ ...f, bookmarksVersion: BOOKMARKS_VERSION, savedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
    // ★ 2026-10-16（票 28）：**不要**先 rm 再 rename —— 两者之间崩掉（进程被杀/断电/磁盘满）
    //   就是「主文件消失 + 上面 read() 若无备份则空表」。与 index.ts 的 writeJson 保持一致：
    //   直接 rename 覆盖（Node 在 Windows 上走 MoveFileEx + REPLACE_EXISTING，可覆盖已存在文件）。
    renameSync(tmp, this.file)
  }
}

export interface ServiceDeps { store: BookmarkStore; now: () => Date }

export class BookmarkService {
  private store: BookmarkStore
  private now: () => Date
  private lastError: string | null = null
  private recoveredFrom: string | null = null
  constructor(deps: ServiceDeps) { this.store = deps.store; this.now = deps.now }

  private load(): BookmarksFile {
    const r = this.store.read()
    this.lastError = r.error
    this.recoveredFrom = r.recoveredFrom
    return r.file
  }
  /** 面板要能看到「文件坏了/从备份恢复」这件事 */
  health(): { error: string | null; recoveredFrom: string | null } { return { error: this.lastError, recoveredFrom: this.recoveredFrom } }

  private save(f: BookmarksFile): void { this.store.write(f) }

  private view(b: Bookmark, nowMs: number): BookmarkView {
    const ageDays = b.capturedAt ? Math.max(0, Math.round((nowMs - Date.parse(b.capturedAt)) / 86400000)) : null
    // 手动添加且取不到书页的条目不算「陈旧告警」——它本来就没数据，标待补已经说清楚了
    const stale = ageDays != null && ageDays > STALE_DAYS && !(b.source === 'manual' && b.valueFrom === 'manual')
    // ★ 2026-10-16：番茄读数的正确口径是「在读」（追读是早先写错的标签）。
    //   旧文件里已经落盘的 collectLabel 一并纠正，避免导出/卡片继续显示错口径。
    const collectLabel = b.site === 'fanqie' && b.collectLabel === '追读' ? '在读' : b.collectLabel
    return { ...b, collectLabel, label: displayLabel(b), tags: extractTags(b.note), ageDays, stale }
  }

  /** 全部书签（不含回收站），按打签时间倒序 */
  all(): BookmarkView[] {
    const nowMs = this.now().getTime()
    return this.load().bookmarks.filter((b) => !b.deletedAt)
      .map((b) => this.view(b, nowMs))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }

  /** 回收站：按删除时间倒序，附剩余天数 */
  trash(): (BookmarkView & { deletedAt: string; daysLeft: number })[] {
    const nowMs = this.now().getTime()
    return this.load().bookmarks.filter((b) => !!b.deletedAt)
      .map((b) => ({ ...this.view(b, nowMs), deletedAt: b.deletedAt as string, daysLeft: Math.max(0, TRASH_KEEP_DAYS - Math.round((nowMs - Date.parse(b.deletedAt as string)) / 86400000)) }))
      .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
  }

  has(bookKey: string): boolean {
    const k = String(bookKey || '')
    return !!k && this.load().bookmarks.some((b) => !b.deletedAt && b.bookKey === k)
  }

  /** 精简 map：面板挂载时一次拉取，避免逐行请求 */
  sync(): { total: number; map: Record<string, { hasNote: boolean; folders: string[]; updatedAt: string }> } {
    const list = this.load().bookmarks.filter((b) => !b.deletedAt)
    const map: Record<string, { hasNote: boolean; folders: string[]; updatedAt: string }> = {}
    for (const b of list) map[b.bookKey] = { hasNote: !!b.note, folders: b.folders, updatedAt: b.updatedAt }
    return { total: list.length, map }
  }

  get(bookKey: string): Bookmark | null {
    const k = String(bookKey)
    return this.load().bookmarks.find((b) => b.bookKey === k) || null
  }

  /** 已有则合并（幂等），否则新建。★ add 永不覆盖用户内容 */
  add(patch: Partial<Bookmark> & { bookKey: string }, opts: { note?: string; folders?: string[]; seen?: SeenOnBoard } = {}): { created: boolean; bookmark: Bookmark } {
    const f = this.load()
    const nowIso = this.now().toISOString()
    const existing = f.bookmarks.find((b) => b.bookKey === patch.bookKey)
    if (existing) {
      // 幂等：只补空字段 + 把软删除标记真正去掉（★ 必须是 delete：赋 undefined 会让「回收站里还有一条」的假象持续）
      if (existing.deletedAt) delete existing.deletedAt
      existing.title = patch.title != null ? patch.title : existing.title
      existing.author = patch.author != null ? patch.author : existing.author
      existing.words = patch.words != null ? patch.words : existing.words
      if (patch.metric) existing.metric = patch.metric
      // 站方数据（收藏/在读）：只在拿到数时覆盖，避免用 null 把已有值擦掉
      if (typeof patch.collect === 'number') existing.collect = patch.collect
      if (typeof patch.collectLabel === 'string') existing.collectLabel = patch.collectLabel
      if (typeof patch.collectFrom === 'string') existing.collectFrom = patch.collectFrom
      if (patch.metricBoard) existing.metricBoard = patch.metricBoard
      if (patch.metricDate !== undefined) existing.metricDate = patch.metricDate
      if (opts.note != null && opts.note !== '') existing.note = String(opts.note)
      if (opts.folders) existing.folders = opts.folders.map(String)
      if (patch.input != null) existing.input = patch.input
      /**
       * ★ 发现语境（第 2 类字段）在「已存在」时也要追加 —— 否则同一本书在两个榜各打一次，
       *   seenBoards 只会留下第一次那个榜（实测踩到：起点图首订 + 三江打两次，seenBoards 只有 1 项）。
       *   firstSeen 保持最早那次不变（「首次发现」的语义）。
       */
      const seen = opts.seen || patch.firstSeen || null
      if (seen) {
        if (!existing.firstSeen) existing.firstSeen = seen
        if (!existing.seenBoards.some((s) => s.boardId === seen.boardId && s.dataDate === seen.dataDate)) existing.seenBoards.push(seen)
        if (existing.source === 'manual' && seen.boardId) existing.source = 'board'
      }
      existing.updatedAt = nowIso
      existing.capturedAt = patch.capturedAt || existing.capturedAt
      if (patch.valueFrom) existing.valueFrom = patch.valueFrom
      this.save(f)
      return { created: false, bookmark: existing }
    }
    // 新建时：发现语境优先取 patch.firstSeen，其次取 opts.seen（重复打签/自动更新走后者）
    const seen0 = patch.firstSeen || opts.seen || null
    const b: Bookmark = {
      bookKey: patch.bookKey,
      site: (patch.site || 'qidian') as SiteId,
      url: String(patch.url || ''),
      source: patch.source === 'manual' ? 'manual' : 'board',
      firstSeen: patch.firstSeen || opts.seen || null,
      seenBoards: patch.seenBoards ? patch.seenBoards.slice() : (seen0 ? [seen0] : []),
      title: patch.title == null ? null : patch.title,
      author: patch.author == null ? null : patch.author,
      words: typeof patch.words === 'number' ? patch.words : null,
      metric: patch.metric || null,
      metricBoard: patch.metricBoard || null,
      metricDate: patch.metricDate || null,
      collect: typeof patch.collect === 'number' ? patch.collect : null,
      collectLabel: typeof patch.collectLabel === 'string' ? patch.collectLabel : undefined,
      collectFrom: typeof patch.collectFrom === 'string' ? patch.collectFrom : undefined,
      capturedAt: patch.capturedAt || nowIso,
      valueFrom: (patch.valueFrom || (patch.source === 'manual' ? 'manual' : 'snapshot')) as ValueFrom,
      input: patch.input == null ? null : String(patch.input),
      note: String(opts.note || ''),
      folders: (opts.folders || []).map(String),
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    f.bookmarks.push(b)
    this.save(f)
    return { created: true, bookmark: b }
  }

  /** 只改用户内容（备注/夹） */
  setUserContent(bookKey: string, patch: { note?: string; folders?: string[] }): Bookmark | null {
    const f = this.load()
    const b = f.bookmarks.find((x) => x.bookKey === bookKey)
    if (!b) return null
    if (patch.note != null) b.note = String(patch.note)
    if (patch.folders) b.folders = patch.folders.map(String)
    b.updatedAt = this.now().toISOString()
    this.save(f)
    return b
  }

  /** 自动更新（机会式/书籍页刷新）：只允许动第 2、3 类字段 —— 备注与夹永不触碰 */
  autoUpdate(bookKey: string, patch: Partial<Pick<Bookmark, 'title' | 'author' | 'words' | 'metric' | 'metricBoard' | 'metricDate' | 'valueFrom' | 'capturedAt' | 'url' | 'site' | 'collect' | 'collectLabel' | 'collectFrom'>>, seen?: SeenOnBoard, opts: { promoteToBoard?: boolean } = {}): Bookmark | null {
    const f = this.load()
    const b = f.bookmarks.find((x) => x.bookKey === bookKey)
    if (!b || b.deletedAt) return null
    if (patch.title != null) b.title = patch.title
    if (patch.author != null) b.author = patch.author
    if (typeof patch.words === 'number') b.words = patch.words
    if (patch.metric) b.metric = patch.metric
    // 站方数据：只在真的拿到数时写（null 不擦已有值；取不到时保留旧值并靠 collectFrom 说明）
    if (typeof patch.collect === 'number') b.collect = patch.collect
    if (typeof patch.collectLabel === 'string') b.collectLabel = patch.collectLabel
    if (typeof patch.collectFrom === 'string') {
      // 只有「新拿到的来源」才覆盖来源说明；none 不应把 book-page 这类更可信的来源改回去
      if (patch.collectFrom !== 'none' || b.collect == null) b.collectFrom = patch.collectFrom
    }
    if (patch.metricBoard) b.metricBoard = patch.metricBoard
    if (patch.metricDate !== undefined) b.metricDate = patch.metricDate
    if (patch.valueFrom) b.valueFrom = patch.valueFrom
    if (patch.capturedAt) b.capturedAt = patch.capturedAt
    if (patch.url) b.url = patch.url
    if (patch.site) b.site = patch.site
    if (seen) {
      if (!b.firstSeen) b.firstSeen = seen
      if (!b.seenBoards.some((s) => s.boardId === seen.boardId && s.dataDate === seen.dataDate)) b.seenBoards.push(seen)
      // 手动添加的书后来真上榜 ⇒ 转成有榜单来源
      if (opts.promoteToBoard && b.source === 'manual') b.source = 'board'
    }
    b.updatedAt = this.now().toISOString()
    this.save(f)
    return b
  }

  /** 软删除 */
  remove(bookKey: string): boolean {
    const f = this.load()
    const b = f.bookmarks.find((x) => x.bookKey === bookKey)
    if (!b || b.deletedAt) return false
    b.deletedAt = this.now().toISOString()
    b.updatedAt = b.deletedAt
    this.save(f)
    return true
  }

  /**
   * 恢复。若同 bookKey 的现行条目已存在（删除期间又被重新打签）⇒ **合并**（备注/夹并入、取更早 createdAt），
   * 不产生第二条 —— 否则列表里会出现两条看起来一样的书签。
   */
  restore(bookKey: string): { restored: boolean; merged: boolean } {
    const f = this.load()
    const dead = f.bookmarks.find((x) => x.bookKey === bookKey && !!x.deletedAt)
    if (!dead) return { restored: false, merged: false }
    const live = f.bookmarks.find((x) => x.bookKey === bookKey && !x.deletedAt)
    if (live) {
      if (dead.note && !live.note) live.note = dead.note
      for (const fd of dead.folders) if (!live.folders.includes(fd)) live.folders.push(fd)
      if (dead.createdAt < live.createdAt) live.createdAt = dead.createdAt
      live.updatedAt = this.now().toISOString()
      f.bookmarks = f.bookmarks.filter((x) => x !== dead)
      this.save(f)
      return { restored: true, merged: true }
    }
    delete dead.deletedAt
    dead.updatedAt = this.now().toISOString()
    this.save(f)
    return { restored: true, merged: false }
  }

  /** 物理清空回收站（全部或指定） */
  purge(bookKeys?: string[]): number {
    const f = this.load()
    const before = f.bookmarks.length
    f.bookmarks = f.bookmarks.filter((b) => !b.deletedAt || (bookKeys && !bookKeys.includes(b.bookKey)))
    const gone = before - f.bookmarks.length
    if (gone) this.save(f)
    return gone
  }

  /** 启动清理：物理清除超过 TRASH_KEEP_DAYS 天的软删除条目（用注入的时钟，测里不 sleep） */
  pruneTrash(): number {
    const f = this.load()
    const cutoff = this.now().getTime() - TRASH_KEEP_DAYS * 86400000
    const before = f.bookmarks.length
    f.bookmarks = f.bookmarks.filter((b) => !b.deletedAt || Date.parse(b.deletedAt) >= cutoff)
    const gone = before - f.bookmarks.length
    if (gone) this.save(f)
    return gone
  }

  folders(): string[] {
    const set = new Set<string>()
    for (const b of this.load().bookmarks) if (!b.deletedAt) for (const fd of b.folders) set.add(fd)
    return Array.from(set).sort()
  }

  /**
   * 导出：★ 默认不含回收站；损坏时可用部分照常导出。
   * 2026-10-16（属主需求）：① 可按**选择集**导出（bookKeys，空=全部）② 支持 csv ③ 可选含回收站。
   */
  exportData(
    format: 'json' | 'md' | 'csv' = 'json',
    opts: { bookKeys?: string[] | null; includeTrash?: boolean } = {},
  ): { format: string; content: string; count: number } {
    const active = this.all()
    const all = opts.includeTrash ? active.concat(this.trash() as any) : active
    const sel = opts.bookKeys && opts.bookKeys.length ? new Set(opts.bookKeys.map(String)) : null
    const list = sel ? all.filter((b) => sel.has(b.bookKey)) : all
    if (format === 'csv') {
      // 表格可直接进 Excel：列顺序固定，值里的逗号/引号/换行按 RFC4180 转义
      const cell = (v: any) => {
        const s = v == null ? '' : String(v)
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const head = ['bookKey', 'site', '书名', '作者', '字数', '收藏(口径)', '收藏数', '数据日期', '夹', '标签', '备注', 'URL']
      const rows = [head.join(',')]
      for (const b of list) {
        rows.push([
          b.bookKey, b.site, b.label, b.author, b.words == null ? '' : b.words,
          b.collect == null ? '' : (b.collectLabel || '收藏'), b.collect == null ? '' : b.collect,
          String(b.capturedAt || '').slice(0, 10), b.folders.join(' '), b.tags.join(' '), b.note || '', b.url || '',
        ].map(cell).join(','))
      }
      return { format, count: list.length, content: rows.join('\r\n') + '\r\n' }
    }
    if (format === 'json') {
      return { format, count: list.length, content: JSON.stringify({ bookmarksVersion: BOOKMARKS_VERSION, exportedAt: this.now().toISOString(), bookmarks: list }, null, 2) + '\n' }
    }
    const lines: string[] = ['# 我的书签（' + list.length + ' 条）', '', '- 导出时间：' + this.now().toISOString(), opts.includeTrash ? '- 含回收站' : '- 不含回收站', '']
    for (const b of list) {
      const bits: string[] = []
      if (b.author) bits.push('作者 ' + b.author)
      if (b.words != null) bits.push('字数 ' + b.words)
      if (b.collect != null) bits.push((b.collectLabel || '收藏') + ' ' + b.collect)
    if (b.metric) bits.push(b.metric.name + ' ' + (b.metric.value == null ? '—' : b.metric.value))
      bits.push('数据日期 ' + String(b.capturedAt).slice(0, 10))
      lines.push('## ' + b.label)
      lines.push('')
      lines.push('- ' + bits.join(' · '))
      if (b.firstSeen) lines.push('- 首次发现：' + b.firstSeen.boardId + ' 第 ' + (b.firstSeen.rank == null ? '—' : b.firstSeen.rank) + ' 名（' + b.firstSeen.dataDate + '）')
      else lines.push('- 手动添加 · 无榜单来源')
      const other = b.seenBoards.filter((s) => !b.firstSeen || s.boardId !== b.firstSeen.boardId)
      if (other.length) lines.push('- 也上过：' + other.map((s) => s.boardId).join('、'))
      if (b.folders.length) lines.push('- 夹：' + b.folders.join('、'))
      if (b.tags.length) lines.push('- 标签：' + b.tags.map((t) => '#' + t).join(' '))
      lines.push('- URL：' + (b.url || '—'))
      if (b.note) lines.push('', '> ' + b.note.split('\n').join('\n> '))
      lines.push('')
    }
    return { format, count: list.length, content: lines.join('\n') }
  }
}

export { bookKeyOf, extractTags, displayLabel, normalizeBookId }
