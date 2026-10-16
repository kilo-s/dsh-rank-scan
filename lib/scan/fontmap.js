import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const PUA_MIN = 0xe000;
const PUA_MAX = 0xf8ff;
export function isPuaChar(ch) {
    const v = ch.codePointAt(0);
    return v != null && v >= PUA_MIN && v <= PUA_MAX;
}
export function hasPua(s) {
    if (!s)
        return false;
    for (const ch of s)
        if (isPuaChar(ch))
            return true;
    return false;
}
export function loadFontMap(root) {
    const f = join(root, 'font-map.json');
    try {
        if (!existsSync(f))
            return {};
        const j = JSON.parse(readFileSync(f, 'utf8'));
        return j && typeof j === 'object' ? j : {};
    }
    catch {
        return {};
    }
}
export function saveFontMap(root, map) {
    writeFileSync(join(root, 'font-map.json'), JSON.stringify(map, null, 0) + '\n', 'utf8');
}
/** 用「PUA 文本 + 干净文本」学映射；等长才学（长度不等说明站点截断/改写，宁可不学） */
export function learnPair(puaText, cleanText, map) {
    if (!puaText || !cleanText)
        return 0;
    const a = [...puaText];
    const b = [...cleanText];
    if (a.length !== b.length)
        return 0;
    let learned = 0;
    for (let i = 0; i < a.length; i++) {
        if (!isPuaChar(a[i]))
            continue;
        const key = a[i].codePointAt(0).toString(16);
        const ch = b[i];
        if (isPuaChar(ch))
            continue;
        if (map[key] == null) {
            map[key] = ch;
            learned += 1;
        }
    }
    return learned;
}
/**
 * 番茄书名/作者可能是私用区码点（字体反爬）⇒ 落盘/出网前解一次；无码点或还没学到映射时原样返回。
 *
 * ★ 抽成模块函数（原来只有 index.ts 内部的闭包版）是为了让**书签**这条路径也能被离线测试钉住：
 *   书签的书名是从快照搬过来的，这里若漏了，用户的「我的书签」里就会长期留着方框乱码。
 */
export function decodeIfPua(root, s) {
    const v = s == null ? '' : String(s);
    if (!v)
        return null;
    if (!hasPua(v))
        return v;
    const map = loadFontMap(root);
    return Object.keys(map).length ? decodePua(v, map).text : v;
}
/** 解码：能查到的 PUA 换成真字，查不到的保留（并计数，供面板标「仍可疑」） */
export function decodePua(text, map) {
    if (!text)
        return { text: '', unknown: 0, total: 0 };
    let unknown = 0;
    let total = 0;
    let out = '';
    for (const ch of text) {
        if (isPuaChar(ch)) {
            total += 1;
            const hit = map[ch.codePointAt(0).toString(16)];
            if (hit)
                out += hit;
            else {
                out += ch;
                unknown += 1;
            }
        }
        else
            out += ch;
    }
    return { text: out, unknown, total };
}
//# sourceMappingURL=fontmap.js.map