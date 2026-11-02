import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ★ 宿主侧「不连累 DSH 本体」的结构闸（2026-10-16，审计 P0-1 / P0-2）。
 *
 * 为什么是文本断言而不是行为测试：checkTimer 的兜底与两个路由入口都在插件工厂闭包里，
 * 在没有宿主的环境里跑不到那两条失败路径；而这两条一旦退回去，代价分别是
 * 「整个 DSH 进程退出（宿主 fail-loud）」与「数据目录被删」。宁可栅栏粗糙，也不能没有。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const FILES = readFileSync(join(ROOT, 'src', 'scan', 'files.ts'), 'utf8')

test('★ 宿主侧禁止 __dirname（插件是 ESM，用了就 500；本仓踩过一次）', () => {
  // 2026-10-16 实测：新加的 /version 路由写了 readOwnVersion(__dirname) ⇒ 一请求就
  // {"error":"__dirname is not defined"}。正确做法是 import.meta.url（readOwnVersion 会自己回上一层）。
  // ★ 判据看**编译产物**（注释里的 __dirname 是给人看的说明，编译后不存在）
  // ★ 判据：**编译产物里不许有「当标识符用」的 __dirname**（注释里写着「__dirname 会 500」是说明文字，
  //   编译会保留注释 ⇒ 不能简单地全文搜，否则断言自己把自己判死——这个坑当场踩过一次）。
  const LIB_INDEX = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  const LIB_UPDATE = readFileSync(join(ROOT, 'lib', 'scan', 'update.js'), 'utf8')
  //   做法：只搜**不在注释里**的部分（线性扫描，不靠正则去啃嵌套/字符串）。
  const codeOnly = (s) => {
    let out = ''
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; continue }
      if (s[i] === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i + 2); i = e < 0 ? s.length : e; continue }
      out += s[i]
    }
    return out
  }
  assert.ok(!/\b__dirname\b/.test(codeOnly(LIB_INDEX)), 'lib/index.js 把 __dirname 当标识符用了 ⇒ 相关路由会 500')
  assert.ok(!/\b__dirname\b/.test(codeOnly(LIB_UPDATE)), 'lib/scan/update.js 把 __dirname 当标识符用了 ⇒ 版本读取会 500')
  assert.match(HOST, /readOwnVersion\(import\.meta\.url\)/, '版本读取必须走 import.meta.url')
  assert.ok(!/readOwnVersion\(__dirname\)/.test(HOST))
})

test('★ 票 23：路由入口必须过来源闸（跨源 ⇒ 403）', () => {
  assert.match(HOST, /requestAllowed\(req\.headers\)/, '路由入口没有来源校验')
  assert.match(HOST, /拒绝跨来源请求/, '缺少 403 文案')
})

test('★ 票 23 行为：同源闸只认同源页面；无头（curl/脚本）放行', async () => {
  const mod = await import('../lib/scan/guard.js')
  const H = '127.0.0.1:19387'
  assert.equal(mod.sameOriginOk({ host: H }).ok, true, '无 Origin/Referer ⇒ 放行')
  assert.equal(mod.sameOriginOk({ origin: 'http://' + H, host: H }).ok, true, '同源放行')
  assert.equal(mod.sameOriginOk({ origin: 'http://localhost:19387', host: H }).ok, true, 'loopback 别名互认')
  assert.equal(mod.sameOriginOk({ origin: 'http://evil.com', host: H }).ok, false, '跨源必须拒')
  assert.equal(mod.sameOriginOk({ referer: 'http://evil.com/x', host: H }).ok, false, '跨源 Referer 必须拒')
  assert.equal(mod.sameOriginOk({ origin: 'null', host: H }).ok, false, '沙箱来源必须拒')
  assert.equal(mod.sameOriginOk({ origin: 'http://localhost:9999', host: H }).ok, false, '端口不同不算同源')
})

test('★ 审查 M3：DNS rebinding 必须拒（Host 非 loopback 一律拒，哪怕 Origin 与 Host 字符串相等）', async () => {
  const mod = await import('../lib/scan/guard.js')
  // rebinding 场景：攻击者域名解析到 127.0.0.1，浏览器发出的 Origin.host 与 Host 头都是攻击者域名
  assert.equal(mod.sameOriginOk({ origin: 'http://rebind.evil.com:19387', host: 'rebind.evil.com:19387' }).ok, false, 'Origin==Host 但非 loopback ⇒ 必须拒')
  assert.equal(mod.sameOriginOk({ referer: 'http://rebind.evil.com/x', host: 'rebind.evil.com:19387' }).ok, false, 'Referer 路径同理')
  // 合法面板访问不受影响
  assert.equal(mod.sameOriginOk({ origin: 'http://127.0.0.1:19387', host: 'localhost:19387' }).ok, true, 'loopback 别名仍互认')
  assert.equal(mod.sameOriginOk({ origin: 'http://localhost:19387', host: 'localhost:19387' }).ok, true, 'localhost 同源仍放行')
})

test('★ 票 28：书签写盘不得再「先删后改名」（丢数据窗口）', () => {
  const src = readFileSync(join(ROOT, 'src', 'scan', 'bookmark.ts'), 'utf8')
  assert.ok(!/rmSync\(this\.file/.test(src), '书签写盘又回到先删后改名')
  assert.match(src, /renameSync\(tmp, this\.file\)/, '写盘必须走 rename')
})

test('★ 票 30：并发与长任务 —— 扫描锁真的置位、readBody 有超时', () => {
  assert.match(HOST, /async function withScanLock/, '缺少 withScanLock（手动扫描只查不置位的旧毛病会回来）')
  const uses = (HOST.match(/withScanLock\(\(\) => doScan/g) || []).length
  assert.ok(uses >= 2, '/scan 与 /retry 都要走锁，实际 ' + uses)
  assert.match(HOST, /setTimeout\(\(\) => done\(\{\}\), 10_000\)/, 'readBody 缺超时（半开连接会挂住请求）')
})

test('★ 手动扫描也带补全（2026-10-16 既定口径），且补全限定本次范围', () => {
  assert.match(HOST, /enrichAfter: body\.enrichAfter !== false/, '手动 /scan 默认应带补全（可显式 false 关掉）')
  assert.match(HOST, /const inScope = \(b: string\) =>/, '补全必须按本次扫描范围过滤（否则按站跑会抓别站书页）')
})

test('★ 导出：下载带 Content-Disposition、可写目录、可打开文件夹', () => {
  assert.match(HOST, /Content-Disposition/, '下载不再只是一段文本（缺 Content-Disposition）')
  assert.match(HOST, /'\/api\/rank-scan\/bookmark\/export-file'/, '缺少导出到目录的路由')
  assert.match(HOST, /'\/api\/rank-scan\/bookmark\/open-folder'/, '缺少打开文件夹的路由')
  assert.match(HOST, /spawn\(cmd, \[dir\], \{ detached: true, stdio: 'ignore' \}\)/, '打开文件夹必须用 spawn 传参数（禁 shell 拼接）')
})

test('★ 保留策略：面板可改天数/永久，且只删数据日期目录', () => {
  assert.match(HOST, /normalizeRetention\(body\.days\)/, '缺少 /retention 输入校验')
  assert.match(HOST, /runRetention\(root, localDate\(clock\.now\(\)\), v\)/, '/retention 保存后没有立刻执行清理')
})

test('★ 截断书名：显示层继承历史补全过的全名', () => {
  assert.match(HOST, /fullNameByKey/, '缺少显示层全名继承')
  assert.match(HOST, /extra\.titleFrom = full\.from/, '继承来源没有记录（无法解释全名从哪来）')
  const SF = readFileSync(join(ROOT, 'src', 'sites', 'sfacg.ts'), 'utf8')
  assert.match(SF, /补全本榜/, '截断警告没有指路（用户不知道可以补全）')
})

test('★ 票 30：批量补全必须有时长上限并如实回报跳过项', () => {
  assert.match(HOST, /BATCH_ENRICH_CAP_MS = 10 \* 60 \* 1000/, '缺少批量补全时长上限常量')
  assert.match(HOST, /stoppedByTime: skipped\.length > 0/, '批量补全没有回报「到点停止」')
  const loops = (HOST.match(/Date\.now\(\) - t[0Q] > BATCH_ENRICH_CAP_MS/g) || []).length
  assert.ok(loops >= 2, 'enrichAll 与起点批量都要受上限约束，实际 ' + loops)
})

test('★ 票 29：抓取的 ctx 必须透传（signal + requestTimeoutMs）', () => {
  for (const f of ['qidian-mobile.ts', 'ciweimao.ts', 'sfacg.ts', 'qidiantu.ts', 'fanqie.ts']) {
    const src = readFileSync(join(ROOT, 'src', 'sites', f), 'utf8')
    assert.match(src, /signal: c\?\.signal, timeoutMs: c\?\.requestTimeoutMs/, f + ' 没有把 ctx 的取消信号与超时传进 boundedFetch')
  }
})

test('★ 票 29：enrich 必须有超时且不判本榜失败', () => {
  const RUN = readFileSync(join(ROOT, 'src', 'scan', 'run.ts'), 'utf8')
  assert.match(RUN, /withTimeout\(\s*job\.site\.enrich/, 'enrich 没进 withTimeout')
  assert.match(RUN, /budget\.enrichTimeoutMs/, '没有用 enrichTimeoutMs 预算')
  assert.match(RUN, /enrichIncomplete/, '超时后没有标 enrichIncomplete')
  const TYPES = readFileSync(join(ROOT, 'src', 'scan', 'types.ts'), 'utf8')
  assert.match(TYPES, /enrichTimeoutMs: number/, 'Budget 缺 enrichTimeoutMs')
})

test('P0-1 定时器：checkTimer 必须自带兜底，定时回调必须挂 catch（未处理拒绝 ⇒ 宿主 exit(1)）', () => {
  assert.match(HOST, /async function checkTimer\(\): Promise<void> \{\s*try \{ await checkTimerInner\(\) \}/, 'checkTimer 的兜底 wrapper 不在了')
  assert.match(HOST, /checkTimer\(\)\.catch\(/, 'setInterval 回调没挂 .catch')
  assert.match(HOST, /写定时状态失败（已吞）/, 'recordRun 的 try/catch 被拆掉了')
})

test('P0-2 日期：/day 与 /repair 都必须过 assertDataDate，drop 还须卡根包含', () => {
  assert.match(FILES, /export function assertDataDate\(/, 'assertDataDate 不见了')
  const uses = (HOST.match(/assertDataDate\(/g) || []).length
  assert.ok(uses >= 2, 'assertDataDate 要在 /day 与 /repair 两个入口各用一次，实际 ' + uses)
  assert.match(HOST, /relative\(resolve\(root\), dir\)\.startsWith\('\.\.'\)/, 'drop 路径缺「根包含」检查')
  assert.ok(!/const date = String\(body\.date \|\| ''\)/.test(HOST), '又有入口回到未校验的裸 date 了')
})

test('★ 审查 M1：boardId 全线路径安全 —— 路由层卡格式 + store 层兜底', () => {
  const STORE = readFileSync(join(ROOT, 'src', 'scan', 'store.ts'), 'utf8')
  // 路由层：helper 定义 + 至少 8 处使用（/board、/enrich、/select captures、/select displays、/depth、/day、/repair、/qidianEnrich、/bookmark）
  assert.match(HOST, /const isValidBoardId = /, 'index.ts 缺 isValidBoardId helper')
  const uses = (HOST.match(/isValidBoardId\(/g) || []).length
  assert.ok(uses >= 9, 'isValidBoardId 要覆盖所有收 boardId 的路由，实际 ' + uses + ' 处')
  // store 层：读路径静默按无快照、写路径 fail-loud
  assert.match(STORE, /const BOARD_ID_SAFE = /, 'store.ts 缺 BOARD_ID_SAFE')
  assert.match(STORE, /if \(!BOARD_ID_SAFE\.test\(boardId\)\) return null/, 'readSnapshot 缺非法 boardId 兜底')
  assert.match(STORE, /if \(!BOARD_ID_SAFE\.test\(s\.boardId\)\) throw new Error/, 'writeSnapshot 缺非法 boardId 拒绝')
})

test('★ 审查 M2：open-folder 必须先白名单校验再 existsSync（UNC ⇒ NTLM 哈希泄漏）', () => {
  const openFolder = HOST.split(`'/api/rank-scan/bookmark/open-folder'`)[1] || ''
  assert.match(openFolder, /const relF = relative\(resolve\(homedir\(\)\), dir\)/, 'open-folder 缺 homedir 白名单（与 export-file 同款）')
  assert.ok(openFolder.indexOf('relF') > -1 && openFolder.indexOf('relF') < openFolder.indexOf('existsSync(dir)'), '必须先校验 relF 再 existsSync（UNC 光探测存在就泄漏 NTLM）')
})

test('★ 审查 M4：qidiantu 首订回退时 pageDate 只采纳「有行」页的日期', () => {
  const QT = readFileSync(join(ROOT, 'src', 'sites', 'qidiantu.ts'), 'utf8')
  assert.match(QT, /if \(parsed\.rows\.length && parsed\.date\) pageDate = parsed\.date/, 'pageDate 又变回无条件赋值（回退轮次会串日期）')
})

test('assertDataDate 行为：只放行严格 YYYY-MM-DD（越界/空/穿越一律抛错）', async () => {
  const mod = await import('../lib/scan/files.js')
  const ok = ['2026-10-16', ' 2026-01-01 ']
  for (const s of ok) assert.equal(mod.assertDataDate(s).length, 10, '合法日期应放行：' + s)
  // 注意：首尾空格是**刻意 trim 放行**的（面板日期框可能带空格），所以别把 '2026-10-16 ' 放进 bad
  const bad = ['', '..', '../..', 'state', '2026-10', '2026-1-1', '2026-10-16/../..', '2026-10-16T00:00:00', null, undefined, 20261016]
  for (const s of bad) assert.throws(() => mod.assertDataDate(s), undefined, '必须拒绝：' + JSON.stringify(String(s)))
})
