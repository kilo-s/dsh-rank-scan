/**
 * 真正的 Word 97-2003 二进制 .doc（OLE2 复合文档 + MS-DOC FIB + piece table）。
 *
 * 为什么不是 RTF/HTML 改扩展名：Word 对 .doc 的识别看 OLE2 签名（D0 CF 11 E0 …）与
 * WordDocument 流里的 FIB，改扩展名的文本文件不是这个格式。这里按 [MS-CFB] 与
 * [MS-DOC] 写最小但完整的结构：
 *
 *   - CFB 容器：WordDocument + 1Table 两个流；小于 4096 字节的流走 mini stream。
 *   - FIB：采用 Word 2002 形状（nFib=0x00C1，FibRgCswNew.nFibNew=0x0112，
 *     183 个 fc/lcb 对）。只写 93 对的 Word 97 原始形状 Word 会拒绝打开。
 *   - 正文：UTF-16LE，一段一个 piece；CLX 里一个 PCD，fCompressed=0。
 *   - 必要的表：stylesheet（Normal）、字体表、DOP、section PLC、PAPX/CHPX 的 bin table
 *     与 512 字节 FKP 页。这样 Word 不需要“修复”就能打开。
 *
 * 只依赖 Node 内建 Buffer；不引入任何运行时依赖。
 *
 * 实现来源与许可：CFB 容器与 DOC 最小结构的布局移植自 Quillwright 的 DOC writer
 * （https://github.com/WrightDocumentSuite/quillwright，Apache-2.0；
 * Copyright (c) Quillwright contributors；https://www.apache.org/licenses/LICENSE-2.0）。
 * 本文件是 TypeScript 独立实现，未逐行复制上游源码；字段顺序与算法依据 [MS-DOC]/[MS-CFB]。
 */

const SECTOR_SIZE = 512
const MINI_SECTOR_SIZE = 64
const MINI_STREAM_CUTOFF = 4096

const FREESECT = 0xffffffff
const ENDOFCHAIN = 0xfffffffe
const FATSECT = 0xfffffffd
const DIFSECT = 0xfffffffc

/** FIB 之后正文的起点：两个扇区，给 183 对的 FIB 留足空间。 */
const TEXT_START = 2048
/** Word 2002 形状的 FIB：32 字节 base + 各段计数 + 183 对 + 5 个新版本字段。 */
const FIB_SIZE = 32 + 2 + 28 + 2 + 88 + 2 + 183 * 8 + 2 + 5 * 2
/** 每个 PAPX FKP 页最多放多少个段落条目（留出 rgfc/rgbx/PAPX 的空间）。 */
const PAPX_ENTRIES_PER_PAGE = 20

/** FIB 中我们用到的 fc/lcb 对下标（[MS-DOC] 2.5.5）。 */
const PAIR_STSHF_ORIG = 0
const PAIR_STSHF = 1
const PAIR_SECTIONS = 6
const PAIR_BTE_CHPX = 12
const PAIR_BTE_PAPX = 13
const PAIR_FONTS = 15
const PAIR_DOP = 31
const PAIR_CLX = 33

export type WordBlockKind = 'title' | 'subtitle' | 'section' | 'heading' | 'meta' | 'desc' | 'link' | 'note' | 'body'
export interface WordBlock {
  text: string
  kind?: WordBlockKind
}

interface FcLcb { fc: number; lcb: number }
interface ParagraphSpan { start: number; end: number; pap?: Buffer; chp?: Buffer }

/**
 * 生成一个真正的 Word 97-2003 二进制 .doc（纯文本段落）。
 *
 * 文本按行拆成 Word 段落（每个换行变成段落标记 CR）；中文、emoji（UTF-16 代理对）、
 * 制表符都原样保留。空字符串会生成一个只含空段落的合法文档。
 */
export function createWordDoc(text: string): Buffer {
  const normalized = normalizeText(text)
  const paragraphs = splitParagraphs(normalized)
  return buildDocBuffer(normalized, paragraphs, false)
}

/**
 * 生成带原生 Word 排版样式（字号/加粗/配色/段距/缩进/与下段同页）的二进制 .doc。
 * 保持零运行时依赖与标准 [MS-DOC] 结构，在 Word / WPS 中无需修复即可分层清晰展示。
 */
export function createStyledWordDoc(blocks: WordBlock[]): Buffer {
  const expanded: { text: string; pap: Buffer; chp: Buffer }[] = []
  for (const blk of blocks || []) {
    const kind: WordBlockKind = blk.kind || 'body'
    const clean = String(blk.text ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
    const lines = clean.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const isFirst = i === 0
      const isLast = i === lines.length - 1
      expanded.push({
        text: lines[i],
        pap: papSprmFor(kind, isFirst, isLast),
        chp: chpSprmFor(kind),
      })
    }
  }
  if (!expanded.length) {
    expanded.push({ text: '', pap: Buffer.alloc(0), chp: Buffer.alloc(0) })
  }
  const paragraphs: ParagraphSpan[] = []
  const parts: string[] = []
  let offset = 0
  for (const item of expanded) {
    const start = offset
    const end = start + item.text.length
    paragraphs.push({ start, end, pap: item.pap, chp: item.chp })
    parts.push(item.text + '\r')
    offset = end + 1
  }
  return buildDocBuffer(parts.join(''), paragraphs, true)
}

function buildDocBuffer(normalized: string, paragraphs: ParagraphSpan[], styled: boolean): Buffer {
  const cpCount = normalized.length
  const textBytes = cpCount * 2

  // 正文之后放 section 的 SEPX（这里用空属性，Word 取默认页面设置）。
  const fcSepx = TEXT_START + textBytes
  const papxOffset = align512(fcSepx + 2)
  const papx = styled ? buildStyledPapxPages(paragraphs) : { pages: buildPapxPages(paragraphs), boundaries: buildPapxBoundaries(paragraphs) }
  const chpxOffset = papxOffset + papx.pages.length * SECTOR_SIZE
  const chpx = styled ? buildStyledChpxPages(paragraphs) : { pages: [buildChpxPage(textBytes)], boundaries: [TEXT_START, TEXT_START + textBytes] }
  const streamLength = chpxOffset + chpx.pages.length * SECTOR_SIZE

  // 先排表流：每个结构记录自己在表流中的偏移，FIB 最后统一回填。
  const tableParts: Buffer[] = []
  const pairs = new Map<number, FcLcb>()
  let tableLength = 0

  const add = (data: Buffer, pair?: number): void => {
    if (data.length === 0) return
    if (pair !== undefined) pairs.set(pair, { fc: tableLength, lcb: data.length })
    tableParts.push(data)
    tableLength += data.length
    const pad = (4 - (tableLength % 4)) % 4
    if (pad) {
      tableParts.push(Buffer.alloc(pad))
      tableLength += pad
    }
  }

  const clx = buildClx(cpCount)
  add(clx, PAIR_CLX)

  const sectionPlc = buildSectionPlc(fcSepx, cpCount)
  add(sectionPlc, PAIR_SECTIONS)

  add(buildBinTable(papx.boundaries, papxOffset / SECTOR_SIZE), PAIR_BTE_PAPX)
  add(buildBinTable(chpx.boundaries, chpxOffset / SECTOR_SIZE), PAIR_BTE_CHPX)

  const styleSheet = buildStyleSheet()
  add(styleSheet, PAIR_STSHF)
  pairs.set(PAIR_STSHF_ORIG, pairs.get(PAIR_STSHF) as FcLcb)

  add(buildFontTable(), PAIR_FONTS)
  add(buildDop(cpCount, paragraphs.length), PAIR_DOP)

  const tableStream = Buffer.concat(tableParts, tableLength)
  const fib = buildFib(streamLength, cpCount, pairs)

  // WordDocument 流：FIB + 正文 + SEPX + PAPX/CHPX 页。
  const wordStream = Buffer.alloc(streamLength)
  fib.copy(wordStream, 0)
  Buffer.from(normalized, 'utf16le').copy(wordStream, TEXT_START)
  wordStream.writeUInt16LE(0, fcSepx) // SEPX 的 cb=0：空 section 属性
  for (let i = 0; i < papx.pages.length; i++) papx.pages[i].copy(wordStream, papxOffset + i * SECTOR_SIZE)
  for (let i = 0; i < chpx.pages.length; i++) chpx.pages[i].copy(wordStream, chpxOffset + i * SECTOR_SIZE)

  return writeCompoundFile([
    { name: 'WordDocument', data: wordStream },
    { name: '1Table', data: tableStream },
  ])
}

// --- [MS-DOC] 标准 SPRM 编码（用于结构化排版，仅限 createStyledWordDoc） ---

function sprmByte(opcode: number, val: number): Buffer {
  const b = Buffer.alloc(3)
  b.writeUInt16LE(opcode, 0)
  b[2] = val & 0xff
  return b
}

function sprmU16(opcode: number, val: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt16LE(opcode, 0)
  b.writeUInt16LE(val & 0xffff, 2)
  return b
}

function sprmS16(opcode: number, val: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt16LE(opcode, 0)
  b.writeInt16LE(val, 2)
  return b
}

function sprmColor(r: number, g: number, b: number): Buffer {
  // sprmCCv (0x6870) + COLORREF (R, G, B, 0x00)
  const buf = Buffer.alloc(6)
  buf.writeUInt16LE(0x6870, 0)
  buf[2] = r & 0xff
  buf[3] = g & 0xff
  buf[4] = b & 0xff
  buf[5] = 0
  return buf
}

function sprmLineSpacing(mult240: number): Buffer {
  // sprmPDyaLine (0x6412) + LSPD(dyaLine=mult240, fMultLinespace=1)
  const buf = Buffer.alloc(6)
  buf.writeUInt16LE(0x6412, 0)
  buf.writeInt16LE(mult240, 2)
  buf.writeInt16LE(1, 4)
  return buf
}

function chpSprmFor(kind: WordBlockKind): Buffer {
  // sprmCFBold=0x0835, sprmCHps=0x4A43 (半磅), sprmCCv=0x6870
  switch (kind) {
    case 'title':
      return Buffer.concat([sprmByte(0x0835, 1), sprmU16(0x4a43, 32), sprmColor(0x1f, 0x23, 0x28)])
    case 'subtitle':
      return Buffer.concat([sprmU16(0x4a43, 19), sprmColor(0x65, 0x6d, 0x76)])
    case 'section':
      return Buffer.concat([sprmByte(0x0835, 1), sprmU16(0x4a43, 26), sprmColor(0x1b, 0x4f, 0x72)])
    case 'heading':
      return Buffer.concat([sprmByte(0x0835, 1), sprmU16(0x4a43, 22), sprmColor(0x1f, 0x23, 0x28)])
    case 'meta':
      return Buffer.concat([sprmU16(0x4a43, 19), sprmColor(0x57, 0x60, 0x6a)])
    case 'desc':
      return Buffer.concat([sprmU16(0x4a43, 19), sprmColor(0x57, 0x60, 0x6a)])
    case 'link':
      return Buffer.concat([sprmU16(0x4a43, 18), sprmColor(0x09, 0x69, 0xda)])
    case 'note':
      return Buffer.concat([sprmU16(0x4a43, 21), sprmColor(0x24, 0x29, 0x2f)])
    default:
      return Buffer.concat([sprmU16(0x4a43, 21), sprmColor(0x24, 0x29, 0x2f)])
  }
}

function papSprmFor(kind: WordBlockKind, isFirst: boolean, isLast: boolean): Buffer {
  // sprmPFKeepFollow=0x2406, sprmPDyaBefore=0xA413, sprmPDyaAfter=0xA414, sprmPDxaLeft=0x845E
  const out: Buffer[] = []
  switch (kind) {
    case 'title':
      out.push(sprmByte(0x2406, 1), sprmU16(0xa414, 80))
      break
    case 'subtitle':
      out.push(sprmU16(0xa414, 200))
      break
    case 'section':
      out.push(sprmByte(0x2406, 1), sprmU16(0xa413, 280), sprmU16(0xa414, 80))
      break
    case 'heading':
      out.push(sprmByte(0x2406, 1), sprmU16(0xa413, 200), sprmU16(0xa414, 40))
      break
    case 'meta':
      out.push(sprmU16(0xa414, 40), sprmLineSpacing(288))
      break
    case 'desc':
      out.push(sprmS16(0x845e, 240), sprmU16(0xa413, isFirst ? 40 : 0), sprmU16(0xa414, isLast ? 80 : 30), sprmLineSpacing(276))
      break
    case 'link':
      out.push(sprmU16(0xa414, 80), sprmLineSpacing(264))
      break
    case 'note':
      out.push(sprmS16(0x845e, 240), sprmU16(0xa413, isFirst ? 60 : 0), sprmU16(0xa414, isLast ? 140 : 60), sprmLineSpacing(324))
      break
    default:
      out.push(sprmU16(0xa414, 100), sprmLineSpacing(300))
      break
  }
  return Buffer.concat(out)
}

/** 构造一条偶数长度的 PapxInFkp（[MS-DOC] 2.9.175）：偶数 grpprl 走 cb=0/cb' 扩展形式，奇数走紧凑 cb。 */
function encodePapxInFkp(sprms: Buffer): Buffer {
  const payload = Buffer.alloc(2 + sprms.length)
  payload.writeUInt16LE(0, 0) // istd = 0 (Normal)
  sprms.copy(payload, 2)
  if (payload.length % 2 === 0) {
    const out = Buffer.alloc(2 + payload.length)
    out[0] = 0
    out[1] = payload.length / 2
    payload.copy(out, 2)
    return out
  }
  const out = Buffer.alloc(1 + payload.length)
  out[0] = (payload.length + 1) / 2
  payload.copy(out, 1)
  return out
}

/** 带自定义 PAPX SPRM 的动态分页器（同页相同 SPRM 复用 bOffset；严守 512 字节与 cpara<=29）。 */
function buildStyledPapxPages(paragraphs: ParagraphSpan[]): { pages: Buffer[]; boundaries: number[] } {
  const pages: Buffer[] = []
  const boundaries: number[] = [TEXT_START]
  let idx = 0
  while (idx < paragraphs.length) {
    const page = Buffer.alloc(SECTOR_SIZE)
    const entries: { startFc: number; endFc: number; bOffset: number }[] = []
    const cache = new Map<string, number>()
    let cursor = SECTOR_SIZE - 1 // 最后 1 字节留给 cpara

    while (idx < paragraphs.length && entries.length < 29) {
      const p = paragraphs[idx]
      const sprm = p.pap || Buffer.alloc(0)
      const key = sprm.toString('hex')
      const cached = cache.get(key)
      const encoded = cached == null ? encodePapxInFkp(sprm) : null
      const nextCount = entries.length + 1
      const headerEnd = (nextCount + 1) * 4 + nextCount * 13
      const nextCursor = encoded ? (cursor - encoded.length) & ~1 : cursor
      if (nextCursor < headerEnd) break
      let bOffset: number
      if (encoded) {
        encoded.copy(page, nextCursor)
        bOffset = nextCursor / 2
        cache.set(key, bOffset)
        cursor = nextCursor
      } else {
        bOffset = cached as number
      }
      entries.push({
        startFc: TEXT_START + p.start * 2,
        endFc: TEXT_START + (p.end + 1) * 2,
        bOffset,
      })
      idx += 1
    }

    const n = entries.length
    page.writeUInt32LE(entries[0].startFc, 0)
    for (let i = 0; i < n; i++) page.writeUInt32LE(entries[i].endFc, (i + 1) * 4)
    const rgbx = (n + 1) * 4
    for (let i = 0; i < n; i++) page[rgbx + i * 13] = entries[i].bOffset
    page[SECTOR_SIZE - 1] = n
    pages.push(page)
    boundaries.push(entries[n - 1].endFc)
  }
  return { pages, boundaries }
}

/** 带自定义 CHPX SPRM 的动态分页器（相邻同样式段落合并 run；同页相同 SPRM 复用 bOffset；crun<=101）。 */
function buildStyledChpxPages(paragraphs: ParagraphSpan[]): { pages: Buffer[]; boundaries: number[] } {
  const runs: { startFc: number; endFc: number; sprm: Buffer; key: string }[] = []
  for (const p of paragraphs) {
    const startFc = TEXT_START + p.start * 2
    const endFc = TEXT_START + (p.end + 1) * 2
    const sprm = p.chp || Buffer.alloc(0)
    const key = sprm.toString('hex')
    const prev = runs[runs.length - 1]
    if (prev && prev.key === key && prev.endFc === startFc) {
      prev.endFc = endFc
    } else {
      runs.push({ startFc, endFc, sprm, key })
    }
  }

  const pages: Buffer[] = []
  const boundaries: number[] = [TEXT_START]
  let idx = 0
  while (idx < runs.length) {
    const page = Buffer.alloc(SECTOR_SIZE)
    const entries: { startFc: number; endFc: number; bOffset: number }[] = []
    const cache = new Map<string, number>()
    let cursor = SECTOR_SIZE - 1

    while (idx < runs.length && entries.length < 101) {
      const r = runs[idx]
      const nextCount = entries.length + 1
      const headerEnd = (nextCount + 1) * 4 + nextCount
      let bOffset = 0
      let nextCursor = cursor
      if (r.sprm.length > 0) {
        const cached = cache.get(r.key)
        if (cached != null) {
          bOffset = cached
        } else {
          const need = 1 + r.sprm.length
          nextCursor = (cursor - need) & ~1
          if (nextCursor < headerEnd) break
          page[nextCursor] = r.sprm.length
          r.sprm.copy(page, nextCursor + 1)
          bOffset = nextCursor / 2
          cache.set(r.key, bOffset)
          cursor = nextCursor
        }
      }
      if (cursor < headerEnd) break
      entries.push({ startFc: r.startFc, endFc: r.endFc, bOffset })
      idx += 1
    }

    const n = entries.length
    page.writeUInt32LE(entries[0].startFc, 0)
    for (let i = 0; i < n; i++) page.writeUInt32LE(entries[i].endFc, (i + 1) * 4)
    const rgb = (n + 1) * 4
    for (let i = 0; i < n; i++) page[rgb + i] = entries[i].bOffset
    page[SECTOR_SIZE - 1] = n
    pages.push(page)
    boundaries.push(entries[n - 1].endFc)
  }
  return { pages, boundaries }
}

/** 统一换行：CRLF/CR → LF，再统一成 Word 的段落标记 CR；保证以 CR 结尾。 */
function normalizeText(text: string): string {
  const lf = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  const body = lf.replace(/\n/g, '\r')
  return body.endsWith('\r') ? body : body + '\r'
}

/** 每个 CR 结束一个段落；end 指向 CR 本身。 */
function splitParagraphs(text: string): ParagraphSpan[] {
  const out: ParagraphSpan[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0x0d) continue
    out.push({ start, end: i })
    start = i + 1
  }
  return out
}

function align512(value: number): number {
  return Math.ceil(value / SECTOR_SIZE) * SECTOR_SIZE
}

/**
 * CLX：一个 Pcdt（clxt=0x02），里面是一个 PlcPcd。
 * 一个 piece：CP 0..ccpText，PCD.fc=TEXT_START、fCompressed=0（UTF-16LE）。
 */
function buildClx(cpCount: number): Buffer {
  const bytes = Buffer.alloc(21)
  bytes[0] = 0x02
  bytes.writeUInt32LE(16, 1) // PlcPcd 长度：2 个 CP（8 字节）+ 1 个 PCD（8 字节）
  bytes.writeUInt32LE(0, 5) // CP[0]
  bytes.writeUInt32LE(cpCount, 9) // CP[1]
  // PCD：flags(2) + fc(4) + prm(2)。fCompressed 位为 0，fc 是字节偏移。
  bytes.writeUInt16LE(0, 13)
  bytes.writeUInt32LE(TEXT_START, 15)
  bytes.writeUInt16LE(0, 19)
  return bytes
}

/** PlcfSed：一个 section，SED 12 字节，fcSepx 指向 WordDocument 里的 SEPX。 */
function buildSectionPlc(fcSepx: number, cpCount: number): Buffer {
  const bytes = Buffer.alloc(8 + 12)
  bytes.writeUInt32LE(0, 0)
  bytes.writeUInt32LE(cpCount, 4)
  bytes.writeUInt16LE(0, 8) // fn
  bytes.writeUInt32LE(fcSepx, 10) // fcSepx
  bytes.writeUInt16LE(0, 14) // fnMpr
  bytes.writeUInt32LE(0xffffffff, 16) // fcMpr：没有宏
  return bytes
}

/**
 * PlcBtePapx / PlcBteChpx：aFC 数组 + 每个区间一个 4 字节页号（pn，页号 ×512）。
 */
function buildBinTable(boundaries: number[], firstPage: number): Buffer {
  const records = boundaries.length - 1
  if (records <= 0) return Buffer.alloc(0)
  const bytes = Buffer.alloc(boundaries.length * 4 + records * 4)
  for (let i = 0; i < boundaries.length; i++) bytes.writeUInt32LE(boundaries[i], i * 4)
  for (let i = 0; i < records; i++) bytes.writeUInt32LE(firstPage + i, boundaries.length * 4 + i * 4)
  return bytes
}

/** 每个 PAPX 页覆盖的段落结束 FC；最后一页的最后一个 FC 是正文末尾。 */
function buildPapxBoundaries(paragraphs: ParagraphSpan[]): number[] {
  const out: number[] = [TEXT_START]
  for (let i = 0; i < paragraphs.length; i += PAPX_ENTRIES_PER_PAGE) {
    const last = paragraphs[Math.min(i + PAPX_ENTRIES_PER_PAGE, paragraphs.length) - 1]
    out.push(TEXT_START + (last.end + 1) * 2)
  }
  return out
}

/**
 * PapxFkp：512 字节。rgfc 是每个段落起止 FC，rgbx 是 BxPap（bOffset + 12 字节 PHE），
 * PAPX 从页尾向上放；最后一字节是 cpara。
 *
 * 这里每个段落只写默认属性（istd=0，无 grpprl），纯文本足够；用扩展形式
 * cb=0 / cb'=1，grpprlInPapx 为 1 字节 cb' + 2 字节 istd，不含奇数字节的 grpprl。
 */
function buildPapxPages(paragraphs: ParagraphSpan[]): Buffer[] {
  const pages: Buffer[] = []
  for (let from = 0; from < paragraphs.length; from += PAPX_ENTRIES_PER_PAGE) {
    const chunk = paragraphs.slice(from, from + PAPX_ENTRIES_PER_PAGE)
    const page = Buffer.alloc(SECTOR_SIZE)
    const n = chunk.length
    page.writeUInt32LE(TEXT_START + chunk[0].start * 2, 0)
    for (let i = 0; i < n; i++) page.writeUInt32LE(TEXT_START + (chunk[i].end + 1) * 2, (i + 1) * 4)

    const rgbx = (n + 1) * 4
    let cursor = SECTOR_SIZE - 1
    for (let i = 0; i < n; i++) {
      cursor = (cursor - 4) & ~1
      page[rgbx + i * 13] = cursor / 2 // BxPap.bOffset
      // PHE 12 字节保持 0；PAPX 4 字节：cb=0，cb'=1，随后 2 字节 istd=0。
      // 这是 [MS-DOC] 2.9.175 的扩展形式，避免把奇数字节的 grpprl 交给 Word。
      page[cursor] = 0
      page[cursor + 1] = 1
      page[cursor + 2] = 0
      page[cursor + 3] = 0
    }
    page[SECTOR_SIZE - 1] = n
    pages.push(page)
  }
  return pages
}

/** ChpxFkp：一个 run 覆盖全文，rgb[0]=0 表示没有 CHPX（默认字符属性）。 */
function buildChpxPage(textBytes: number): Buffer {
  const page = Buffer.alloc(SECTOR_SIZE)
  page.writeUInt32LE(TEXT_START, 0)
  page.writeUInt32LE(TEXT_START + textBytes, 4)
  page[8] = 0
  page[SECTOR_SIZE - 1] = 1
  return page
}

/**
 * STSH：LPStshi（18 字节 STSHI）+ 15 个固定槽位。只定义 Normal（槽 0），其余槽位写 0。
 * Normal 的 STD 里：STDF 10 字节 + xstzName + 段落 UPX + 字符 UPX。
 */
function buildStyleSheet(): Buffer {
  const stshi = Buffer.alloc(18)
  stshi.writeUInt16LE(15, 0) // cstd
  stshi.writeUInt16LE(10, 2) // cbSTDBaseInFile
  stshi.writeUInt16LE(1, 4) // fStdStylenamesWritten
  stshi.writeUInt16LE(15, 6) // stiMaxWhenSaved
  stshi.writeUInt16LE(15, 8) // istdMaxFixedWhenSaved
  stshi.writeUInt16LE(0, 10) // nVerBuiltInNamesWhenSaved
  stshi.writeUInt16LE(0, 12) // rgftc: ASCII
  stshi.writeUInt16LE(0, 14) // rgftc: hAnsi
  stshi.writeUInt16LE(1, 16) // rgftc: East Asian（宋体）

  const normal = buildNormalStyle()
  const parts: Buffer[] = []
  const header = Buffer.alloc(2)
  header.writeUInt16LE(stshi.length, 0)
  parts.push(header, stshi)

  for (let i = 0; i < 15; i++) {
    if (i === 0) {
      const len = Buffer.alloc(2)
      len.writeUInt16LE(normal.length, 0)
      parts.push(len, normal)
    } else {
      parts.push(Buffer.alloc(2)) // 空槽位
    }
  }
  return Buffer.concat(parts)
}

function buildNormalStyle(): Buffer {
  const name = 'Normal'
  const nameBytes = Buffer.from(name, 'utf16le')
  const stdf = Buffer.alloc(10)
  stdf.writeUInt16LE(0, 0) // sti = 0
  stdf.writeUInt16LE(0xfff1, 2) // kind=1（段落）+ parent=0x0FFF
  stdf.writeUInt16LE(0xfff2, 4) // istdNext=0x0FFF，段落样式
  // stdf[6..8] 稍后写 cbStd
  const paragraphUpx = Buffer.alloc(4)
  paragraphUpx.writeUInt16LE(2, 0) // cbUPX = 2
  paragraphUpx.writeUInt16LE(0, 2) // istd = 0
  const characterUpx = Buffer.alloc(2) // cbUPX = 0

  const body = Buffer.concat([
    stdf,
    u16(name.length),
    nameBytes,
    u16(0),
    paragraphUpx,
    characterUpx,
  ])
  body.writeUInt16LE(body.length, 6) // STDF.cbStd
  return body
}

/**
 * SttbfFfn：两个字体。STSHI 的 rgftc 指到 0（Times New Roman）和 1（宋体）。
 * 每个 FFN 是 40 字节固定字段 + UTF-16 名字 + 结尾 0。
 */
function buildFontTable(): Buffer {
  const names = ['Times New Roman', '宋体']
  const parts: Buffer[] = [u16(names.length), u16(0)]
  for (let i = 0; i < names.length; i++) {
    const text = Buffer.from(names[i], 'utf16le')
    const total = 40 + text.length + 2
    const ffn = Buffer.alloc(total)
    ffn[0] = total - 1 // cbFfnM1
    ffn[1] = 0x04 // TrueType，无特定 family
    ffn.writeUInt16LE(400, 2) // weight
    ffn[4] = i === 1 ? 0x86 : 0 // chs：宋体标 GB2312
    ffn[5] = 0 // ixchSzAlt
    // panose（10 字节）与 fs（24 字节）留 0
    text.copy(ffn, 40)
    ffn.writeUInt16LE(0, 40 + text.length)
    parts.push(ffn)
  }
  return Buffer.concat(parts)
}

/**
 * Dop2002：694 字节。只设置默认制表位、字符数、段落数；其余字段按 0 默认值。
 * 这个块不能省——Word 会拒绝没有 DOP 的文件。
 */
function buildDop(charCount: number, paragraphCount: number): Buffer {
  const dop = Buffer.alloc(694)
  dop.writeUInt16LE(0, 0) // fFacingPages = 0
  dop.writeUInt16LE(720, 10) // 默认制表位 0.5 英寸
  dop.writeInt32LE(charCount, 42)
  dop.writeInt32LE(paragraphCount, 48)
  return dop
}

/**
 * FIB：Word 2002 形状。nFib 仍是 0x00C1，但 cswNew 用 0x0112 覆盖它，
 * 并把 fc/lcb 目录扩到 183 对；这是 Word 实际能打开的形状。
 */
function buildFib(cbMac: number, ccpText: number, pairs: Map<number, FcLcb>): Buffer {
  const fib = Buffer.alloc(FIB_SIZE)
  fib.writeUInt16LE(0xa5ec, 0) // wIdent
  fib.writeUInt16LE(0x00c1, 2) // nFib
  fib.writeUInt16LE(0x0804, 6) // lid: zh-CN
  // fWhichTblStm=1（1Table）、fExtChar=1、fFarEast=1、cQuickSaves=0xF。
  fib.writeUInt16LE(0x52f0, 10)
  fib.writeUInt16LE(0x00bf, 12) // nFibBack
  fib.writeUInt16LE(14, 0x20) // csw
  fib.writeUInt16LE(0x0804, 0x3c) // FibRgW97.lidFE
  fib.writeUInt16LE(22, 0x3e) // cslw
  fib.writeUInt32LE(cbMac, 0x40)
  fib.writeUInt32LE(ccpText, 0x4c)
  fib.writeUInt16LE(183, 0x98) // cbRgFcLcb

  for (const [index, entry] of pairs) {
    const at = 0x9a + index * 8
    fib.writeUInt32LE(entry.fc, at)
    fib.writeUInt32LE(entry.lcb, at + 4)
  }

  fib.writeUInt16LE(5, 0x652) // cswNew
  fib.writeUInt16LE(0x0112, 0x654) // nFibNew
  return fib
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(value & 0xffff, 0)
  return b
}

// ---------------------------------------------------------------------------
// CFB（[MS-CFB]）写入器：只为两个流服务，但 mini stream / FAT / DIFAT / 目录树都按规范写。
// ---------------------------------------------------------------------------

interface CfbStream { name: string; data: Buffer }
interface CfbEntry {
  name: string
  data: Buffer
  isMini: boolean
  start: number
  left: number
  right: number
}

const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / 4

function writeCompoundFile(streams: CfbStream[]): Buffer {
  const entries: CfbEntry[] = streams.map((s) => ({
    name: s.name,
    data: s.data,
    isMini: s.data.length < MINI_STREAM_CUTOFF,
    start: 0,
    left: -1,
    right: -1,
  }))

  // 小流先按 64 字节 mini sector 打包进 mini stream。
  const miniParts: Buffer[] = []
  let miniLength = 0
  for (const entry of entries) {
    if (!entry.isMini) continue
    entry.start = miniLength / MINI_SECTOR_SIZE
    miniParts.push(entry.data)
    miniLength += entry.data.length
    const pad = (MINI_SECTOR_SIZE - (miniLength % MINI_SECTOR_SIZE)) % MINI_SECTOR_SIZE
    if (pad) {
      miniParts.push(Buffer.alloc(pad))
      miniLength += pad
    }
  }
  const miniStream = Buffer.concat(miniParts, miniLength)
  const miniSectorCount = miniLength / MINI_SECTOR_SIZE
  const miniFatSectorCount = miniSectorCount === 0 ? 0 : Math.ceil(miniSectorCount / FAT_ENTRIES_PER_SECTOR)
  const dirSectorCount = Math.ceil((entries.length + 1) / (SECTOR_SIZE / 128))

  // 常规流 → mini stream → miniFAT → 目录 → FAT → DIFAT。
  let cursor = 0
  for (const entry of entries) {
    if (entry.isMini) continue
    entry.start = cursor
    cursor += Math.ceil(entry.data.length / SECTOR_SIZE)
  }
  const miniStreamStart = miniLength === 0 ? -1 : cursor
  cursor += Math.ceil(miniLength / SECTOR_SIZE)
  const miniFatStart = cursor
  cursor += miniFatSectorCount
  const dirStart = cursor
  cursor += dirSectorCount
  const [fatSectorCount, difatSectorCount] = countFatSectors(cursor)
  const fatStart = cursor
  const difatStart = cursor + fatSectorCount
  const totalSectors = cursor + fatSectorCount + difatSectorCount

  const fat = new Uint32Array(fatSectorCount * FAT_ENTRIES_PER_SECTOR).fill(FREESECT)
  for (const entry of entries) {
    if (!entry.isMini && entry.data.length > 0) chain(fat, entry.start, Math.ceil(entry.data.length / SECTOR_SIZE))
  }
  if (miniStreamStart >= 0) chain(fat, miniStreamStart, Math.ceil(miniLength / SECTOR_SIZE))
  chain(fat, miniFatStart, miniFatSectorCount)
  chain(fat, dirStart, dirSectorCount)
  for (let i = 0; i < fatSectorCount; i++) fat[fatStart + i] = FATSECT
  for (let i = 0; i < difatSectorCount; i++) fat[difatStart + i] = DIFSECT

  const miniFat = new Uint32Array(miniFatSectorCount * FAT_ENTRIES_PER_SECTOR).fill(FREESECT)
  for (const entry of entries) {
    if (entry.isMini && entry.data.length > 0) chain(miniFat, entry.start, Math.ceil(entry.data.length / MINI_SECTOR_SIZE))
  }

  const rootChild = buildDirectoryTree(entries)
  const directory = Buffer.alloc(dirSectorCount * SECTOR_SIZE)
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    directory.writeUInt32LE(FREESECT, offset + 68)
    directory.writeUInt32LE(FREESECT, offset + 72)
    directory.writeUInt32LE(FREESECT, offset + 76)
  }
  writeDirectoryEntry(directory, 0, 'Root Entry', 5, miniStreamStart, miniStream.length, rootChild, -1, -1)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    writeDirectoryEntry(
      directory, i + 1, entry.name, 2,
      entry.data.length === 0 ? -1 : entry.start, entry.data.length, -1,
      entry.left, entry.right,
    )
  }

  const file = Buffer.alloc(SECTOR_SIZE + totalSectors * SECTOR_SIZE)
  writeCfbHeader(file, {
    fatSectorCount,
    fatStart,
    dirStart,
    miniFatStart,
    miniFatSectorCount,
    difatStart,
    difatSectorCount,
  })

  for (const entry of entries) {
    if (!entry.isMini && entry.data.length > 0) entry.data.copy(file, sectorOffset(entry.start))
  }
  if (miniStreamStart >= 0) miniStream.copy(file, sectorOffset(miniStreamStart))
  writeSectorTable(file, miniFatStart, miniFatSectorCount, miniFat)
  directory.copy(file, sectorOffset(dirStart))
  writeSectorTable(file, fatStart, fatSectorCount, fat)
  writeDifat(file, difatStart, difatSectorCount, fatSectorCount, fatStart)

  return file
}

function countFatSectors(dataSectors: number): [number, number] {
  let fat = 0
  let difat = 0
  for (let round = 0; round < 8; round++) {
    const nextFat = Math.ceil((dataSectors + fat + difat) / FAT_ENTRIES_PER_SECTOR)
    const nextDifat = nextFat <= 109 ? 0 : Math.ceil((nextFat - 109) / (FAT_ENTRIES_PER_SECTOR - 1))
    if (nextFat === fat && nextDifat === difat) break
    fat = nextFat
    difat = nextDifat
  }
  return [fat, difat]
}

function chain(table: Uint32Array, start: number, count: number): void {
  for (let i = 0; i < count; i++) table[start + i] = i + 1 < count ? start + i + 1 : ENDOFCHAIN
}

function sectorOffset(sector: number): number {
  return SECTOR_SIZE + sector * SECTOR_SIZE
}

function buildDirectoryTree(entries: CfbEntry[]): number {
  const sorted = entries
    .map((_, index) => index)
    .sort((a, b) => {
      const byLength = entries[a].name.length - entries[b].name.length
      if (byLength !== 0) return byLength
      const left = entries[a].name.toUpperCase()
      const right = entries[b].name.toUpperCase()
      return left < right ? -1 : left > right ? 1 : 0
    })

  const link = (low: number, high: number): number => {
    if (low > high) return -1
    const middle = (low + high) >> 1
    const entry = entries[sorted[middle]]
    entry.left = link(low, middle - 1)
    entry.right = link(middle + 1, high)
    return sorted[middle]
  }
  return link(0, sorted.length - 1)
}

function writeDirectoryEntry(
  directory: Buffer,
  index: number,
  name: string,
  kind: number,
  start: number,
  size: number,
  child: number,
  left: number,
  right: number,
): void {
  const at = index * 128
  const nameBytes = Buffer.from(name, 'utf16le')
  const nameLength = Math.min(nameBytes.length, 62)
  nameBytes.copy(directory, at, 0, nameLength)
  directory.writeUInt16LE(nameLength + 2, at + 64)
  directory[at + 66] = kind
  directory[at + 67] = 1 // 黑色节点
  directory.writeUInt32LE(left < 0 ? FREESECT : left + 1, at + 68)
  directory.writeUInt32LE(right < 0 ? FREESECT : right + 1, at + 72)
  directory.writeUInt32LE(child < 0 ? FREESECT : child + 1, at + 76)
  directory.writeUInt32LE(start < 0 ? ENDOFCHAIN : start, at + 116)
  directory.writeUInt32LE(size >>> 0, at + 120)
  directory.writeUInt32LE(Math.floor(size / 0x100000000), at + 124)
}

function writeCfbHeader(file: Buffer, layout: {
  fatSectorCount: number
  fatStart: number
  dirStart: number
  miniFatStart: number
  miniFatSectorCount: number
  difatStart: number
  difatSectorCount: number
}): void {
  file[0] = 0xd0
  file[1] = 0xcf
  file[2] = 0x11
  file[3] = 0xe0
  file[4] = 0xa1
  file[5] = 0xb1
  file[6] = 0x1a
  file[7] = 0xe1
  file.writeUInt16LE(0x003e, 24) // minor version
  file.writeUInt16LE(0x0003, 26) // major version
  file.writeUInt16LE(0xfffe, 28) // byte order
  file.writeUInt16LE(9, 30) // sector shift
  file.writeUInt16LE(6, 32) // mini sector shift
  file.writeUInt32LE(layout.fatSectorCount, 44)
  file.writeUInt32LE(layout.dirStart, 48)
  file.writeUInt32LE(MINI_STREAM_CUTOFF, 56)
  file.writeUInt32LE(layout.miniFatSectorCount === 0 ? ENDOFCHAIN : layout.miniFatStart, 60)
  file.writeUInt32LE(layout.miniFatSectorCount, 64)
  file.writeUInt32LE(layout.difatSectorCount === 0 ? ENDOFCHAIN : layout.difatStart, 68)
  file.writeUInt32LE(layout.difatSectorCount, 72)
  for (let i = 0; i < 109; i++) {
    file.writeUInt32LE(i < layout.fatSectorCount ? layout.fatStart + i : FREESECT, 76 + i * 4)
  }
}

function writeSectorTable(file: Buffer, start: number, sectorCount: number, table: Uint32Array): void {
  if (sectorCount === 0) return
  for (let i = 0; i < sectorCount * FAT_ENTRIES_PER_SECTOR; i++) {
    file.writeUInt32LE(i < table.length ? table[i] : FREESECT, sectorOffset(start) + i * 4)
  }
}

function writeDifat(
  file: Buffer,
  start: number,
  sectorCount: number,
  fatSectorCount: number,
  fatStart: number,
): void {
  for (let i = 0; i < sectorCount; i++) {
    const base = sectorOffset(start + i)
    for (let slot = 0; slot < FAT_ENTRIES_PER_SECTOR - 1; slot++) {
      const index = 109 + i * (FAT_ENTRIES_PER_SECTOR - 1) + slot
      file.writeUInt32LE(index < fatSectorCount ? fatStart + index : FREESECT, base + slot * 4)
    }
    file.writeUInt32LE(i + 1 < sectorCount ? start + i + 1 : ENDOFCHAIN, base + (FAT_ENTRIES_PER_SECTOR - 1) * 4)
  }
}
