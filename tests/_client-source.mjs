import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 面板真源：client/parts/*.js 按文件名排序直接拼接（与 scripts/build.mjs 同口径） */
export const partsDir = fileURLToPath(new URL('../client/parts/', import.meta.url))

export function readClientSource() {
  return readdirSync(partsDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => readFileSync(join(partsDir, f), 'utf8'))
    .join('')
}

/** 带 build.mjs 的 part 标记行，用于和 lib/client.js 做一致性比较 */
export function buildClientBundle() {
  return readdirSync(partsDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => '/* ---- parts/' + f + ' ---- */\n' + readFileSync(join(partsDir, f), 'utf8'))
    .join('')
}
