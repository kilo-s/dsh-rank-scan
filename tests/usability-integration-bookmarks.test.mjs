import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

function harness() {
 const root = mkdtempSync(join(process.cwd(), '.tmp-usability-integration-'))
 mkdirSync(join(root, 'state'))
 writeFileSync(join(root, 'state/config.json'), JSON.stringify({boards:['fanqie.derived.period'],display:['fanqie.derived.period'],timerEnabled:false,timerSchemaV:3}))
 const book = { bookKey: 'fanqie:1000000000000000001', site: 'fanqie', url: 'https://fanqienovel.com/page/1000000000000000001', source: 'manual', firstSeen: null, seenBoards: [], title: 'Fixture', author: null, words: null, metric: null, metricBoard: null, capturedAt: '2026-10-22T00:00:00Z', valueFrom: 'manual', note: 'original', folders: ['old'], createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }
 const file = join(root, 'state/bookmarks.json')
 writeFileSync(file, JSON.stringify({ bookmarksVersion: 1, bookmarks: [book], savedAt: '2026-10-22T00:00:00Z' }))
 let handler
 const disposers = []
 apply({
  effect(fn) {
   const dispose = fn()
   if (typeof dispose === 'function') disposers.push(dispose)
  },
  setInterval() { return { dispose() {} } },
  webServer: {
   register(route) {
    handler = route.handler
    return () => {}
   },
  },
  logger: { info() {} },
 }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [] })
 async function call(url, body, headers={}) {
  const listeners={}; let code; let raw=''
  const req={url,method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:19387','content-type':'application/json',...headers},setEncoding(){},on(k,f){(listeners[k]||=[]).push(f);return req}}
  const p=handler(req,{writeHead(c){code=c},setHeader(){},end(v){raw=String(v||'')}})
  queueMicrotask(()=>{if(body!==undefined)for(const f of listeners.data||[])f(JSON.stringify(body));for(const f of listeners.end||[])f()})
  await p; return {code,body:JSON.parse(raw)}
 }
 return {
  root, file, book, call,
  cleanup() {
   for (const dispose of disposers) dispose()
   rmSync(root, { recursive: true, force: true })
  },
 }
}

test('bookmark route saves note and multiple folders together without rounding large identifiers', async()=>{
 const h=harness()
 try {
  const r=await h.call('/api/rank-scan/bookmark',{action:'update',bookKey:h.book.bookKey,note:'updated #tag',folders:['first','second']})
  assert.equal(r.code,200)
  const saved=JSON.parse(readFileSync(h.file,'utf8')).bookmarks[0]
  assert.equal(saved.bookKey,h.book.bookKey)
  assert.equal(saved.note,'updated #tag')
  assert.deepEqual(saved.folders,['first','second'])
  assert.equal(saved.capturedAt,h.book.capturedAt,'user editing must not pretend source data was refreshed')
 }finally{h.cleanup()}
})

test('missing bookmark edit reports failure and preserves existing user content',async()=>{
 const h=harness()
 try {
  const before=readFileSync(h.file,'utf8')
  const r=await h.call('/api/rank-scan/bookmark',{action:'update',bookKey:'qidian:999999999',note:'unsaved',folders:['new']})
  assert.ok(r.code>=400 || r.body.ok===false,'missing target cannot report success')
  assert.equal(readFileSync(h.file,'utf8'),before)
 }finally{h.cleanup()}
})

test('derived board is not reported as missing or hidden by overview',async()=>{
 const h=harness()
 try {
  const r=await h.call('/api/rank-scan/overview')
  assert.equal(r.code,200)
  const board=r.body.sites.flatMap(s=>s.boards).find(b=>b.boardId==='fanqie.derived.period')
  assert.ok(board)
  assert.equal(board.status,'ok')
  assert.equal(r.body.hiddenCount,0)
 }finally{h.cleanup()}
})

test('rejected cross-origin edit leaves bookmark content unchanged',async()=>{
 const h=harness()
 try {
  const before=readFileSync(h.file,'utf8')
  const r=await h.call('/api/rank-scan/bookmark',{action:'update',bookKey:h.book.bookKey,note:'rejected',folders:[]},{origin:'https://untrusted.invalid'})
  assert.equal(r.code,403)
  assert.equal(readFileSync(h.file,'utf8'),before)
 }finally{h.cleanup()}
})
