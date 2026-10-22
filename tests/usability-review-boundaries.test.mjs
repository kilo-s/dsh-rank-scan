import {test} from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8')
test('post scan freshness, timestamps and slim process only attempted batch results',()=>{
 const start=source.indexOf('    const batchIds = new Set(rec.batch?.boards')
 const end=source.indexOf('    /**\n     * ★ 2026-10-17（补全移出阻塞路径）',start)
 assert.ok(start>0&&end>start)
 const block=source.slice(start,end)
 const scope=block.slice(0,block.indexOf('    const samePeriodBoards'))
 const unchanged={boardId:'old',status:'ok',rows:[{key:'old'}]}
 const current={boardId:'new',status:'ok',rows:[{key:'new'}]}
 const selected=vm.runInNewContext(scope+'\nbatchBoards',{rec:{batch:{boards:['new']},boards:[unchanged,current]}})
 assert.equal(selected.length,1)
 assert.equal(selected[0],current)
 assert.equal((block.match(/for \(const b of batchBoards\)/g)||[]).length,5)
 assert.ok(!block.includes('for (const b of rec.boards)'))
})

test('one successful board cannot hide another failed board from fallback',()=>{
 const start=source.indexOf('  function sitesFailedToday('), end=source.indexOf('\n  /** 站 id',start)
 const normalized=ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2022})
 const state={boards:['qidiantu.shouding','qidiantu.sanjiang'],siteLastRun:{qidiantu:'2026-10-22'},siteTimes:{qidiantu:'12:40'},boardLastScan:{'qidiantu.shouding':{date:'2026-10-22',outcome:'ok',at:'2026-10-22T13:00:00'},'qidiantu.sanjiang':{date:'2026-10-22',outcome:'missing',at:'2026-10-22T13:00:00'}}}
 const run=vm.runInNewContext(normalized+'\nsitesFailedToday',{readState:()=>state,DEFAULT_SITE_TIMES:{},DEFAULT_FALLBACK_TIME:'22:30',siteOfBoard:b=>b.split('.')[0],hmOf:d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')})
 assert.equal(run(['qidiantu'],'2026-10-22')[0],'qidiantu')
 state.boardLastScan['qidiantu.sanjiang'].outcome='ok'
 assert.equal(run(['qidiantu'],'2026-10-22').length,0)
})
