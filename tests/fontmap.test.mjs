import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeIfPua, decodePua, hasPua, learnPair, isPuaChar, saveFontMap } from '../lib/scan/fontmap.js'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const P = (n) => String.fromCodePoint(0xe000 + n)

test('isPuaChar/hasPua 识别私用区码点', () => {
  assert.equal(isPuaChar(P(1)), true)
  assert.equal(isPuaChar('转'), false)
  assert.equal(hasPua('转' + P(2) + '生'), true)
  assert.equal(hasPua('转生天使'), false)
})

test('learnPair：等长逐位学，长度不等不学，已存在的不覆盖', () => {
  const map = {}
  const n = learnPair('转' + P(1) + '，沦' + P(2) + '恶魔', '转生，沦为恶魔', map)
  assert.equal(n, 2)
  assert.equal(map[(0xe000 + 1).toString(16)], '生')
  assert.equal(map[(0xe000 + 2).toString(16)], '为')
  // 长度不等 ⇒ 不学
  assert.equal(learnPair('转' + P(3), '转生天使', map), 0)
  // 已学会的不被改写
  assert.equal(learnPair('转' + P(1), '转x', map), 0)
  assert.equal(map[(0xe000 + 1).toString(16)], '生')
})

test('decodePua：查到的换真字，查不到的保留并计数', () => {
  const map = { [(0xe000 + 1).toString(16)]: '生' }
  const r = decodePua('转' + P(1) + '，' + P(9) + '魔', map)
  assert.equal(r.text, '转生，' + P(9) + '魔')
  assert.equal(r.total, 2)
  assert.equal(r.unknown, 1)
})

test('★ decodeIfPua（书签搬快照书名走的这条路径）：干净原样、有映射就解、没映射不炸', () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-font-'))
  mkdirSync(join(root, 'state'), { recursive: true })
  // 没有 fontmap 文件时：含 PUA 也原样返回，不能崩
  assert.equal(decodeIfPua(root, null), null)
  assert.equal(decodeIfPua(root, ''), null)
  assert.equal(decodeIfPua(root, 12345), '12345')
  assert.equal(decodeIfPua(root, '网恋翻车，沦为黑道大小姐的女仆'), '网恋翻车，沦为黑道大小姐的女仆', '干净文本必须逐字不变')
  const dirty = '转' + P(1) + '天使'
  assert.equal(decodeIfPua(root, dirty), dirty, '还没学到映射 ⇒ 保留原样（不要瞎猜）')
  // 学到映射后：应解出真字
  const map = {}
  learnPair(dirty, '转生天使', map)
  saveFontMap(root, map)
  assert.equal(decodeIfPua(root, dirty), '转生天使', '有映射 ⇒ 解成真字（否则书签里会长期留着方框）')
  assert.equal(decodeIfPua(root, '转' + P(9) + '天使'), '转' + P(9) + '天使', '没学过的码点保留，不猜')
})

test('decodePua：全干净文本原样返回', () => {
  const r = decodePua('网恋翻车，沦为黑道大小姐的女仆', {})
  assert.equal(r.text, '网恋翻车，沦为黑道大小姐的女仆')
  assert.equal(r.total, 0)
})
