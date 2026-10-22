import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { FileStore } from '../lib/scan/store.js'
import { readSlim, writeSlim } from '../lib/scan/files.js'

function harness(sitesFactory = () => []) {
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
 }, { dataDir: root, timerFreshMs: 0, sitesFactory })
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

test('untrusted raw snapshot never contributes overview change counts', async()=>{
 const h=harness()
 try {
  const b='qidiantu.shouding', store=new FileStore(h.root)
  const row={key:'1',rank:1,value:10,title:'Fixture',author:null,url:null}
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-21',metric:'value',rows:[row]})
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-22',metric:'value',rows:[{...row,value:50}]})
  store.markUntrusted('2026-10-22',b,{reason:'rejected',at:new Date().toISOString(),by:'manual'})
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify({boards:[b],display:[b],timerEnabled:false,timerSchemaV:3}))
  const r=await h.call('/api/rank-scan/overview')
  const board=r.body.sites.flatMap(s=>s.boards).find(x=>x.boardId===b)
  assert.equal(board.trusted,false)
  assert.equal(board.up,null)
  assert.equal(board.newCount,null)
  assert.equal(board.out,null)
 } finally {h.cleanup()}
})

test('verified historical save merges slim without deleting another board',async()=>{
 const b='qidiantu.shouding', date='2026-10-20'
 const site={id:'qidiantu',site:'Fixture',metric:'value',boards:[b],contentDateFor:()=> '2026-10-19',async fetchBoard(){return{boardId:b,status:'ok',rows:[{key:'1',rank:1,value:12,title:'Fixture',author:null,url:null}],contentDate:'2026-10-19',requests:1,durationMs:1,warnings:[]}}}
 const h=harness(()=>[site])
 try {
  writeSlim(h.root,{dataDate:date,boards:{other:[{key:'other',rank:1,metric:3}]}})
  const r=await h.call('/api/rank-scan/day',{boardId:b,date,save:true})
  assert.equal(r.code,200,JSON.stringify(r.body))
  const slim=readSlim(h.root,date)
  assert.equal(slim.boards[b][0].key,'1')
  assert.equal(slim.boards.other[0].key,'other')
 }finally{h.cleanup()}
})

test('period rollover excludes entire board from changes and overview counts',async()=>{
 const h=harness(), b='qidiantu.sanjiang', store=new FileStore(h.root)
 try {
  const row=(key,periodStart)=>({key,rank:null,value:12,title:key,author:null,url:null,extra:{periodStart}})
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-17',metric:'value',rows:[row('old','2026-10-11')]})
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-19',metric:'value',rows:[row('new','2026-10-18')]})
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify({boards:[b],display:[b],timerEnabled:false,timerSchemaV:3}))
  const overview=await h.call('/api/rank-scan/overview')
  const board=overview.body.sites.flatMap(s=>s.boards)[0]
  assert.equal(board.newCount,null)
  assert.equal(board.out,null)
  const changes=await h.call('/api/rank-scan/changes')
  assert.equal(changes.body.count,0)
  assert.equal(changes.body.firstEver,false)
  const detail=await h.call('/api/rank-scan/board?boardId='+b+'&date=2026-10-19')
  assert.equal(detail.body.crossPeriod,true)
  assert.equal(detail.body.counts,null)
  assert.ok(changes.body.excluded.some(x=>x.boardId===b&&x.reason.includes('新期不可比')))
 }finally{h.cleanup()}
})

test('change totals include every entry beyond twenty and expose default capture set',async()=>{
 const h=harness(), b='qidiantu.shouding', store=new FileStore(h.root)
 try{
  const row=key=>({key,rank:1,value:12,title:key,author:null,url:null})
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-21',metric:'value',rows:[row('old')]})
  await store.writeSnapshot({boardId:b,dataDate:'2026-10-22',metric:'value',rows:Array.from({length:35},(_,i)=>row('new'+i))})
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify({boards:[b],display:[b],timerEnabled:false,timerSchemaV:3}))
  const changes=await h.call('/api/rank-scan/changes')
  assert.equal(changes.body.count,36)
  const group=changes.body.sites[0].groups.find(g=>g.group==='新入榜')
  assert.equal(group.count,35)
  assert.equal(group.items.length,35)
  const catalog=await h.call('/api/rank-scan/catalog')
  assert.ok(catalog.body.defaultCaptures.length>0)
 }finally{h.cleanup()}
})

test('unattempted boards distinguish waiting from due without fabricating attempts',async()=>{
 const h=harness(), b='qidiantu.shouding'
 try{
  const config={boards:[b],display:[b],timerEnabled:true,timerSchemaV:3,installedAt:'2000-01-01',siteTimes:{qidiantu:'23:59'}}
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify(config))
  const get=async()=> (await h.call('/api/rank-scan/overview')).body.sites.flatMap(s=>s.boards)[0]
  const waiting=await get()
  assert.equal(waiting.scheduleState,'waiting')
  assert.equal(waiting.attempt,null)
  config.siteTimes.qidiantu='00:00'
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify(config))
  assert.equal((await get()).scheduleState,'due')
 }finally{h.cleanup()}
})

test('reported fallback does not repeat a site already retried today',async()=>{
 const h=harness(), now=new Date(), today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
 try{
  const b='qidiantu.shouding'
  writeFileSync(join(h.root,'state/config.json'),JSON.stringify({boards:[b],display:[b],timerEnabled:false,timerSchemaV:3,installedAt:'2000-01-01',siteTimes:{qidiantu:'00:00'},fallbackTime:'00:00',siteLastRun:{qidiantu:today},siteRetry:{qidiantu:today},boardLastScan:{[b]:{date:today,at:now.toISOString(),outcome:'missing'}},staleFlag:{[b]:{date:today}}}))
  const r=await h.call('/api/rank-scan/timer-plan')
  assert.ok(!r.body.plan.fallback.includes('qidiantu'))
 }finally{h.cleanup()}
})
