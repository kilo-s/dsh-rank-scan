import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { parseRankPage } from '../lib/sites/qidian-mobile.js'

const here = dirname(fileURLToPath(import.meta.url))

test('真实响应夹具（起点移动端 签约榜·轻小说）：20 条且字段齐备', () => {
  const html = readFileSync(join(here, 'fixtures', 'qidian-sign-cat12.html'), 'utf8')
  const parsed = parseRankPage(html)
  assert.equal(parsed.rows.length, 20)
  const r = parsed.rows[0]
  assert.ok(r.key && r.title && r.author, '书号/书名/作者不能为空')
  assert.equal(r.rank, 1)
  assert.ok(r.extra.cat && r.extra.subCat && r.extra.wordsText, '分类/子分类/字数不能为空')
  assert.deepEqual(parsed.rows.map((x) => x.rank), Array.from({ length: 20 }, (_, i) => i + 1))
})
