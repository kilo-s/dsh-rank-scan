import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWordDoc, createStyledWordDoc } from '../lib/scan/word-doc.js'

// ---------------------------------------------------------------------------
// 独立解析器：只按 [MS-CFB] / [MS-DOC] 读字节，不调用 word-doc.ts 的内部函数。
// 这样断言的是“文件结构”，而不是“实现自己的镜像”。
// ---------------------------------------------------------------------------

const FREESECT = 0xffffffff
const ENDOFCHAIN = 0xfffffffe

function u16 (buf, at) { return buf.readUInt16LE(at) }
function u32 (buf, at) { return buf.readUInt32LE(at) }

function readCfb (file) {
  assert.equal(file.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', '必须是 OLE2/CFB 复合文档')
  assert.equal(u16(file, 26), 3, 'CFB major version = 3')
  assert.equal(u16(file, 30), 9, 'sector shift = 9（512 字节扇区）')
  assert.equal(u16(file, 32), 6, 'mini sector shift = 6（64 字节）')
  assert.equal(u32(file, 56), 4096, 'mini stream cutoff = 4096')

  const sectorSize = 1 << u16(file, 30)
  const miniSize = 1 << u16(file, 32)
  const cutoff = u32(file, 56)
  const fatSectorCount = u32(file, 44)
  const firstDir = u32(file, 48)
  const firstMiniFat = u32(file, 60)
  const miniFatSectorCount = u32(file, 64)
  const firstDifat = u32(file, 68)

  const difat = []
  for (let i = 0; i < 109; i++) {
    const sector = u32(file, 76 + i * 4)
    if (sector !== FREESECT) difat.push(sector)
  }
  let difatSector = firstDifat
  while (difatSector !== FREESECT && difatSector !== ENDOFCHAIN) {
    const base = 512 + difatSector * sectorSize
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const sector = u32(file, base + i * 4)
      if (sector !== FREESECT) difat.push(sector)
    }
    difatSector = u32(file, base + sectorSize - 4)
  }
  assert.ok(difat.length >= fatSectorCount, 'DIFAT 必须覆盖所有 FAT 扇区')

  const fat = []
  for (const sector of difat) {
    const base = 512 + sector * sectorSize
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(file, base + i * 4))
  }

  const chain = (start, table) => {
    const out = []
    let sector = start
    while (sector !== ENDOFCHAIN && sector !== FREESECT && out.length < 100000) {
      out.push(sector)
      sector = table[sector]
    }
    return out
  }

  const readSectors = (start, table, size, useMini) => {
    const unit = useMini ? miniSize : sectorSize
    const chunks = chain(start, table).map((sector) => useMini
      ? miniStream.subarray(sector * unit, (sector + 1) * unit)
      : file.subarray(512 + sector * sectorSize, 512 + (sector + 1) * sectorSize))
    return Buffer.concat(chunks).subarray(0, size)
  }

  const dirBytes = readSectors(firstDir, fat, Number.MAX_SAFE_INTEGER, false)
  const entries = []
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const nameLength = u16(dirBytes, at + 64)
    const type = dirBytes[at + 66]
    if (type === 0) continue
    entries.push({
      name: dirBytes.subarray(at, at + Math.max(0, nameLength - 2)).toString('utf16le'),
      type,
      start: u32(dirBytes, at + 116),
      size: u32(dirBytes, at + 120),
      left: u32(dirBytes, at + 68),
      right: u32(dirBytes, at + 72),
      child: u32(dirBytes, at + 76),
    })
  }
  const root = entries.find((entry) => entry.type === 5)
  assert.ok(root, '必须有 Root Entry')

  const miniFatBytes = miniFatSectorCount === 0
    ? Buffer.alloc(0)
    : readSectors(firstMiniFat, fat, miniFatSectorCount * sectorSize, false)
  const miniFat = []
  for (let at = 0; at + 4 <= miniFatBytes.length; at += 4) miniFat.push(u32(miniFatBytes, at))
  const miniStream = root.size === 0 ? Buffer.alloc(0) : readSectors(root.start, fat, root.size, false)

  const streams = {}
  for (const entry of entries) {
    if (entry.type !== 2) continue
    const useMini = entry.size < cutoff
    streams[entry.name] = readSectors(entry.start, useMini ? miniFat : fat, entry.size, useMini)
  }
  return { entries, streams, fat, miniFat }
}

function parseFib (word) {
  assert.equal(u16(word, 0), 0xa5ec, 'FIB.wIdent')
  assert.equal(u16(word, 2), 0x00c1, 'FIB.nFib = Word 97')
  assert.equal(u16(word, 12), 0x00bf, 'FIB.nFibBack')
  const flags = u16(word, 10)
  assert.ok(flags & 0x0200, 'fWhichTblStm=1：表流名为 1Table')
  assert.ok(flags & 0x1000, 'fExtChar=1：正文按 Unicode 解释')
  assert.equal(u16(word, 0x20), 0x000e, 'csw = 14')
  assert.equal(u16(word, 0x3e), 0x0016, 'cslw = 22')
  assert.equal(u16(word, 0x98), 0x00b7, 'cbRgFcLcb = 183（Word 2002 形状）')

  const pairCount = u16(word, 0x98)
  const pairs = new Map()
  for (let i = 0; i < pairCount; i++) {
    pairs.set(i, { fc: u32(word, 0x9a + i * 8), lcb: u32(word, 0x9a + i * 8 + 4) })
  }
  const newAt = 0x9a + pairCount * 8
  assert.equal(u16(word, newAt), 5, 'cswNew = 5')
  assert.equal(u16(word, newAt + 2), 0x0112, 'nFibNew = 0x0112')

  return {
    cbMac: u32(word, 0x40),
    ccpText: u32(word, 0x4c),
    pairs,
    flags,
  }
}

function parseClx (table, fc, lcb) {
  assert.equal(table[fc], 0x02, 'Clx 以 Pcdt 的 clxt=0x02 开头')
  const plcLength = u32(table, fc + 1)
  assert.equal(plcLength, lcb - 5, 'Pcdt.lcb 与 FIB 的 lcbClx 一致')
  const plc = table.subarray(fc + 5, fc + 5 + plcLength)
  const count = (plc.length - 4) / 12
  assert.ok(Number.isInteger(count) && count >= 1, 'PlcPcd 必须整条')
  const cps = []
  for (let i = 0; i <= count; i++) cps.push(u32(plc, i * 4))
  const pcdBase = (count + 1) * 4
  const pcds = []
  for (let i = 0; i < count; i++) {
    const at = pcdBase + i * 8
    const fcCompressed = u32(plc, at + 2)
    pcds.push({
      fc: fcCompressed & 0x3fffffff,
      compressed: (fcCompressed & 0x40000000) !== 0,
      prm: u16(plc, at + 6),
    })
  }
  return { cps, pcds }
}

function parsePlc (table, fc, lcb, recordBytes) {
  const count = (lcb - 4) / (4 + recordBytes)
  assert.ok(Number.isInteger(count) && count >= 1, 'PLC 长度必须能整除')
  const positions = []
  for (let i = 0; i <= count; i++) positions.push(u32(table, fc + i * 4))
  const records = []
  const base = fc + (count + 1) * 4
  for (let i = 0; i < count; i++) records.push(table.subarray(base + i * recordBytes, base + (i + 1) * recordBytes))
  return { positions, records }
}

function parsePapxFkp (word, pageNumber) {
  const base = pageNumber * 512
  const cpara = word[base + 511]
  assert.ok(cpara >= 1 && cpara <= 0x1d, 'PapxFkp.cpara 在 1..29')
  const rgfc = []
  for (let i = 0; i <= cpara; i++) rgfc.push(u32(word, base + i * 4))
  const rgbx = (cpara + 1) * 4
  const entries = []
  for (let i = 0; i < cpara; i++) {
    const bOffset = word[base + rgbx + i * 13]
    const at = base + bOffset * 2
    const cb = word[at]
    if (cb === 0) {
      const cbPrime = word[at + 1]
      assert.ok(cbPrime >= 1, 'PapxInFkp 扩展形式的 cb\' 至少为 1')
      assert.equal(word[at + 2] | (word[at + 3] << 8), 0, '空段落属性的 istd=0')
    } else {
      assert.ok(cb >= 2, 'PapxInFkp.cb 至少为 2')
    }
    entries.push({ bOffset, at })
  }
  return { cpara, rgfc, entries }
}

function parseChpxFkp (word, pageNumber) {
  const base = pageNumber * 512
  const crun = word[base + 511]
  assert.ok(crun >= 1 && crun <= 0x65, 'ChpxFkp.crun 在 1..101')
  const rgfc = []
  for (let i = 0; i <= crun; i++) rgfc.push(u32(word, base + i * 4))
  return { crun, rgfc }
}

function extractText (word, fib) {
  const clx = fib.pairs.get(33)
  assert.ok(clx && clx.lcb > 0, 'FIB 必须指向 piece table（pair 33）')
  const { cps, pcds } = parseClx(fib.table, clx.fc, clx.lcb)
  assert.equal(cps[0], 0, '第一个 CP 从 0 开始')
  assert.equal(cps[cps.length - 1], fib.ccpText, '最后一个 CP 等于 ccpText')
  assert.equal(pcds.length, 1, '纯文本只需要一个 piece')
  assert.equal(pcds[0].compressed, false, 'piece 必须是 UTF-16（fCompressed=0）')
  const pcd = pcds[0]
  const bytes = fib.ccpText * 2
  assert.ok(pcd.fc + bytes <= word.length, 'piece 的 fc 必须在 WordDocument 流内')
  return word.subarray(pcd.fc, pcd.fc + bytes).toString('utf16le')
}

function openDoc (buffer) {
  const cfb = readCfb(buffer)
  assert.ok(cfb.streams.WordDocument, '必须有 WordDocument 流')
  assert.ok(cfb.streams['1Table'], '必须有 1Table 流')
  const word = cfb.streams.WordDocument
  const table = cfb.streams['1Table']
  const fib = parseFib(word)
  fib.table = table
  return { cfb, word, table, fib }
}

// ---------------------------------------------------------------------------

test('生成的是 OLE2 复合文档，不是 RTF/HTML 改扩展名', () => {
  const file = createWordDoc('标题\r\n正文')
  assert.equal(file.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
  assert.notEqual(file.subarray(0, 5).toString('ascii'), '{\\rtf')
  assert.notEqual(file.subarray(0, 5).toString('ascii').toLowerCase(), '<!doc')
  const { cfb, word, table } = openDoc(file)
  assert.deepEqual(cfb.entries.map((entry) => entry.name).sort(), ['1Table', 'Root Entry', 'WordDocument'].sort())
  assert.ok(word.length > 0 && table.length > 0)
})

test('中文、emoji、制表符和 CRLF 换行原样往返', () => {
  const input = '我的书签（2 条）\r\n中文 😀 emoji\r\n第二段\tTab\r\n'
  const expected = input.replace(/\r\n/g, '\r')
  const { word, fib } = openDoc(createWordDoc(input))
  assert.equal(fib.ccpText, expected.length, 'ccpText 按 UTF-16 码元计数')
  assert.equal(extractText(word, fib), expected)
  assert.equal(extractText(word, fib).endsWith('\r'), true, '正文必须以段落标记结尾')
})

test('空字符串也生成一个合法空段落', () => {
  const { word, fib } = openDoc(createWordDoc(''))
  assert.equal(fib.ccpText, 1)
  assert.equal(extractText(word, fib), '\r')
  assert.equal(fib.pairs.get(6).lcb, 20, '一个 section 的 PlcfSed 是 20 字节')
})

test('FIB 是 Word 能接受的 2002 形状，且必要表都在表流范围内', () => {
  const { table, fib } = openDoc(createWordDoc('结构检查'))
  assert.equal(fib.pairs.size, 183)
  for (const index of [0, 1, 6, 12, 13, 15, 31, 33]) {
    const pair = fib.pairs.get(index)
    assert.ok(pair && pair.lcb > 0, 'pair ' + index + ' 必须存在')
    assert.ok(pair.fc + pair.lcb <= table.length, 'pair ' + index + ' 不能越出表流')
  }
  assert.deepEqual(fib.pairs.get(0), fib.pairs.get(1), 'StshfOrig 与 Stshf 指向同一份样式表')
})

test('样式表、字体表和 DOP 的内容可被独立读出', () => {
  const { table, fib } = openDoc(createWordDoc('样式'))
  const stsh = fib.pairs.get(1)
  assert.equal(u16(table, stsh.fc), 18, 'LPStshi.cbStshi = 18')
  assert.equal(u16(table, stsh.fc + 2), 15, 'cstd = 15 个固定槽位')
  assert.equal(u16(table, stsh.fc + 4), 10, 'cbSTDBaseInFile = 10')
  const normalAt = stsh.fc + 2 + 18 + 2 // 跳过 LPStshi 与第一个槽位的长度
  const normalNameLength = u16(table, normalAt + 10)
  assert.equal(table.subarray(normalAt + 12, normalAt + 12 + normalNameLength * 2).toString('utf16le'), 'Normal')

  const fonts = fib.pairs.get(15)
  assert.equal(u16(table, fonts.fc), 2, '字体表有两个字体')
  const firstFfn = fonts.fc + 4
  assert.equal(table[firstFfn + 1], 0x04, 'FFN flags = TrueType')
  assert.equal(u16(table, firstFfn + 2), 400, 'FFN weight = 400')
  const firstNameLength = table[firstFfn] // cbFfnM1 = total-1
  assert.ok(firstNameLength > 40)
  const firstName = table.subarray(firstFfn + 40, firstFfn + 40 + (firstNameLength - 41)).toString('utf16le')
  assert.equal(firstName, 'Times New Roman')

  const dop = fib.pairs.get(31)
  assert.equal(dop.lcb, 694, 'Dop2002 是 694 字节')
  assert.equal(u16(table, dop.fc + 10), 720, '默认制表位 720 twips')
  assert.equal(u32(table, dop.fc + 42), 3, 'DOP 记录字符数')
  assert.equal(u32(table, dop.fc + 48), 1, 'DOP 记录段落数')
})

test('PAPX/CHPX 的 bin table 指向 512 字节对齐的 FKP 页', () => {
  const { word, table, fib } = openDoc(createWordDoc('第一段\r第二段\r第三段'))
  const papx = parsePlc(table, fib.pairs.get(13).fc, fib.pairs.get(13).lcb, 4)
  const chpx = parsePlc(table, fib.pairs.get(12).fc, fib.pairs.get(12).lcb, 4)
  assert.equal(papx.positions[0], 2048, 'PAPX 的 aFC 从正文起点开始')
  assert.equal(papx.positions[papx.positions.length - 1], 2048 + fib.ccpText * 2, 'PAPX 覆盖到正文末尾')
  assert.equal(chpx.positions[0], 2048)
  assert.equal(chpx.positions[chpx.positions.length - 1], 2048 + fib.ccpText * 2)

  const papxPage = u32(papx.records[0], 0) & 0x3fffff
  const chpxPage = u32(chpx.records[0], 0) & 0x3fffff
  assert.equal(papxPage * 512 % 512, 0)
  assert.equal(chpxPage * 512 % 512, 0)
  const papxFkp = parsePapxFkp(word, papxPage)
  const chpxFkp = parseChpxFkp(word, chpxPage)
  assert.equal(papxFkp.cpara, 3, '三个段落应有三个 PAPX 条目')
  assert.equal(chpxFkp.crun, 1, '纯文本只有一个字符属性 run')
  assert.equal(papxFkp.rgfc[0], 2048)
  assert.equal(papxFkp.rgfc[3], 2048 + fib.ccpText * 2)
})

test('很多段落会跨多个 PAPX 页，长文本会走常规 FAT 扇区', () => {
  const lines = []
  for (let i = 0; i < 120; i++) lines.push('第' + i + '段：中文内容 😀 ' + 'x'.repeat(20))
  const input = lines.join('\r\n') + '\r\n'
  const { word, fib } = openDoc(createWordDoc(input))
  assert.ok(word.length >= 4096, '长文本的 WordDocument 流应超过 mini stream 阈值')
  assert.equal(extractText(word, fib), input.replace(/\r\n/g, '\r'))
  const papx = parsePlc(fib.table, fib.pairs.get(13).fc, fib.pairs.get(13).lcb, 4)
  assert.ok(papx.records.length >= 2, '120 段必须跨多个 PAPX 页')
  for (let i = 0; i < papx.records.length; i++) {
    const page = u32(papx.records[i], 0) & 0x3fffff
    const fkp = parsePapxFkp(word, page)
    assert.ok(fkp.cpara >= 1 && fkp.cpara <= 20)
  }
})

test('同样输入输出逐字节稳定', () => {
  const a = createWordDoc('稳定\r\n输出 😀')
  const b = createWordDoc('稳定\r\n输出 😀')
  assert.deepEqual(a, b)
})

test('结构化排版 .doc：合法多页 PAPX/CHPX FKP、保留字号/加粗/缩进 SPRM 且正文无损往返', () => {
  const blocks = [
    { text: '我的书签（2 本）', kind: 'title' },
    { text: '导出时间：2026-11-22 15:20 · 不含回收站', kind: 'subtitle' },
    { text: '番茄（2）', kind: 'section' },
  ]
  for (let i = 1; i <= 40; i++) {
    blocks.push({ text: i + '. 测试书名' + i, kind: 'heading' })
    blocks.push({ text: '成绩：作者 甲 · 24.3万字 · 在读 29.2万', kind: 'meta' })
    blocks.push({ text: '链接：https://example.invalid/' + i, kind: 'link' })
    blocks.push({ text: '第一行拆书笔记 😀\n第二行补充分析', kind: 'note' })
  }
  const buf = createStyledWordDoc(blocks)
  const { word, table, fib } = openDoc(buf)
  const text = extractText(word, fib)
  assert.ok(text.startsWith('我的书签（2 本）\r导出时间：2026-11-22 15:20 · 不含回收站\r番茄（2）\r'))
  assert.ok(text.includes('第一行拆书笔记 😀\r第二行补充分析\r'))

  // PAPX/CHPX bin tables 覆盖整段正文，且每个 FKP 页都在 512 字节合法边界内
  const papx = parsePlc(table, fib.pairs.get(13).fc, fib.pairs.get(13).lcb, 4)
  const chpx = parsePlc(table, fib.pairs.get(12).fc, fib.pairs.get(12).lcb, 4)
  assert.equal(papx.positions[0], 2048)
  assert.equal(papx.positions[papx.positions.length - 1], 2048 + fib.ccpText * 2)
  assert.equal(chpx.positions[0], 2048)
  assert.equal(chpx.positions[chpx.positions.length - 1], 2048 + fib.ccpText * 2)
  assert.ok(papx.records.length >= 2, '多段结构化文档应正确跨多个 PAPX FKP 页')
  for (let i = 0; i < papx.records.length; i++) {
    const page = u32(papx.records[i], 0) & 0x3fffff
    const fkp = parsePapxFkp(word, page)
    assert.ok(fkp.cpara >= 1 && fkp.cpara <= 29)
  }
  for (let i = 0; i < chpx.records.length; i++) {
    const page = u32(chpx.records[i], 0) & 0x3fffff
    const fkp = parseChpxFkp(word, page)
    assert.ok(fkp.crun >= 1 && fkp.crun <= 101)
  }
  // 同样输入逐字节确定
  assert.deepEqual(buf, createStyledWordDoc(blocks))
})
