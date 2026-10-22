import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 面板版式回归（2026-10-23 使用者现场反馈的四条）：
 *   ① 书签卡的「更多」菜单被面板裁掉 —— 画面超出界面；
 *   ② 面板不够大时作品只剩书名前的信息，后面一大片空白；
 *   ③ 最大化跟 DSH 桌面版的窗口按钮重叠，点不出来也收不回去；
 *   ④ 设置页「保存设置」吸底条是半透明的，勾选行从字缝里透出来。
 *
 * 这些是**版式**，没有 DOM 就没法真的跑一遍，所以这里守「结构特征」——
 * 把每个修法里最容易被后续编辑改回去的那一句钉住。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'client', 'client.js')
const BUNDLE = existsSync(join(ROOT, 'lib', 'client.js')) ? join(ROOT, 'lib', 'client.js') : SOURCE
const src = () => readFileSync(BUNDLE, 'utf8')

test('① 菜单相对视口定位：放不下就翻到上面、左右夹在视口里（不再被浮窗 overflow 裁掉）', () => {
  const s = src()
  assert.ok(s.includes("position: 'fixed', zIndex: 90"), '菜单必须是 fixed：absolute 会被浮窗的 overflow:hidden 裁掉')
  assert.ok(!s.includes("position: 'absolute', zIndex: 90, right: '0'"), '旧的 absolute + right:0 定位不许回来（卡片里的「更多」会往左溢出面板）')
  assert.ok(s.includes('vw - M - mw'), '左右必须夹在视口里')
  assert.ok(s.includes('vh - M - mh'), '上下必须夹在视口里')
  assert.ok(s.includes("const up = b.top - 4 - mh"), '下方放不下要翻到按钮上方')
  assert.ok(s.includes("document.addEventListener('scroll', onMove, true)"), '面板滚动时菜单要跟着按钮重新定位')
})

test('② 面板整块留在视口内（右下边界也夹，不只是左上）', () => {
  const s = src()
  assert.ok(s.includes('vw - w - M'), 'x 必须按「右边不出界」夹：只夹 x <= vw-80 会让整块面板挂到屏幕外')
  assert.ok(s.includes('vh - h - M'), 'y 必须按「底边不出界」夹')
})

test('② 窄面板：作品改成卡片行（名次/书名/作者/星标 + 指标 chip），不留大片空白', () => {
  const s = src()
  assert.ok(s.includes('const narrowRow = function (r, i)'), '窄面板必须有卡片行渲染')
  assert.ok(s.includes("narrow\n              ? h('div', null, data.rows.map(narrowRow))"), '窄的时候要走卡片行，不是「删掉次级列再让表格铺满」')
  const i = s.indexOf('const narrowRow = function (r, i)')
  const body = s.slice(i, i + 2600)
  assert.ok(body.includes('chipCols'), '卡片行要把该榜的指标做成 chip（否则被删掉的列就没处看了）')
  assert.ok(body.includes('BookmarkStar'), '卡片行也要能打书签')
})

test('③ 最大化让开应用顶栏，且最大化状态/还原尺寸都记住', () => {
  const s = src()
  assert.ok(s.includes('const topChromeInset = function ()'), '要能量出应用顶栏高度（桌面版窗口按钮就在那一带）')
  assert.ok(s.includes('const top = topChromeInset() + 8'), '最大化必须从顶栏下方开始，不能从 y=8 铺满全视口')
  assert.ok(s.includes("const LS_MAX = 'rank-scan-panel:max:v1'"), '最大化状态要落盘，否则收起再打开就丢了「还原」')
  assert.ok(s.includes('writeMaxState({ maxed: true, saved: savedRect.current })'), '要把还原尺寸一起存下来')
  assert.ok(!/setMaxed\(true\)\s*\n\s*setRect\(\{ x: 8, y: 8/.test(s), '最大化不许再直接 setRect 铺满视口（会污染用户拖出来的位置）')
  assert.ok(s.includes("maxed ? null : h(ResizeHandle"), '最大化时不该再显示缩放手柄')
})

test('④ 设置页吸底条要不透明、压在上面（勾选行不许透出来）', () => {
  const s = src()
  assert.ok(s.includes("position: 'sticky', bottom: '0', zIndex: 4"), '吸底条要有叠放层级')
  assert.ok(s.includes("background: 'var(--dsh-surface, #fff)'"), '吸底条必须是实色底（原来是 6%~12% 的半透明灰/黄）')
})

test('书签卡的「截止」只显示 MM-DD（mdOf 不许把 ISO 串整段切出来）', () => {
  const s = src()
  assert.ok(s.includes('s.length >= 10 ? s.slice(5, 10) : s'), 'mdOf 必须 slice(5, 10)，否则卡上显示 10-17T04:00:00.000Z')
})
