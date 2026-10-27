import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 0.4.2 入口收拢守门：
 *   · 榜单页不再有「更多」/输入框；扫描本榜在操作条、disabled 看全局 scanBusy
 *   · 本榜设置是折叠 Section，按上架日回看只在 canDayQuery 为真时出现
 *   · 设置页每站只有一个动作，平铺成「补齐缺失」，不再有只含一项的 PopMenu
 */
const s = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const boardStart = s.indexOf('function BoardTab')
const panelStart = s.indexOf('function Panel(props)')
const boardSrc = s.slice(boardStart, panelStart)
const settingsStart = s.indexOf('function SettingsTab')
const versionStart = s.indexOf('function VersionRow')
const settingsSrc = s.slice(settingsStart, versionStart)

test('榜单页不再有「更多」菜单或菜单里的输入框', () => {
  assert.ok(boardStart > 0 && panelStart > boardStart, '找不到 BoardTab 区块')
  assert.ok(!boardSrc.includes('h(PopMenu'), '榜单页不许再有 PopMenu')
  assert.ok(!boardSrc.includes('menuItems'), 'menuItems 数组必须移除')
  assert.ok(!/rows:\s*h\(/.test(boardSrc), '菜单行里的表单必须移出')
})

test('扫描本榜在操作条里，disabled 条件含全局 scanBusy', () => {
  assert.match(boardSrc, /'扫描本榜（联网）'/, '扫描本榜按钮文字')
  assert.match(boardSrc, /props\.scanBusy \? '全局扫描进行中…' : '扫描本榜（联网）'/, '全局扫描时置灰并说明')
  assert.match(boardSrc, /disabled: props\.scanBusy \|\| busy/, 'disabled 必须含 scanBusy')
  assert.match(boardSrc, /marginTop: '4px', flexWrap: 'wrap'/, '操作条窄屏要换行')
  assert.ok(boardSrc.indexOf("'扫描本榜（联网）'") < boardSrc.indexOf("h(Section, { title: '本榜设置'"), '扫描按钮在操作条，不在本榜设置里')
})

test('本榜设置是折叠 Section；按上架日回看只在 canDayQuery 为真时渲染', () => {
  assert.match(boardSrc, /h\(Section, \{ title: '本榜设置', defaultOpen: false/, '条数要在本榜设置 Section 里')
  assert.match(boardSrc, /const canDay = canDayQuery\(curBoard\)/)
  assert.match(boardSrc, /canDay \? dateOpts\.concat\(\[\{ value: '__day', label: '按上架日回看…' \}\]\) : dateOpts/, '回看选项必须按能力拼接')
  assert.match(boardSrc, /dayOpen && canDay \?/, '回看输入行也必须按能力显示')
})

test('补全缺失只在操作条出现一次，Banner 只说明不带按钮', () => {
  assert.match(boardSrc, /'补全缺失 ' \+ enrichMissing \+ ' 条'/, '操作条要有补全按钮')
  assert.ok(!/label: '补全缺失字段/.test(boardSrc), '菜单里的补全项必须移除')
  const bannerAt = boardSrc.indexOf("h(Banner, { tone: 'warn', live: false }")
  assert.ok(bannerAt > 0, '补全未完成要有 Banner warn')
  const banner = boardSrc.slice(bannerAt, bannerAt + 500)
  assert.ok(!banner.includes('onClick'), 'Banner 里不许再放补全按钮')
})

test('设置页每站只有一个动作，平铺成「补齐缺失」', () => {
  assert.ok(settingsStart > 0 && versionStart > settingsStart, '找不到 SettingsTab 区块')
  assert.ok(!settingsSrc.includes('h(PopMenu'), '设置页不许再有只含一项的 PopMenu')
  assert.match(settingsSrc, /'补齐缺失'/, '同行的 is-ghost 按钮')
  assert.ok(settingsSrc.includes('（联网：逐本 1 请求'), '补齐缺失的 title 要说明联网')
})

test('Panel 统一算 scanBusy 并传给 BoardTab', () => {
  assert.match(s, /const scanBusy = scanLive \|\| scanActBusy/)
  assert.match(s, /scanBusy: scanBusy/)
  assert.match(s, /onScanned: reload/)
})
