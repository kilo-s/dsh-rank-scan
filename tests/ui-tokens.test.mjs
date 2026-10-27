import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 面板视觉底层守门（0.4.0）：
 *   颜色只能来自设计令牌 T；按钮不再回退成内联 style；提示条统一走 Banner；
 *   作用域样式表只注入一次。这些是后续所有页面都能复用的前提，被改回去就红。
 */
const s = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const tStart = s.indexOf('const T = {')
const tEnd = s.indexOf('const C = {')

test('颜色只在 T 里定义', () => {
  assert.ok(tStart > 0 && tEnd > tStart, '找不到 T/C 区块')
  const outside = s.slice(0, tStart) + s.slice(tEnd)
  const hits = outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|var\(--dsh-/g) || []
  assert.equal(hits.length, 0, '发现硬编码颜色：' + hits.join(' '))
})

test('按钮不再用内联 C.btn', () => {
  assert.ok(!/style: \{?\s*\.\.\.C\.btn\b|style: C\.btn(On)?\b/.test(s))
  assert.ok(s.includes('is-primary'))
})

test('提示条统一走 Banner（至少三处）', () => {
  assert.ok((s.match(/h\(Banner,/g) || []).length >= 3)
})

test('样式表只注入一次且带作用域前缀', () => {
  assert.ok(s.includes("getElementById('rank-scan-style')"))
  assert.ok(s.includes("id = 'rank-scan-style'"))
  assert.ok(s.includes('.rs-btn'))
})
