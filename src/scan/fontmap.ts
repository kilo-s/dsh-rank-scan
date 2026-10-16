import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 番茄「字体反爬」解码表（2026-10-15 实测发现）：
 * 榜单接口返回的 bookName / author 里，部分汉字是**私用区码点**（U+E000–U+F8FF，例：转\uE4C2…），
 * 站点用自己的 webfont 把码点渲染成字。实测同一本书多次请求码点**稳定** ⇒ 可以学一张映射表。
 * 学的方式：补全时同时拿到「PUA 标题」与「干净标题」，**等长则逐位对齐**记录 PUA 码点 → 真实字。
 * 用的时候：扫描落盘前 / 面板渲染前做一次替换，解不出来的位置保持原样并标 titleSuspect。
 */
export type FontMap = Record<string, string>

const PUA_MIN = 0xe000
const PUA_MAX = 0xf8ff

export function isPuaChar(ch: string): boolean {
  const v = ch.codePointAt(0)
  return v != null && v >= PUA_MIN && v <= PUA_MAX
}

export function hasPua(s: string | null | undefined): boolean {
  if (!s) return false
  for (const ch of s) if (isPuaChar(ch)) return true
  return false
}

export function loadFontMap(root: string): FontMap {
  const f = join(root, 'font-map.json')
  try {
    if (!existsSync(f)) return {}
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' ? (j as FontMap) : {}
  } catch {
    return {}
  }
}

/**
 * ★ 审计-2/39：与 store 一致改**原子写**（先 .tmp 再 rename）。旧实现裸 writeFileSync：
 * 写盘瞬间被杀/断电会留下半截 JSON，而 loadFontMap 的 catch 直接返回 {} ⇒ 整张映射表静默丢失，
 * 番茄书名又变方块字。落盘 schema 不变（仍是 { 码点: 真字 }）。
 */
export function saveFontMap(root: string, map: FontMap): void {
  const p = join(root, 'font-map.json')
  const tmp = p + '.tmp'
  mkdirSync(root, { recursive: true })
  writeFileSync(tmp, JSON.stringify(map, null, 0) + '\n', 'utf8')
  renameSync(tmp, p)
}

/** 用「PUA 文本 + 干净文本」学映射；等长才学（长度不等说明站点截断/改写，宁可不学） */
export function learnPair(puaText: string | null | undefined, cleanText: string | null | undefined, map: FontMap): number {
  if (!puaText || !cleanText) return 0
  const a = [...puaText]
  const b = [...cleanText]
  if (a.length !== b.length) return 0
  let learned = 0
  for (let i = 0; i < a.length; i++) {
    if (!isPuaChar(a[i])) continue
    const key = a[i].codePointAt(0)!.toString(16)
    const ch = b[i]
    if (isPuaChar(ch)) continue
    if (map[key] == null) {
      map[key] = ch
      learned += 1
    }
  }
  return learned
}

/**
 * 番茄书名/作者可能是私用区码点（字体反爬）⇒ 落盘/出网前解一次；无码点或还没学到映射时原样返回。
 *
 * ★ 抽成模块函数（原来只有 index.ts 内部的闭包版）是为了让**书签**这条路径也能被离线测试钉住：
 *   书签的书名是从快照搬过来的，这里若漏了，用户的「我的书签」里就会长期留着方框乱码。
 */
export function decodeIfPua(root: string, s: string | null | undefined): string | null {
  const v = s == null ? '' : String(s)
  if (!v) return null
  if (!hasPua(v)) return v
  const map = loadFontMap(root)
  return Object.keys(map).length ? decodePua(v, map).text : v
}

/** 解码：能查到的 PUA 换成真字，查不到的保留（并计数，供面板标「仍可疑」） */
export function decodePua(text: string | null | undefined, map: FontMap): { text: string; unknown: number; total: number } {
  if (!text) return { text: '', unknown: 0, total: 0 }
  let unknown = 0
  let total = 0
  let out = ''
  for (const ch of text) {
    if (isPuaChar(ch)) {
      total += 1
      const hit = map[ch.codePointAt(0)!.toString(16)]
      if (hit) out += hit
      else {
        out += ch
        unknown += 1
      }
    } else out += ch
  }
  return { text: out, unknown, total }
}
