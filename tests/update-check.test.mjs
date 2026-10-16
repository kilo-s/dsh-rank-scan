import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, updateAvailability, planUpdateCheck, describeCheck } from '../lib/scan/update-check.js'

/**
 * 更新链路的两条硬纪律（用测试钉住，防以后改着改着就「自己动手」）：
 *   ① 没有提供方 / 提供方不支持 ⇒ **不许**显示可点的更新按钮，只能优雅降级；
 *   ② 重启动作**只**由「宿主回报 restartRequired + 提供方 restartSupported」共同决定，
 *      任何一侧不成立 ⇒ 退回 manual（让用户自己重启），不许偷偷重启。
 */

const caps = (over = {}) => ({
  apiVersion: '1',
  endpoints: { capabilities: '/dsh-market/api/v1/capabilities', updates: '/dsh-market/api/v1/updates', updateOperation: '/dsh-market/api/v1/operations', restart: '/dsh-market/api/v1/restart' },
  restartSupported: true,
  canUpdate: true,
  ...over,
})

test('版本比较：数字段、补零、预发布低于同号正式版；拿不准判相等（不提示更新）', () => {
  assert.equal(compareVersions('0.1.0', '0.0.1'), 1, '0.1.0 比 0.0.1 新')
  assert.equal(compareVersions('0.0.1', '0.1.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0, '缺段按 0 补')
  assert.equal(compareVersions('0.1.0', '0.1'), 0)
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1, '必须按数字比，不是字符串比')
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1, '预发布低于正式版')
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1, '预发布之间按段比')
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0, '容忍 v 前缀')
  assert.equal(compareVersions('', '0.1.0'), -1, '空串当 0')
})

test('能力探测三态：无提供方 / 提供方不完整 / 可用（都不许当成错误）', () => {
  assert.equal(updateAvailability(null).availability, 'no-provider')
  assert.ok(updateAvailability(null).reason.includes('dsh-market'), '要明确说出缺什么')
  assert.equal(updateAvailability({}).availability, 'provider-unsupported')
  assert.equal(updateAvailability(caps({ apiVersion: null })).availability, 'provider-unsupported')
  assert.equal(updateAvailability(caps({ endpoints: {} })).availability, 'provider-unsupported', '缺更新端点 ⇒ 不支持')
  assert.equal(updateAvailability(caps({ canUpdate: false })).availability, 'provider-unsupported')
  assert.equal(updateAvailability(caps()).availability, 'ok')
})

test('无提供方：只读降级 —— 显示当前版本、按钮不可点、动作是 manual', () => {
  const r = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: null, source: 'npm' })
  assert.equal(r.state, 'unavailable')
  assert.equal(r.canUpdateInPlace, false, '探测不到提供方时绝不允许就地更新')
  assert.equal(r.action, 'manual')
  assert.equal(r.current, '0.1.0')
  assert.ok(r.reason.includes('dsh-market'))
  assert.ok(describeCheck(r, 'npm').includes('dsh-market'))
})

test('可用 + 有新版 ⇒ 可更新；已最新 ⇒ 不给按钮', () => {
  const up = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: caps(), source: 'npm' })
  assert.equal(up.state, 'update-available')
  assert.equal(up.canUpdateInPlace, true)
  assert.equal(up.buttonLabel, '更新到 0.2.0')
  assert.ok(describeCheck(up, 'npm').includes('0.1.0 → 可更新到 0.2.0'))
  const same = planUpdateCheck({ current: '0.2.0', latest: '0.2.0', provider: caps() })
  assert.equal(same.state, 'latest')
  assert.equal(same.canUpdateInPlace, false)
  const older = planUpdateCheck({ current: '0.3.0', latest: '0.2.0', provider: caps() })
  assert.equal(older.state, 'latest', '线上更旧 ⇒ 不提示更新（绝不给降级按钮）')
})

test('进行中 / 失败：状态机接管按钮，失败按可重试性给文案', () => {
  const running = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: caps(), operation: { state: 'running' } })
  assert.equal(running.state, 'busy')
  assert.equal(running.canUpdateInPlace, false, '更新中不许再点')
  assert.equal(running.buttonLabel, '更新中…')
  const failed = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: caps(), operation: { state: 'failed', code: 'RESOLVED_VERSION_MISMATCH', message: '镜像滞后', retryable: true } })
  assert.equal(failed.state, 'failed')
  assert.equal(failed.canUpdateInPlace, true, '可重试 ⇒ 允许再点')
  assert.ok(failed.reason.includes('RESOLVED_VERSION_MISMATCH'))
  assert.equal(failed.buttonLabel, '重试更新')
  const dead = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: caps(), operation: { state: 'failed', message: '不可重试', retryable: false } })
  assert.equal(dead.canUpdateInPlace, false)
  const rolled = planUpdateCheck({ current: '0.1.0', latest: '0.2.0', provider: caps(), operation: { state: 'rolled-back' } })
  assert.ok(rolled.reason.includes('回滚'))
})

test('★ 成功后的动作：只认宿主回报的标志；重启按钮还要求提供方支持重启', () => {
  // 要求重启 + 提供方支持 ⇒ restart
  const r1 = planUpdateCheck({ current: '0.1.0', provider: caps(), operation: { state: 'succeeded', installedVersion: '0.2.0', restartRequired: true } })
  assert.equal(r1.action, 'restart')
  assert.equal(r1.current, '0.2.0', '成功后显示的是实际装上的版本')
  assert.equal(r1.buttonLabel, '重启 DSH 生效')
  // 要求重启但提供方**不支持重启**（桌面版/被监管宿主）⇒ 必须退回 manual，绝不偷偷重启
  const r2 = planUpdateCheck({ current: '0.1.0', provider: caps({ restartSupported: false }), operation: { state: 'succeeded', restartRequired: true } })
  assert.equal(r2.action, 'manual')
  assert.equal(r2.canUpdateInPlace, false)
  // 只要求刷新 ⇒ refresh
  const r3 = planUpdateCheck({ current: '0.1.0', provider: caps(), operation: { state: 'succeeded', refreshRequired: true } })
  assert.equal(r3.action, 'refresh')
  // 两个都没要求 ⇒ none
  const r4 = planUpdateCheck({ current: '0.1.0', provider: caps(), operation: { state: 'succeeded' } })
  assert.equal(r4.action, 'none')
  assert.equal(r4.state, 'latest')
  assert.ok(describeCheck(r4).includes('0.1.0'))
})

test('提供方支持但还没查到线上版本 ⇒ 显示「检查更新」，不给就地更新', () => {
  const r = planUpdateCheck({ current: '0.1.0', latest: null, provider: caps() })
  assert.equal(r.state, 'unavailable')
  assert.equal(r.canUpdateInPlace, false)
  assert.equal(r.buttonLabel, '检查更新')
  assert.ok(r.reason.includes('还没查到'))
})
