import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { partsDir, readClientSource } from './_client-source.mjs'

const files = readdirSync(partsDir).filter((f) => f.endsWith('.js')).sort()

test('parts 文件名符合 NN-name.js，且编号不重复', () => {
  const seen = new Set()
  for (const f of files) {
    assert.match(f, /^\d{2}-[a-z0-9-]+\.js$/, '文件名不符合 NN-name.js：' + f)
    const n = f.slice(0, 2)
    assert.ok(!seen.has(n), '编号重复：' + n)
    seen.add(n)
  }
  assert.ok(files.length >= 2, '至少要有头尾两个 part')
})

test('除 00/90 外单个 part 不超过 900 行', () => {
  for (const f of files) {
    if (f.startsWith('00-') || f.startsWith('90-')) continue
    const lines = readFileSync(join(partsDir, f), 'utf8').split('\n').length
    assert.ok(lines <= 900, f + ' 超过 900 行：' + lines)
  }
})

test('拼接结果通过 new Function 语法检查', () => {
  assert.doesNotThrow(() => new Function(readClientSource()), 'parts 拼接后有语法错误')
})

test('每个顶层 function 组件只在一个 part 里定义', () => {
  const owners = new Map()
  for (const f of files) {
    const src = readFileSync(join(partsDir, f), 'utf8')
    for (const m of src.matchAll(/^    function ([A-Za-z0-9_]+)\(/gm)) {
      const name = m[1]
      if (!owners.has(name)) owners.set(name, [])
      owners.get(name).push(f)
    }
  }
  const dup = [...owners.entries()].filter(([, arr]) => arr.length > 1)
  assert.deepEqual(dup, [], '重复定义：' + dup.map(([n, arr]) => n + '@' + arr.join(',')).join('; '))
})
