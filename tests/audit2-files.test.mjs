import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSlim, sweepTmp, writeSlim } from '../lib/scan/files.js'
import { loadFontMap, saveFontMap } from '../lib/scan/fontmap.js'

/** 审计-2/39：原子写统一 + 残留 .tmp 清扫 */
const root0 = () => mkdtempSync(join(tmpdir(), 'rank-a2-'))

test('★ 39：writeSlim 原子写——不留 .tmp、内容可读回、覆盖已存在文件', () => {
  const root = root0()
  writeSlim(root, { dataDate: '2026-10-14', boards: { b: [{ key: 'k1', rank: 1, metric: 2 }] } })
  assert.equal(readSlim(root, '2026-10-14').boards.b[0].key, 'k1')
  writeSlim(root, { dataDate: '2026-10-14', boards: {} }) // 覆盖同日（幂等）
  assert.deepEqual(readSlim(root, '2026-10-14').boards, {})
  assert.deepEqual(readdirSync(join(root, 'slim')).filter((f) => f.endsWith('.tmp')), [], '原子写不得留下 .tmp')
})

test('★ 39：sweepTmp 清扫数据目录内的残留 .tmp，且不碰正常文件', () => {
  const root = root0()
  mkdirSync(join(root, 'state'), { recursive: true })
  mkdirSync(join(root, '2026-10-14'), { recursive: true })
  writeFileSync(join(root, 'state', 'scan.lock.json.tmp'), 'x')
  writeFileSync(join(root, 'state', 'config.json'), '{"keep":1}')
  writeFileSync(join(root, '2026-10-14', 'b.json.tmp'), 'x')
  writeFileSync(join(root, '2026-10-14', 'b.json'), '{"keep":1}')
  const n = sweepTmp(root)
  assert.equal(n, 2, '应扫掉两个 .tmp')
  assert.equal(existsSync(join(root, 'state', 'scan.lock.json.tmp')), false)
  assert.equal(existsSync(join(root, '2026-10-14', 'b.json.tmp')), false)
  assert.ok(existsSync(join(root, 'state', 'config.json')), '配置不得被删')
  assert.ok(existsSync(join(root, '2026-10-14', 'b.json')), '快照不得被删')
})

test('★ 39：saveFontMap 原子写且能读回', () => {
  const root = root0()
  saveFontMap(root, { e4c2: '转' })
  assert.equal(loadFontMap(root).e4c2, '转')
  assert.equal(existsSync(join(root, 'font-map.json.tmp')), false, '原子写不得留下 .tmp')
})
