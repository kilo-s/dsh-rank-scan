import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import vm from 'node:vm'

const source = readClientSource()
const responseFunction = source.slice(source.indexOf('    const readResponse ='), source.indexOf('    const jget ='))
const readResponse = vm.runInNewContext(responseFunction + '\nreadResponse')

test('HTTP failure with JSON must reject rather than clear a saved draft', async () => {
 await assert.rejects(readResponse({ok:false,status:503,json:async()=>({ok:false,error:'save unavailable'})}), /save unavailable/)
})
test('HTTP success carrying application error must also reject', async () => {
 await assert.rejects(readResponse({ok:true,status:200,json:async()=>({ok:false,note:'rejected'})}), /rejected/)
})
test('valid local read response remains available', async () => {
 const data={revision:'a',rows:[]}
 assert.equal(await readResponse({ok:true,status:200,json:async()=>data}),data)
})
