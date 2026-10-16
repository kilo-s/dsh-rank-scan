import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ★ 客户端 bundle 的「解析闸」+ 结构闸。
 *
 * 为什么必须有这个测试：2026-10-15 我用 edit 改 lib/client.js 时，替换串只覆盖到换行前，
 * 把一个孤立的 `|| '—'` 留在了 if 块后面 ⇒ **整个 bundle 语法错误**。
 * 后果不是「少个功能」而是**整个扫榜入口消失**（client 模块 import failed → web boot 报
 * "1 entry did not activate"），而且：
 *   - `node --check` 当时返回 0（这个 bundle 以模板字符串开头，CJS 解析路径没检查到内部）；
 *   - tsc 只编译 host 侧，根本不看 lib/client.js。
 * 所以必须有一个「真的把它当 JS 解析一遍」的测试，并且顺手守住几个结构特征。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 面板源在 client/client.js（入库，是唯一真源）；lib/client.js 由构建复制而来（不入库）。
// 优先测「真正会发货的那一份」，没有构建过时退回源文件，避免 clone 后未构建就整片红。
const SOURCE = join(ROOT, 'client', 'client.js')
const BUNDLE = existsSync(join(ROOT, 'lib', 'client.js')) ? join(ROOT, 'lib', 'client.js') : SOURCE

test('面板源在仓库里（client/client.js）', () => {
  assert.ok(existsSync(SOURCE), 'client/client.js 不在：面板源必须入库，否则 CI 从源码构建出的包装不上面板')
})

test('lib/client.js 与 client/client.js 内容一致（构建只是复制，不许各自漂移）', () => {
  const out = join(ROOT, 'lib', 'client.js')
  if (!existsSync(out)) return // 未构建：由 CI / 双闸门先构建后再查
  assert.equal(readFileSync(out, 'utf8'), readFileSync(SOURCE, 'utf8'), 'lib/client.js 与面板源不一致：先跑 scripts/build.sh')
})

test('客户端 bundle 必须能被 JS 解析（防 edit 留下孤立 token 变成语法错误）', () => {
  assert.ok(existsSync(BUNDLE), BUNDLE + ' 不存在')
  const src = readFileSync(BUNDLE, 'utf8')
  assert.ok(src.length > 1000, 'bundle 太小，不像完整产物')
  // new Function 会真的走一遍解析（语法错误会抛 SyntaxError）
  assert.doesNotThrow(() => new Function(src), 'lib/client.js 语法错误 ⇒ 整个面板会不加载')
})

test('★ 回归：healStore 必须能把「上一代的旧 store」补成当前形状（否则书签页签报 Cannot read …reading \'q\'）', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  const start = src.indexOf('const healStore = function (s) {')
  assert.ok(start >= 0, 'healStore 不在了（书签页签的防线没了）')
  const end = src.indexOf('\n    }', start)
  assert.ok(end > start, 'healStore 找不到结尾')
  const text = src.slice(start, end + '\n    }'.length)
  // healStore 是自包含的（不引用 jget/React/DOM），可以直接求值来测
  const healStore = new Function(text + '\n return healStore')()

  // 模拟「还没有我的书签页签」的那一代 store：什么都没有
  const old = { map: {}, total: 0, done: false, busy: {}, error: null, health: null, folders: [], subs: new Set() }
  const healed = healStore(old)
  assert.ok(healed.filters && typeof healed.filters === 'object', '旧 store 必须被补上 filters（崩溃根因）')
  assert.equal(healed.filters.q, '', 'filters.q 必须有默认值，否则 f.q 直接抛')
  assert.ok(healed.subs && typeof healed.subs.add === 'function', '缺少可用 subs 集合')
  assert.equal(typeof healed.refreshList, 'function', '缺少 refreshList 时也必须补上')
  assert.equal(typeof healed.trashList, 'function', '缺少 trashList 时也必须补上')
  assert.equal(typeof healed.listQuery, 'function', '缺少 listQuery 时也必须补上')
  assert.equal(healed.listQuery(), '', '默认过滤应为空（不带查询串）')

  // 更极端：连 filters 值本身都是垃圾
  const broken = healStore({ filters: null, map: null, busy: undefined, subs: null })
  assert.equal(broken.filters.q, '')
  assert.deepEqual(broken.map, {})
  assert.deepEqual(broken.busy, {})
  assert.ok(broken.subs instanceof Set)

  // 再极端：传进来的根本不是对象 ⇒ 原样返回，不许抛（healStore 会被到处调用）
  assert.equal(healStore(null), null)
  assert.equal(healStore(undefined), undefined)

  // 幂等：补两次形状不变，且 non-empty 的既有值不被清掉
  const withData = healStore({ filters: { q: '仙', site: 'qidian', folder: '', tag: '' }, subs: new Set() })
  assert.equal(withData.filters.q, '仙', '已有过滤值不许被重置')
  assert.equal(healStore(withData).filters.q, '仙')
})

test('★ 页签顺序：概览 → 当前榜单 → 我的书签 → 抓什么（既定口径）', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  const order = ['ov', 'board', 'bm', 'pick'].map((k) => src.indexOf("switchTab('" + k + "')"))
  order.forEach((idx, i) => assert.ok(idx >= 0, '页签 ' + ['ov', 'board', 'bm', 'pick'][i] + ' 不见了'))
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], '页签顺序错了：' + ['ov', 'board', 'bm', 'pick'][i] + ' 必须在 ' + ['ov', 'board', 'bm', 'pick'][i - 1] + ' 之后')
  }
})

test('★ 收藏/在读：卡片必须按站取标签，且说明数据来源', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  assert.match(src, /collectLabel/, '卡片没有读 collectLabel')
  assert.match(src, /b\.site === 'fanqie' \? '在读'/, '番茄必须显示「在读」而不是「收藏」')
  assert.match(src, /qidian-book-cache/, '缺少起点书页缓存这个来源的说明')
  assert.match(src, /来自书页刷新/, '缺少书页刷新来源的说明')
})
test('★ 书签卡「打开」必须与榜单页书名同路（DSH 侧栏浏览器），不是裸 target=_blank', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  // 书签页签必须拿到 openLink —— 否则又会退回新标签（使用者 2026-10-16 反馈的不一致）
  assert.match(src, /h\(BookmarksTab, \{ openLink: props\.openLink \}\)/, 'BookmarksTab 没拿到 openLink ⇒ 书签卡会退回新标签')
  assert.match(src, /\(props\.openLink \|\| function \(u\) \{ window\.open\(u, '_blank', 'noopener,noreferrer'\) \}\)\(b\.url\)/, '书签卡「打开」没有走 props.openLink')
  const bm = src.slice(src.indexOf('function BookmarksTab'), src.indexOf('function BoardTab'))
  assert.ok(bm.length > 100, 'BookmarksTab 段取不到')
  assert.ok(!/target: '_blank'/.test(bm), '书签页签里仍有裸 target=_blank 的链接')
})

test('★ 票 27：轮询必须与「展开 + 页面可见」耦合（收起不得继续轮询）', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  assert.match(src, /document\.visibilityState/, '缺少页面可见性判断')
  assert.match(src, /visibilitychange/, '缺少可见性变化监听')
  assert.match(src, /if \(!open\) return undefined/, '收起时没有提前返回 ⇒ 20s 轮询会继续跑')
})

test('★ 跨期不可比：变化列必须显示「新期」（行上带 extra.periodChanged 时）', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  // 判定必须排在 deltaGroup/数值判定**之前**，否则又会被 '＋ 新' / '—' 抢走
  assert.match(src, /ex\.periodChanged === true\) \? '新期'/, '变化列缺少「新期」分支')
  const idxNew = src.indexOf("'新期'")
  const idxPlus = src.indexOf("'＋ 新'")
  assert.ok(idxNew > 0 && idxPlus > 0, '两个分支都要在')
  assert.ok(idxNew < idxPlus, '「新期」判定必须排在「＋ 新」之前')
})

test('lib/client.js 关键结构特征还在（槽位注册 / 面板开合 / 站点判断）', () => {
  const src = readFileSync(BUNDLE, 'utf8')
  assert.match(src, /window\.__ModuleLoader__\.load/, '缺少 ModuleLoader 注册')
  assert.match(src, /shell\.overlay/, '缺少 shell.overlay 槽位注册（面板浮窗挂不上）')
  assert.match(src, /sidebar\.panellist/, '缺少左栏入口槽位')
  assert.match(src, /rank-scan-panel:open:v1/, '缺少面板开合记忆键（会退化成每次刷新都弹）')
  assert.match(src, /rank-scan-panel:autoopened:v1/, '缺少「首次安装弹一次」标记键')
  assert.match(src, /function openLink\(ctx, url\)/, 'openLink 签名丢了')
  // 单参数调用必须被兼容（否则「看起点图原始页」静默无效）
  assert.match(src, /typeof ctx === 'string'/, 'openLink 缺少单参数兼容分支')
})
