// Use the YAML parser shipped with installed DSH; never guess before destructive repair.
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, existsSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
const roots = [process.env.DSH_YAML_ROOT, ...String(process.env.PATH || '').split(delimiter)].filter(Boolean)
let yaml
for (const root of roots) {
  for (const candidate of [join(root, 'package.json'), join(root, 'node_modules/@deepseek-ai/dsh/package.json')]) {
    try { const req = createRequire(existsSync(candidate) ? realpathSync(candidate) : candidate); yaml = req('yaml'); break } catch {}
  }
  if (yaml) break
}
if (!yaml) { console.error('无法找到 DSH 的 YAML 解析器；未修改文件。请设置 DSH_YAML_ROOT 为 DSH 包目录。'); process.exit(2) }
let text
try { text = readFileSync(process.argv[2], 'utf8') } catch (e) { console.error(String(e)); process.exit(2) }
try {
  const doc = yaml.parseDocument(text)
  if (doc.errors.length || !yaml.isSeq(doc.contents)) { console.log('BAD:不是合法的 YAML 顶层数组'); process.exitCode = 1 }
  else console.log('OK:合法 YAML 顶层数组')
} catch (e) { console.log('BAD:' + String(e)); process.exitCode = 1 }
