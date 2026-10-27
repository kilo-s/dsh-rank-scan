import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 设置页保存语义（0.4.1）守门：
 *   · 只剩「即时」与「底栏保存」两类；零散保存入口不许回来
 *   · 保留天数改动只进草稿，绝不在 onChange 里直接删目录
 *   · settingsDiff 纯函数：改→脏、改回→不脏、captures 顺序不算脏、siteTimes 字段级比较
 *   · Toast 有自动消失计时，error 常驻；Panel 不再常驻渲染 msg
 */
const s = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const settingsStart = s.indexOf('function SettingsTab')
const versionStart = s.indexOf('function VersionRow')
const settingsSrc = s.slice(settingsStart, versionStart)
const panelStart = s.indexOf('function Panel(props)')
const panelEnd = s.indexOf('function apply(ctx)')
const panelSrc = s.slice(panelStart, panelEnd)

test('设置页不再有零散保存入口（应用 / 保存计划）', () => {
  assert.ok(settingsStart > 0 && versionStart > settingsStart, '找不到 SettingsTab 区块')
  assert.ok(!settingsSrc.includes("'应用'"), '请求间隔的「应用」按钮必须删掉')
  assert.ok(!settingsSrc.includes("'保存计划'"), '「保存计划」按钮必须删掉')
  assert.ok(settingsSrc.includes("'保存设置'"), '底栏主按钮还在')
  assert.ok(settingsSrc.includes("'立即生效'"), '即时开关旁要写「立即生效」')
  assert.ok(settingsSrc.includes("'确认保存'") && settingsSrc.includes('不可恢复'), '保留天数变短要有删除确认')
})

test('保留天数只在保存流程里提交，不在 onChange 里直接 jpost', () => {
  const at = settingsSrc.indexOf('value: String(retentionDays)')
  assert.ok(at > 0, '找不到保留天数 select')
  const block = settingsSrc.slice(at, at + 600)
  assert.ok(!block.includes("jpost('/retention'"), 'onChange 不许直接删目录')
  assert.ok(block.includes('setRetentionDays'), 'onChange 只改草稿')
  assert.ok(settingsSrc.includes("jpost('/retention'"), '真正的提交仍在底栏保存流程里')
})

test('settingsDiff：改→脏、改回→不脏、captures 顺序不算脏、siteTimes 字段级比较', () => {
  const dStart = s.indexOf('const settingsDiff = function')
  const braceAt = s.indexOf('{', dStart)
  let depth = 0
  let dEnd = -1
  for (let i = braceAt; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) { dEnd = i; break } }
  }
  assert.ok(dStart > 0 && dEnd > braceAt, '找不到 settingsDiff 函数体')
  const fn = new Function(s.slice(dStart, dEnd + 1) + '; return settingsDiff;')()
  const saved = {
    captures: ['a', 'b'], autoEnrich: true, qidianEnrich: false, requestIntervalMs: 1000,
    siteTimes: { qidian: '08:00' }, fallbackTime: '22:30', retentionDays: 180,
  }
  const clone = (x) => JSON.parse(JSON.stringify(x))
  assert.deepEqual(fn(saved, clone(saved)), [])
  assert.deepEqual(fn(saved, Object.assign({}, saved, { captures: ['b', 'a'] })), [], '顺序不同不算脏')
  assert.deepEqual(fn(saved, Object.assign({}, saved, { captures: ['a', 'b', 'c'] })), ['抓取范围'])
  assert.deepEqual(fn(saved, Object.assign({}, saved, { siteTimes: { qidian: '08:30' } })), ['计划时刻'])
  assert.deepEqual(fn(saved, Object.assign({}, saved, { siteTimes: { qidian: '08:00', sfacg: '09:00' } })), ['计划时刻'])
  const changed = Object.assign({}, saved, { captures: ['a', 'b', 'c'], requestIntervalMs: 500 })
  assert.deepEqual(fn(saved, changed), ['抓取范围', '请求间隔'])
  assert.deepEqual(fn(saved, Object.assign({}, changed, { captures: ['b', 'a'], requestIntervalMs: 1000 })), [])
})

test('Toast：success/info 有自动消失计时，error 常驻并带关闭按钮', () => {
  assert.ok(s.includes('const TOAST_MAX = 3'), '最多 3 条')
  assert.ok(s.includes("if (t.tone === 'error') return"), 'error 不排自动消失')
  assert.ok(s.includes('setTimeout(function () { drop(t.id) }, t.ms || 4000)'), '4 秒自动消失')
  assert.ok(s.includes("t.tone === 'error' ? 'alert' : 'status'"), 'error 用 role=alert')
  assert.ok(s.includes("className: 'rs-toast-x'"), 'error 有关闭按钮')
  assert.ok(s.includes('function ToastHost()') && s.includes('h(ToastHost, null)'), '面板挂载 ToastHost')
})

test('Panel 不再常驻渲染 msg', () => {
  assert.ok(panelStart > 0 && panelEnd > panelStart, '找不到 Panel 区块')
  assert.ok(!panelSrc.includes('setMsg('), 'Panel 不再用 setMsg')
  assert.ok(!/msg \? h\('div', \{ style: C\.muted \}, msg\)/.test(panelSrc), '页签下不再常驻 msg')
})
