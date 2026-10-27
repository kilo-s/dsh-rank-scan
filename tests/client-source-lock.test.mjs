import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readClientSource } from './_client-source.mjs'

/** 一次性守门：拆分提交必须与 v0.5.0 的 client/client.js 字节完全一致（提交 2 删除） */
test('parts 拼接结果与 v0.5.0 面板源字节一致', () => {
  const hash = createHash('sha256').update(readClientSource()).digest('hex')
  assert.equal(hash, 'c8967d30e4fea3a4e77410b2d283acee3c2c5ad670fde72618025615476c1fa2')
})
