import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedFetch } from '../lib/scan/bounded-fetch.js'
import { createRequestGate } from '../lib/scan/rate-limit.js'

test('并发请求仍逐个取得限速许可', async () => {
  let now = 10000
  const starts = []
  const gate = createRequestGate({ nowMs: () => now, sleep: async ms => { await Promise.resolve(); now += ms } })
  await Promise.all(Array.from({length: 4}, async () => { await gate.beforeRequest(); starts.push(now) }))
  assert.ok(starts.slice(1).every((t, i) => t - starts[i] >= 1000), JSON.stringify(starts))
})

test('收到响应头后正文挂起仍受超时限制', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => ({ text: () => new Promise(() => {}) })
  try {
    await assert.rejects(async () => { const r = await boundedFetch('https://example.invalid', {timeoutMs: 25}); await r.text() }, /timeout/)
  } finally { globalThis.fetch = orig }
})

test('完整正文可重复以 text/json 读取', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true}')
  try { const r = await boundedFetch('https://example.invalid'); assert.equal(await r.text(), '{"ok":true}'); assert.deepEqual(await r.json(), {ok:true}) }
  finally { globalThis.fetch = orig }
})
