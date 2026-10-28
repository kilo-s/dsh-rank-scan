import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import vm from 'node:vm'

const source=readClientSource()
const block=source.slice(source.indexOf("const DRAFT_KEY ="),source.indexOf('/** 脏状态登记'))
function load(storage){return vm.runInNewContext(block+'\nDRAFTS',{window:{},sessionStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v}}})}
test('unsaved settings survive a fresh module evaluation and clearing stays cleared',()=>{
 const storage={}
 const first=load(storage)
 first.settings={picked:['qidiantu.shouding'],times:{qidiantu:'03:21'},dirty:false}
 const restored=load(storage)
 assert.equal(restored.settings.times.qidiantu,'03:21')
 restored.settings=null
 assert.equal(load(storage).settings,null)
})
test('invalid stored draft fails closed to empty editable state',()=>{
 assert.equal(load({'rank-scan-panel:drafts:v1':'{invalid'}).settings,null)
})
