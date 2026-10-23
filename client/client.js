/**
 * dsh-rank-scan — 面板（手写 bundle，零依赖；只用平台提供的 react）。
 * 2026-10-14 重写：可拖动/可缩放浮窗（位置尺寸本地记忆）；概览单行汇总；异常榜折叠；行内详情卡。
 * 数据全部来自宿主同源路由 /api/rank-scan（只读本地快照，渲染不联网）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-rank-scan',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/rank-scan'
    /** ★ 入口 id 与 main 面板 key 必须**一致**：宿主 PanelRow 点击时直接 layout.selectPanel(入口 id) */
    const PANEL_ID = 'rank-scan-panel'
    // ★ 2026-10-16（使用者口径 B）：入口 id 恢复成审计前的独立值 —— 不复用浮窗 id，
    //   免得宿主把侧栏这一行当成「面板页」去 selectPanel 切主区域。
    const ENTRY_ID = 'rank-scan-entry'
    const readResponse = async (response) => {
      const data = await response.json()
      if (response.ok === false || (data && (data.ok === false || data.error))) {
        throw new Error((data && (data.error || data.note)) || ('请求失败：' + response.status))
      }
      return data
    }
    const jget = (p) => fetch(API + p, { headers: { Accept: 'application/json' } }).then(readResponse)
    // ⚠️ 之前这里**丢掉了 body**（调用方写的 {captures:…} 全被忽略）⇒ 面板里所有「保存」实际都没带参数：
    //    抓取集保存不动、每榜深度存不进去。现在统一带 JSON body。
    const jpost = (p, body) => fetch(API + p, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(readResponse)

    const LS_POS = 'rank-scan-panel:rect:v1'
    // 面板开关的本地记忆：v1 = 用户最后一次的开/关；auto = 「首次安装已自动弹过」
    // 需求（2026-10-15 使用方口径）：安装成功后第一次打开 DSH 自动弹一次，之后用户关掉就不再自动弹。
    const LS_SEL = 'rank-scan-panel:sel:v1'
/** 面板 UI 选择（tab + 站 + 榜 + 每榜日期/排序）：模块级共享，收起面板/刷新页面都回到原界面 */
const sel = (function () {
  let s = { tab: 'ov', site: null, board: null, dates: {}, sorts: {} }
  try {
    const raw = localStorage.getItem(LS_SEL)
    if (raw) {
      const o = JSON.parse(raw)
      s = {
        tab: o.tab || 'ov', site: o.site || null, board: o.board || null,
        /**
         * ★ 2026-10-22（易用性 B）：日期/排序**按榜各记各的**。
         *   以前这两个是组件内 state，收起面板/换榜就丢 ⇒ 每天都要重新选一次日期。
         *   换成按 boardId 存：换榜回来还是上次那个视图，但不会把上一榜的日期带过去。
         */
        dates: o.dates && typeof o.dates === 'object' ? o.dates : {},
        sorts: o.sorts && typeof o.sorts === 'object' ? o.sorts : {},
      }
    }
  } catch (e) {}
  const store = {
    get: function () { return s },
    set: function (patch) {
      s = { ...s, ...patch }
      try { localStorage.setItem(LS_SEL, JSON.stringify(s)) } catch (e) {}
    },
    /** 读某榜记住的日期（'' = 最新）/ 排序（'' = 默认） */
    pref: function (boardId, kind) {
      if (!boardId) return ''
      const m = kind === 'sort' ? s.sorts : s.dates
      return (m && m[boardId]) || ''
    },
    /** 写某榜的日期/排序；空串 = 清掉，回到默认 */
    setPref: function (boardId, kind, value) {
      if (!boardId) return
      const key = kind === 'sort' ? 'sorts' : 'dates'
      const m = { ...(s[key] || {}) }
      if (value) m[boardId] = value
      else delete m[boardId]
      const patch = {}
      patch[key] = m
      store.set(patch)
    },
  }
  return store
})()
// 模块级单例锚：即使 loader 把 factory 跑两遍（本会话确实见到重复入口），两个实例也共用同一份状态
const SHARED = (window.__rankScanShared = window.__rankScanShared || {})
/**
 * ★ 2026-10-22（离开保护）：未保存草稿**放在组件外**，切页/收起/重载把组件卸了也不丢。
 *   bm = 书签备注/夹草稿；settings = 抓取范围 + 计划时刻草稿。
 */
const DRAFT_KEY = 'rank-scan-panel:drafts:v1'
let restoredDrafts = { bm: null, settings: null }
try {
  const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
  if (saved && typeof saved === 'object') restoredDrafts = saved
} catch (e) {}
const draftTarget = window.__rankScanDrafts || restoredDrafts
const DRAFTS = (window.__rankScanDrafts = new Proxy(draftTarget, {
  set: function (target, key, value) {
    target[key] = value
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(target)) } catch (e) {}
    return true
  },
}))
/** 脏状态登记：面板在切页/收起前据此拦一下（只提示，不替用户保存） */
const dirtyGuard = (function () {
  const m = { bm: !!(DRAFTS.bm && DRAFTS.bm.dirty), settings: !!DRAFTS.settings }
  return {
    set: function (k, v) {
      const on = !!v
      if (!!m[k] === on) return
      m[k] = on
      try { window.dispatchEvent(new Event('rank-scan:dirty')) } catch (e) {}
    },
    any: function () { return Object.keys(m).some(function (k) { return m[k] }) },
    list: function () { return Object.keys(m).filter(function (k) { return m[k] }) },
  }
})()
const LS_OPEN = 'rank-scan-panel:open:v1'
    const LS_AUTOOPENED = 'rank-scan-panel:autoopened:v1'
    /** 用户上次的开/关（纯读，无副作用） */
    const readPanelOpen = function () {
      try { return localStorage.getItem(LS_OPEN) === '1' } catch (e) { return false }
    }
    /**
     * ★ 2026-10-16 审计：首次安装「自动弹一次」的标记**必须在这一刻**才落。
     *   旧写法在模块求值期就 setItem(LS_AUTOOPENED,'1')，而那时 apply 还没跑、槽位可能根本不在
     *   ⇒ 插件没激活也把标记烧掉了，之后永远不再自动弹（现场症状：「标记落了但从不弹」）。
     *   现在由 apply() 在真的打开浮窗时调用一次；返回 true 表示本次是首次装载。
     */
    const claimAutoOpen = function () {
      try {
        if (localStorage.getItem(LS_AUTOOPENED)) return false
        localStorage.setItem(LS_AUTOOPENED, '1')
        localStorage.setItem(LS_OPEN, '1')
        return true
      } catch (e) { return false }
    }
    const C = {
      win: { position: 'fixed', zIndex: 60, background: 'var(--dsh-surface, #fff)', border: '1px solid rgba(128,128,128,.32)',
        borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,.20)', fontSize: '12.5px', lineHeight: 1.5,
        display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      titlebar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px 6px 10px',
        borderBottom: '1px solid rgba(128,128,128,.25)', cursor: 'move', userSelect: 'none', background: 'rgba(128,128,128,.06)' },
      title: { fontWeight: 600, fontSize: '13px', marginRight: '2px' },
      body: { padding: '8px 10px 10px', overflow: 'auto', flex: '1 1 auto' },
      row: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', margin: '5px 0' },
      btn: { padding: '3px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.35)',
        background: 'transparent', cursor: 'pointer', color: 'inherit' },
      btnOn: { padding: '3px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.6)',
        background: 'rgba(128,128,128,.18)', cursor: 'pointer', color: 'inherit', fontWeight: 600 },
      tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid rgba(128,128,128,.25)', marginBottom: '6px' },
      tab: (on) => ({ padding: '3px 9px', cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit',
        borderBottom: on ? '2px solid currentColor' : '2px solid transparent', fontWeight: on ? 600 : 400 }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: { textAlign: 'left', padding: '2px 5px', borderBottom: '1px solid rgba(128,128,128,.3)', whiteSpace: 'nowrap', fontWeight: 600, position: 'sticky', top: 0, zIndex: 3, background: 'var(--dsh-surface, #fff)' },
      td: { padding: '2px 5px', borderBottom: '1px solid rgba(128,128,128,.1)', verticalAlign: 'top' },
      /**
       * ★ 2026-10-17（易用性 P0）：数字列以前会折行（「退 1」被拆成两行、20 个榜的表拉高一倍）。
       *   num 给数字列用（不折行 + 等宽数字，扫一眼就能对齐比大小）。
       */
      num: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      /* 涨跌配色：绿涨红跌，与 dot('ok'/'bad') 同一套语义；符号仍然保留，不靠颜色单打 */
      up: { color: '#3f9b4f', whiteSpace: 'nowrap' },
      down: { color: '#d9534f', whiteSpace: 'nowrap' },
      /* 长榜名单行省略（全名放 title 里）——避免「签约榜 × 轻小说（移动端口径）」撑成两行 */
      ellip: { display: 'inline-block', maxWidth: '232px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' },
      muted: { opacity: 0.7, fontSize: '11.5px' },
      siteBar: { marginTop: '8px', fontWeight: 600, fontSize: '12.5px', display: 'flex', gap: '6px', alignItems: 'center' },
      dot: (tone) => ({ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
        background: tone === 'bad' ? '#d9534f' : tone === 'warn' ? '#d9a441' : '#3f9b4f' }),
      handle: { position: 'absolute', right: '0', bottom: '0', width: '16px', height: '16px', cursor: 'nwse-resize',
        background: 'linear-gradient(135deg, transparent 46%, rgba(128,128,128,.55) 46%, rgba(128,128,128,.55) 54%, transparent 54%, transparent 70%, rgba(128,128,128,.55) 70%, rgba(128,128,128,.55) 78%, transparent 78%)' },
      detail: { marginTop: '6px', padding: '6px 8px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', background: 'rgba(128,128,128,.06)' },
      // 书签（用户数据）：星标按钮与卡片
      bmOn: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#d9a441', fontSize: '13px', lineHeight: 1 },
      bmOff: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', opacity: 0.32, fontSize: '13px', lineHeight: 1 },
      card: { margin: '7px 0', padding: '7px 9px', border: '1px solid rgba(128,128,128,.28)', borderRadius: '8px', background: 'rgba(128,128,128,.045)' },
      cardTitle: { fontWeight: 600, fontSize: '13px' },
      chip: { display: 'inline-block', marginRight: '4px', padding: '0 5px', borderRadius: '8px', background: 'rgba(128,128,128,.18)', fontSize: '11px' },
      input: { padding: '3px 6px', fontSize: '12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' },
    }
    /**
     * ★ 2026-10-17（易用性 P0）：哪些列算「数字列」—— 只有它们套 C.num（不折行 + 等宽数字）。
     *   书名/作者/分类这类文本列仍允许换行，否则长书名会把整张表撑宽。
     */
    const NUM_COL_RE = /^(rank|delta|words|collect|collectBase|value|ratio|fans|read|readDelta|periodTotal|periodDelta|score|days|buyNumRaw|daily\d*|pday\d*)$/
    const isNumCol = (key) => NUM_COL_RE.test(String(key || ''))
    const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v)
    /**
     * ★ 2026-10-17（使用者问「跨天怎么算」）：两个数据日期之间隔了几天（YYYY-MM-DD，本地口径）。
     *   变化列的基准是「上一个**有数据**的日期」，隔天时它就不是昨天了 —— 界面上必须写清楚隔了几天，
     *   否则「今日涨幅」看着像单日，其实跨了 2~N 天。
     */
    const dayGap = (a, b) => {
      const x = Date.parse(String(a) + 'T00:00:00')
      const y = Date.parse(String(b) + 'T00:00:00')
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return Math.round((y - x) / 86400000)
    }
    /**
     * ★ 2026-10-22（历史日期映射修正）：上架日 ↔ 数据日期。
     *   首订榜锚 **n-1**：数据日期 X 的榜面属于 X-1（适配器 contentDateFor 就是这么声明的）。
     *   所以「上架日 X」要请求的是「数据日期 X+1」，页面内容日期仍是 X；落盘也记在 X+1 名下。
     */
    const addDaysStr = (d, n) => {
      const parts = String(d || '').split('-').map(Number)
      if (parts.length !== 3 || !parts.every(function (x) { return Number.isFinite(x) })) return null
      const dt = new Date(parts[0], parts[1] - 1, parts[2] + n)
      const p = function (x) { return String(x).padStart(2, '0') }
      return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate())
    }
    /**
     * ★ 2026-10-17（发布前修）：请求间隔已可配置（默认 1000ms）⇒ 所有「1 请求/秒」「1s 限速」
     *   的文案必须跟着**当前生效值**走，否则使用者把它调成 500ms 后，面板说的和做的不一致。
     *   lastRequestIntervalMs 由 /catalog 与 /enrich-status 的响应刷新（两处都不额外打请求）。
     */
    let lastRequestIntervalMs = 1000
    const noteRequestInterval = function (v) { if (typeof v === 'number' && isFinite(v) && v >= 0) lastRequestIntervalMs = v }
    const fmtIntervalText = function (ms) {
      const v = typeof ms === 'number' && isFinite(ms) ? ms : lastRequestIntervalMs
      if (v === 0) return '不限速'
      return (v % 1000 === 0 ? (v / 1000) + 's' : v + 'ms') + '/请求'
    }
    const fmtRead = (n) => (typeof n === 'number' ? n.toLocaleString('zh-CN') : dash(n))
    const fmtWords = (v) => {
      if (v === null || v === undefined || v === '') return '—'
      if (typeof v === 'string') return v
      const n = Number(v)
      if (!Number.isFinite(n)) return dash(v)
      return n >= 10000 ? (n / 10000).toFixed(2) + '万字' : n + '字'
    }
    const fmtTime = (s) => {
      const n = Number(s)
      if (!Number.isFinite(n) || n <= 0) return '—'
      const d = new Date(n * 1000)
      const p = (x) => String(x).padStart(2, '0')
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    /**
     * ★ 2026-10-16 审计-2（Q23 跨时区）：宿主落盘的时间戳一律是**绝对时刻**
     *   （`new Date().toISOString()`，UTC）。面板必须按**本地时刻**渲染 ——
     *   旧写法是把 ISO 串里第 12–16 个字符（UTC 的 HH:MM）切出来当本地时刻，东八区用户看到的早 8 小时。
     */
    const asDate = (v) => (v instanceof Date ? v : new Date(v === null || v === undefined || v === '' ? NaN : v))
    const pad2 = (x) => String(x).padStart(2, '0')
    /** 本地 HH:MM（不可解析 ⇒ 空串，调用方自行兜底） */
    const fmtLocalHM = function (v) {
      const d = asDate(v)
      if (isNaN(d.getTime())) return ''
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    /** 本地 MM-DD HH:MM */
    const fmtLocalStamp = function (v) {
      const d = asDate(v)
      if (isNaN(d.getTime())) return ''
      return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + fmtLocalHM(d)
    }
    function tone(status) { return status === 'ok' ? 'ok' : status === 'stale' ? 'warn' : 'bad' }

    /**
     * ★ 2026-10-16 审计：位置/尺寸是**上一次会话**写进 localStorage 的。换了更小的分辨率、
     *   浏览器缩放变了、或者手改成了垃圾值，读回来就可能把浮窗放到屏幕外（甚至算出 NaN 宽高）。
     *   所以读回后、写回前都夹取一次，渲染用的 rect 保证合法。
     */
    const clampRect = function (raw) {
      const vw = Math.max(320, Number(window.innerWidth) || 1200)
      const vh = Math.max(240, Number(window.innerHeight) || 800)
      const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb)
      const r = raw && typeof raw === 'object' ? raw : {}
      const M = 8
      const w = Math.min(Math.max(420, num(r.w, 660)), Math.max(320, vw - 2 * M))
      const h = Math.min(Math.max(240, num(r.h, 480)), Math.max(240, vh - 2 * M))
      /**
       * ★ 2026-10-23（面板跑到屏幕外）：旧写法只夹 x <= vw-80、y <= vh-48，
       *   于是 x + w 可以远超视口宽 —— 换小屏/浏览器缩放后整块面板挂在右边外面，
       *   表头与「收起」按钮全在屏幕外（使用者现场：右侧整片被切掉、收不回来）。
       *   现在按**右下边界**夹：保证 x + w <= vw - 8、y + h <= vh - 8。
       */
      const x = Math.min(Math.max(M, num(r.x, Math.max(M, vw - w - 24))), Math.max(M, vw - w - M))
      const y = Math.min(Math.max(M, num(r.y, 64)), Math.max(M, vh - h - M))
      return { x: x, y: y, w: w, h: h }
    }
    /**
     * ★ 2026-10-23（使用者口径）：「最大化」整块去掉 —— 它跟宿主界面必然重叠（铺满就把
     *   DSH 自己的顶栏夹在下面），拖到哪、缩到多大本来就能自己决定，多一个会打架的按钮不值得。
     *   面板只剩：拖动标题栏 + 右下角拖拽缩放，位置尺寸照旧记在 LS_POS 里。
     */

    /* ────────────────────────────────────────────────────────────────────────
     * ★ 2026-10-22（简明性 / 易用性，工作包 B·C·D）共用小件
     *   · revOf        同一天重扫也要刷新视图（宿主暂未下发 revision ⇒ 用可见状态拼一个安全的）
     *   · PopMenu      低频操作统一收进「更多」菜单（键盘可达、Esc/点外面关闭、焦点归还）
     *   · Section      设置页的四组折叠块
     *   · useEscLayer  Esc 的层级关闭（菜单 → 详情 → 面板），编辑中不关面板
     * ──────────────────────────────────────────────────────────────────────── */
    /** 2026-10-22：'2026-10-22' → '10-22'（状态带里省宽度，年份放 title） */
    // ★ 2026-10-23：以前是 s.slice(5)（切到末尾）⇒ 书签卡上显示「截止 10-17T04:00:00.000Z」。只取 5..10。
    const mdOf = function (v) { const s = String(v == null ? '' : v); return s.length >= 10 ? s.slice(5, 10) : s }
    /**
     * 数据修订号：**同一天再扫一次**也要让概览/榜单重读（以前只盯 dataDate，当天不变就永远不刷）。
     * 宿主目前不下发 revision ⇒ 用「扫描记录 + 计数 + 存储缓存时间」拼一个安全的替代值：
     * 扫描结束会主动刷新占用缓存（storage.cachedAt 必变），所以它能反映「又跑了一轮」。
     * 将来宿主给了 ov.revision 就优先用它，不改调用方。
     */
    const revOf = function (ov) {
      if (!ov) return ''
      if (ov.revision != null) return String(ov.revision)
      const s = ov.scan || {}
      const c = ov.counts || {}
      const pr = s.progress || {}
      return [ov.dataDate, ov.baselineDate, s.outcome, s.trigger, s.attempt, pr.done, pr.total,
        c.ok, c.missing, c.stale, c.login_required, c.truncated, ov.hiddenCount,
        (ov.storage && ov.storage.cachedAt) || ''].join('|')
    }
    /** 内部五态 → 人话（内部口径不变；界面不直接暴露 ok/missing/truncated） */
    const STATUS_TEXT = { ok: '已采集', missing: '没抓到', stale: '数据待核对', login_required: '需要登录', truncated: '没抓完' }
    const statusText = function (s) { return STATUS_TEXT[s] || (s ? String(s) : '—') }
    const scanLabel = function (scan) {
      if (!scan) return '还没扫描过'
      const out = scan.outcome === 'completed' ? '已完成' : scan.outcome === 'cancelled' ? '已取消' : scan.outcome === 'failed' ? '失败' : String(scan.outcome || '')
      const by = scan.trigger === 'timer' ? '定时' : scan.trigger === 'manual' ? '手动' : String(scan.trigger || '')
      return by ? by + ' · ' + out : out
    }
    /**
     * 按日期回看的能力**按榜声明**（能力驱动入口，而不是先给按钮再说「会被拒绝」）。
     * 目前只有起点图首订榜能核对内容日期（宿主用适配器的 contentDateFor 判定）。
     */
    const DAY_QUERY_BOARDS = { 'qidiantu.shouding': 'n-1' }
    const canDayQuery = function (boardId) { return !!DAY_QUERY_BOARDS[String(boardId || '')] }
    /** Esc 层级栈：后开的层先关（菜单 → 详情 → 面板）；编辑中不关面板 */
    const escLayers = (window.__rankScanEscLayers = window.__rankScanEscLayers || [])
    const isEditableTarget = function (t) {
      if (!t) return false
      const tag = String(t.tagName || '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true
    }
    const installEsc = function () {
      if (typeof document === 'undefined' || !document.addEventListener || window.__rankScanEscHooked) return
      window.__rankScanEscHooked = true
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return
        // 编辑中：Esc 只退出编辑焦点（草稿留着），不关菜单/详情/面板
        if (isEditableTarget(document.activeElement)) { try { document.activeElement.blur() } catch (err) {} return }
        for (let i = escLayers.length - 1; i >= 0; i--) {
          try { if (escLayers[i].close()) return } catch (err) {}
        }
      }, true)
    }
    /** 把「关掉我这一层」挂进栈；close() 返回 true = 已处理（不再往外层传） */
    const useEscLayer = function (close) {
      React.useEffect(function () {
        if (typeof close !== 'function') return undefined
        installEsc()
        const layer = { close: close }
        escLayers.push(layer)
        return function () { const i = escLayers.indexOf(layer); if (i >= 0) escLayers.splice(i, 1) }
      }, [close])
    }
    /**
     * 「更多」菜单：低频操作（扫描本榜/条数/补全/历史/导出/回收站…）都收进来。
     * items: {label,onClick,disabled,title} | {sep:true} | {rows:节点}
     */
    function PopMenu(props) {
      const [open, setOpen] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const wrapRef = React.useRef(null)
      const btnRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const close = React.useCallback(function () {
        setOpen(false)
        const b = btnRef.current
        if (b && typeof b.focus === 'function') { try { b.focus() } catch (e) {} }
      }, [])
      /**
       * ★ 2026-10-23（菜单超出面板 / 屏幕外，使用者：「当前面板显示不了这个更多，画面超出界面了」）：
       *   旧写法是 position:absolute + right:0，锚在按钮那一小块 span 上 ——
       *   ① 书签卡里的「更多」在**左边**，right:0 让菜单整体往左溢出面板，被浮窗的 overflow:hidden 裁掉（只剩一条）；
       *   ② 往下开时菜单一旦超过面板底边也直接被裁，面板小一点就什么都点不到。
       *   改成**相对视口**定位：按按钮实际位置量一遍，下方放不下翻到上方，左右夹在视口里，
       *   高度放不下就在菜单内滚动。浮窗上没有 transform/filter ⇒ fixed 子元素不会被它的 overflow 裁。
       */
      const place = React.useCallback(function () {
        const btn = btnRef.current
        const el = menuRef.current
        if (!btn || !el) return
        const vw = Math.max(280, Number(window.innerWidth) || 1200)
        const vh = Math.max(200, Number(window.innerHeight) || 800)
        const M = 6
        const b = btn.getBoundingClientRect()
        const mw = el.offsetWidth
        const mh = el.offsetHeight
        let left = b.left
        if (left + mw > vw - M) left = vw - M - mw
        if (left < M) left = M
        let top = b.bottom + 4
        if (top + mh > vh - M) {
          const up = b.top - 4 - mh
          top = up >= M ? up : Math.max(M, vh - M - mh)
        }
        setPos({ left: Math.round(left), top: Math.round(top), maxH: Math.max(120, vh - 2 * M) })
      }, [])
      React.useLayoutEffect(function () {
        if (!open) { setPos(null); return undefined }
        place()
        // 面板滚动 / 窗口缩放：菜单跟着按钮重新定位（别悬在一个已经滚走的位置上）
        const onMove = function () { place() }
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onMove)
        if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('scroll', onMove, true)
        return function () {
          if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onMove)
          if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('scroll', onMove, true)
        }
      }, [open, place])
      useEscLayer(open ? function () { close(); return true } : null)
      React.useEffect(function () {
        if (!open) return undefined
        const onDoc = function (e) {
          const w = wrapRef.current
          if (w && e && e.target && typeof w.contains === 'function' && w.contains(e.target)) return
          setOpen(false)
        }
        if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('mousedown', onDoc, true)
        return function () { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('mousedown', onDoc, true) }
      }, [open])
      React.useEffect(function () {
        if (!open) return undefined
        const w = wrapRef.current
        const first = w && typeof w.querySelector === 'function' ? w.querySelector('[role="menuitem"]') : null
        if (first && typeof first.focus === 'function') { try { first.focus() } catch (e) {} }
        return undefined
      }, [open])
      const onKey = function (e) {
        if (!open || !e) return
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const w = wrapRef.current
        const nodes = w && typeof w.querySelectorAll === 'function' ? Array.prototype.slice.call(w.querySelectorAll('[role="menuitem"]')) : []
        if (!nodes.length) return
        const at = nodes.indexOf(document.activeElement)
        const next = e.key === 'ArrowDown' ? (at + 1) % nodes.length : (at <= 0 ? nodes.length - 1 : at - 1)
        if (nodes[next] && typeof nodes[next].focus === 'function') nodes[next].focus()
        e.preventDefault()
      }
      const items = props.items || []
      return h('span', { ref: wrapRef, style: { position: 'relative', display: 'inline-block' }, onKeyDown: onKey },
        h('button', {
          ref: btnRef,
          style: open ? C.btnOn : C.btn,
          title: props.title || '',
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: function () { setOpen(!open) },
        }, (props.label || '更多') + (open ? ' ▴' : ' ▾')),
        open ? h('div', {
          ref: menuRef,
          role: 'menu',
          style: { position: 'fixed', zIndex: 90, left: (pos ? pos.left : 0) + 'px', top: (pos ? pos.top : 0) + 'px',
            // 先量后放：没量到之前先占位不可见，避免闪一下再跳位置
            visibility: pos ? 'visible' : 'hidden',
            minWidth: (props.width || 230) + 'px', maxWidth: 'min(420px, calc(100vw - 12px))',
            maxHeight: (pos ? pos.maxH : 420) + 'px', overflowY: 'auto', overflowX: 'hidden',
            padding: '5px', borderRadius: '8px', border: '1px solid rgba(128,128,128,.35)', background: 'var(--dsh-surface, #fff)',
            boxShadow: '0 8px 20px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: '4px' },
        }, items.map(function (it, i) {
          if (!it) return null
          if (it && it.sep) return h('div', { key: 's' + i, style: { height: '1px', background: 'rgba(128,128,128,.25)', margin: '3px 0' } })
          if (it && it.rows) return h('div', { key: 'r' + i, style: { padding: '2px 2px 4px' } }, it.rows)
          return h('button', {
            key: 'i' + i,
            role: 'menuitem',
            disabled: !!it.disabled,
            title: it.title || '',
            style: { ...C.btn, textAlign: 'left', border: '1px solid transparent', opacity: it.disabled ? 0.45 : 1 },
            onClick: function () { if (it.disabled) return; close(); if (it.onClick) it.onClick() },
          }, it.label)
        })) : null)
    }
    /** 设置页的分组块（默认展开第一组；其余收起，需要时再展开） */
    function Section(props) {
      const st = React.useState(props.defaultOpen !== false)
      const open = st[0]
      const setOpen = st[1]
      return h('div', { style: { margin: '8px 0', padding: '6px 8px', border: '1px solid rgba(128,128,128,.28)', borderRadius: '8px', background: 'rgba(128,128,128,.04)' } },
        h('button', {
          style: { ...C.btn, border: 'none', background: 'transparent', padding: '0', fontWeight: 600, fontSize: '12.5px', width: '100%', textAlign: 'left' },
          'aria-expanded': open ? 'true' : 'false',
          onClick: function () { setOpen(!open) },
        }, (open ? '▾ ' : '▸ ') + (props.title || '')),
        open ? h('div', { style: { marginTop: '4px' } }, props.children)
          : (props.summary ? h('div', { style: { ...C.muted, marginTop: '2px' } }, props.summary) : null))
    }
    /**
     * ★ 2026-10-23（使用者：「要拉到很大才显示全」）：
     *   以前是**固定阈值删列**：<720px 一口气把作者/分类/字数/收藏…全删掉（只剩名次/书名/主指标，
     *   中间一大片空白），≥720px 又把**全部**列铺开 —— 首订榜 10 列、三江 15 列，得拉到 1000px 以上
     *   才装得下，中间宽度只能横向滚动。
     *   现在**按可用宽度装列**：先估算每列要占多少，超了就从「最不重要」的那列开始一列一列丢，
     *   列序不变；名次 / 变化 / 书名 / 该榜主指标**永不丢**。宽度再小（<560）才整体换成卡片行。
     */
    const COL_PRIO = {
      value: 1, read: 1, collectBase: 1, periodTotal: 1, dailyDelta: 1,
      collect: 2, ratio: 2, words: 2, readDelta: 2, buyNumRaw: 2,
      days: 3, author: 4, fans: 4,
      cat: 5, score: 5,
      subCat: 6, settledDays: 6,
      updated: 7,
    }
    /** 优先级数字越大越先被丢；7 天增量的 daily0..6 排最后 */
    const colPrio = function (c) {
      const k = String((c && c.key) || '')
      if (/^daily\d+$/.test(k)) return 8
      return COL_PRIO[k] != null ? COL_PRIO[k] : 3
    }
    /**
     * 列宽估算：**刻意估宽一点**（实测浏览器给数字列的宽度比字面宽）。
     * 估窄了的后果是真的横向滚动 / 书名被挤成两行，比早收一列难看得多。
     */
    const colEst = function (c) {
      const k = String((c && c.key) || '')
      if (k === 'title') return 200
      if (k === 'updated') return 124
      if (k === 'rank') return 36
      if (k === 'delta') return 50
      if (/^daily\d+$/.test(k)) return 46
      const label = String((c && c.label) || '')
      return Math.max(64, label.length * 12 + 34)
    }
    const mustCol = function (c) {
      const k = String((c && c.key) || '')
      return k === 'title' || k === 'rank' || k === 'delta' || colPrio(c) === 1
    }
    /** 把列装进 width：永不丢 must 列；同优先级从后往前丢 */
    const fitColumns = function (columns, width) {
      const list = (columns || []).slice()
      if (!list.length) return list
      const budget = Math.max(320, Number(width) || 320)
      let sum = list.reduce(function (acc, c) { return acc + colEst(c) }, 0)
      for (let guard = 0; sum > budget && guard < 80; guard++) {
        let at = -1
        let worst = -1
        for (let i = 0; i < list.length; i++) {
          if (mustCol(list[i])) continue
          const pr = colPrio(list[i])
          if (pr >= worst) { worst = pr; at = i }
        }
        if (at < 0) break
        sum -= colEst(list[at])
        list.splice(at, 1)
      }
      return list
    }
    function useRect() {
      const st = React.useState(() => {
        let raw = null
        try { const s = localStorage.getItem(LS_POS); if (s) raw = JSON.parse(s) } catch (e) { raw = null }
        return clampRect(raw)
      })
      const rect = clampRect(st[0])
      const setRect = (next) => {
        const safe = clampRect(next)
        st[1](safe)
        try { localStorage.setItem(LS_POS, JSON.stringify(safe)) } catch (e) {}
      }
      return [rect, setRect]
    }

    /**
     * 书签（★ 用户数据）：与 panelOpen 同套路挂模块级单例。
     * 渲染不联网：面板挂载时拉一次 /bookmark/sync 得到「哪些书已打签」的精简 map，之后由操作本地更新。
     * 词汇见 docs/rank-scan/CONTEXT.md：书签 / 我的书签 / 书签夹 / 备注；**不要**用「收藏」指代（那是站方收藏量）。
     *
     * ★ 为什么要有 healStore（模块级补全函数）：
     *   这个 store 挂在 SHARED 上**跨插件重载存活**，而 `SHARED.bookmarks || (SHARED.bookmarks = {...})`
     *   在旧对象已存在时**整段被跳过** ⇒ 新加的字段/方法永远进不到那个旧对象里。
     *   实际踩到的症状：「Cannot read properties of undefined (reading 'q')」——
     *   旧对象没有 filters，BookmarksTab 里一行 f.q 就把整个页签打成错误边界。
     *   所以每次取用都先 healStore() 按对象补，不管它由哪一代定义创建。
     */
    const healStore = function (s) {
      if (!s || typeof s !== 'object') return s
      if (!s.filters || typeof s.filters !== 'object') s.filters = { q: '', site: '', folder: '', tag: '' }
      if (s.map == null || typeof s.map !== 'object') s.map = {}
      if (s.busy == null || typeof s.busy !== 'object') s.busy = {}
      if (!s.subs || typeof s.subs.add !== 'function') s.subs = new Set()
      if (s.list === undefined) s.list = null
      if (s.total == null) s.total = 0
      if (s.error === undefined) s.error = null
      // ★ 连**方法本身**也要补：旧对象可能来自「还没有我的书签页签」的那一代，
      //   它上面既没有 refreshList 也没有 trashList，一调用就是 not a function。
      const self = s
      if (typeof s.listQuery !== 'function') s.listQuery = function () {
        healStore(self)
        const f = self.filters
        const qs = []
        if (f.q) qs.push('q=' + encodeURIComponent(f.q))
        if (f.site) qs.push('site=' + encodeURIComponent(f.site))
        if (f.folder) qs.push('folder=' + encodeURIComponent(f.folder))
        if (f.tag) qs.push('tag=' + encodeURIComponent(f.tag))
        return qs.length ? '?' + qs.join('&') : ''
      }
      if (typeof s.refreshList !== 'function') s.refreshList = function () {
        healStore(self)
        return jget('/bookmarks' + self.listQuery()).then(function (r) {
          self.list = r
          self.folders = (r && r.folders) || []
          self.health = (r && r.health) || null
          if (typeof self._emit === 'function') self._emit()
          return r
        }).catch(function (e) { self.error = String(e); if (typeof self._emit === 'function') self._emit(); return null })
      }
      if (typeof s.trashList !== 'function') s.trashList = function () {
        return jget('/bookmarks/trash').then(function (r) { return (r && r.trash) || [] })
      }
      if (typeof s.load !== 'function') s.load = function () {
        healStore(self)
        return jget('/bookmark/sync').then(function (r) {
          self.map = (r && r.map) || {}
          self.total = (r && r.total) || 0
          self.health = (r && r.health) || null
          self.done = true
          if (typeof self._emit === 'function') self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self.done = true; if (typeof self._emit === 'function') self._emit(); return null })
      }
      if (typeof s.has !== 'function') s.has = function (k) { healStore(self); return !!self.map[k] }
      if (typeof s.act !== 'function') s.act = function (body) {
        healStore(self)
        self.busy[body.bookKey] = true
        if (typeof self._emit === 'function') self._emit()
        return jpost('/bookmark', body).then(function (r) {
          delete self.busy[body.bookKey]
          return self.load().then(function () { return r })
        }).catch(function (e) { delete self.busy[body.bookKey]; self.error = String(e); throw e })
      }
      if (typeof s._emit !== 'function') s._emit = function () { self.subs.forEach(function (f) { try { f() } catch (e) {} }) }
      return s
    }

    const bmStore = healStore(SHARED.bookmarks || (SHARED.bookmarks = {}))
    // 每个入口都先补一次：旧对象缺 filters/subs 时，光靠上面的默认值治不好它
    Object.assign(bmStore, {
      list: bmStore.list === undefined ? null : bmStore.list,
      filters: bmStore.filters,
      sort: bmStore.sort || 'time',
      msg: bmStore.msg === undefined ? null : bmStore.msg,
      listQuery: function () {
        healStore(this)
        const f = this.filters
        const qs = []
        if (f.q) qs.push('q=' + encodeURIComponent(f.q))
        if (f.site) qs.push('site=' + encodeURIComponent(f.site))
        if (f.folder) qs.push('folder=' + encodeURIComponent(f.folder))
        if (f.tag) qs.push('tag=' + encodeURIComponent(f.tag))
        return qs.length ? '?' + qs.join('&') : ''
      },
      refreshList: function () {
        healStore(this)
        const self = this
        return jget('/bookmarks' + this.listQuery()).then(function (r) {
          self.list = r
          self.folders = (r && r.folders) || []
          self.health = (r && r.health) || null
          self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self._emit(); return null })
      },
      trashList: function () { return jget('/bookmarks/trash').then(function (r) { return (r && r.trash) || [] }) },
      load: function () {
        healStore(this)
        const self = this
        return jget('/bookmark/sync').then(function (r) {
          self.map = (r && r.map) || {}
          self.total = (r && r.total) || 0
          self.health = (r && r.health) || null
          self.done = true
          self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self.done = true; self._emit(); return null })
      },
      has: function (k) { healStore(this); return !!this.map[k] },
      act: function (body) {
        healStore(this)
        const self = this
        self.busy[body.bookKey] = true
        self._emit()
        return jpost('/bookmark', body).then(function (r) {
          delete self.busy[body.bookKey]
          return self.load().then(function () { return r })
        }).catch(function (e) {
          delete self.busy[body.bookKey]
          self.error = String(e)
          self._emit()
          throw e
        })
      },
      use: function () {
        const [, force] = React.useState(0)
        React.useEffect(function () {
          const f = function () { force(function (x) { return x + 1 }) }
          const s = healStore(bmStore)
          s.subs.add(f)
          bmStore.load()
          return function () { try { s.subs.delete(f) } catch (e) {} }
        }, [])
        return healStore(bmStore)
      },
    })
    if (!bmStore._emit || typeof bmStore._emit !== 'function') {
      bmStore._emit = function () { this.subs.forEach(function (f) { try { f() } catch (e) {} }) }
    }
    if (bmStore.done === undefined) bmStore.done = false
    if (bmStore.health === undefined) bmStore.health = null
    if (!bmStore.folders || !bmStore.folders.length) bmStore.folders = bmStore.folders || []

    /** 星标按钮：四态（未打/已打/提交中/失败回滚）——失败必须可见，不静默 */
    function BookmarkStar(props) {
      const store = bmStore.use()
      const bk = props.bookKey
      if (!bk) return null
      const on = store.has(bk)
      const busy = !!store.busy[bk]
      const click = function (e) {
        e.preventDefault()
        e.stopPropagation()
        const body = props.row
          ? { action: on ? 'remove' : 'add', bookKey: bk, row: props.row, boardId: props.boardId, dataDate: props.dataDate }
          // 只有 bookKey 时：host 会拿 boardId + title（或 bookKey 里的书号）回本地快照里定位这本书
          : { action: on ? 'remove' : 'add', bookKey: bk, boardId: props.boardId, title: props.title, folders: props.folders }
        store.act(body).then(function () {
          if (store.list) store.refreshList()
        }).catch(function () {})
      }
      return h('button', {
        style: on ? C.bmOn : C.bmOff,
        title: busy ? '提交中…' : (on ? '已在书签里（点一下移除）' : '加入书签'),
        onClick: click,
      }, busy ? '…' : on ? '★' : '☆')
    }

    /**
     * ★ 2026-10-16 审计：拖动/缩放的 mousemove·mouseup 挂在 window 上，必须在**三处**都摘干净 ——
     *   ① 正常 mouseup；② 指针移出窗口后松开（只认 mouseup 会永久残留一个 mousemove）；
     *   ③ 组件卸载（收起浮窗 / 热重载）。
     *   旧写法只处理 ①：②③ 之后每次鼠标移动都还在改一个已经卸载的浮窗的 rect。
     */
    function useWindowDrag() {
      const active = React.useRef(null)
      const stop = React.useCallback(function () {
        const a = active.current
        if (!a) return
        active.current = null
        window.removeEventListener('mousemove', a.move)
        window.removeEventListener('mouseup', a.stop)
        window.removeEventListener('blur', a.stop)
      }, [])
      React.useEffect(function () { return function () { stop() } }, [stop])
      return React.useCallback(function (move) {
        stop()
        const a = { move: move, stop: null }
        a.stop = function () { stop() }
        active.current = a
        window.addEventListener('mousemove', a.move)
        window.addEventListener('mouseup', a.stop)
        window.addEventListener('blur', a.stop)
      }, [stop])
    }

    function DragBar(props) {
      const beginDrag = useWindowDrag()
      const start = (e) => {
        if (e.button !== undefined && e.button !== 0) return
        // 标题栏只承担拖动：按钮/输入框/链接上的按下不拖窗（否则点输入框会把窗拖走）
        if (e.target && e.target.closest && e.target.closest('button, input, select, textarea, a')) return
        const r0 = props.rect
        const sx = e.clientX
        const sy = e.clientY
        beginDrag((ev) => {
          props.setRect({ ...r0, x: Math.max(0, r0.x + (ev.clientX - sx)), y: Math.max(0, r0.y + (ev.clientY - sy)) })
        })
        e.preventDefault()
      }
      return h('div', { style: C.titlebar, onMouseDown: start },
        h('span', { style: C.title }, '扫榜面板'),
        h('span', { style: { flex: 1 } }),
        h('button', { style: C.btn, onClick: props.onCollapse, title: '收起面板（Esc 也可以）' }, '收起'))
    }

    function ResizeHandle(props) {
      const beginDrag = useWindowDrag()
      const start = (e) => {
        const r0 = props.rect
        const sx = e.clientX
        const sy = e.clientY
        beginDrag((ev) => props.setRect({ ...r0, w: Math.max(420, r0.w + (ev.clientX - sx)), h: Math.max(240, r0.h + (ev.clientY - sy)) }))
        e.preventDefault()
      }
      return h('div', { style: C.handle, onMouseDown: start, title: '拖动调整大小' })
    }

    /**
     * 页签级错误隔离。
     *
     * ★ 为什么需要：整个面板挂在一个 React 树上，任何一个页签渲染时抛异常，
     *   React 会把**整棵树**卸载 —— 用户看到的就是「面板闪一下就没了」，
     *   而且因为面板记忆了上次的页签（rank-scan-panel:sel:v1），重开还会落在同一个页签上再崩一次，
     *   表现成「点扫榜也打不开」。
     *   有这层边界之后：坏掉的页签显示一行红字（含错误信息），面板本身和其他页签照常可用。
     */
    class TabBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err: err } }
      componentDidCatch(err) { try { console.error('[rank-scan] 页签渲染失败：' + (this.props.name || ''), err) } catch (e) {} }
      render() {
        if (this.state.err) {
          return h('div', { style: { padding: '6px 8px', border: '1px solid rgba(217,83,79,.5)', borderRadius: '6px', background: 'rgba(217,83,79,.08)' } },
            h('div', { style: { fontWeight: 600 } }, '这个页签渲染出错了（面板其余部分仍可用）'),
            h('div', { style: { ...C.muted, wordBreak: 'break-all' } }, String((this.state.err && this.state.err.message) || this.state.err)),
            h('button', { style: C.btn, onClick: function () { this.setState({ err: null }) }.bind(this) }, '重试'))
        }
        return this.props.children
      }
    }

    /** 字节 → 人话（数据目录占用用；保留 1 位小数，够看趋势就行） */
    const fmtBytes = (n) => {
      if (n == null || !isFinite(n)) return '—'
      const u = ['B', 'KB', 'MB', 'GB']
      let i = 0
      let v = Number(n)
      while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++ }
      return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + ' ' + u[i]
    }

    /**
     * 概览：先回答「今天有什么需要看」——
     *   ① 需要处理（**仅有问题时出现**：榜名 + 影响 + 可执行动作）
     *   ② 今天的变化（可按分组筛：新入榜/回榜/上升/下降/退榜）
     *   ③ 全部榜单（可折叠；逐榜状态 + 涨/新/退；同站抓取时刻一致时只写一次）
     * ★ 2026-10-22（简明性 B）：存储/保留/诊断移到「设置」页 —— 采集管理不再占首屏。
     */
    function Overview(props) {
      const ov = props.ov
      /**
       * ★ 2026-10-23（窄面板版式）：概览两张表以前一律四列铺开 —— 420px 时「分组/榜/书名/变化」
       *   互相挤成一条，备注列更会被压成一字一行。这里按面板宽度决定：
       *   变化列表 <620 换成卡片行（分组 chip + 书名 + 变化，榜名放第二行）；
       *   全部榜单 <620 不显示备注列，备注改到榜名下面一行。
       */
      const avail = Math.max(320, Number(props.width) || (props.narrow ? 420 : 900))
      const chgNarrow = avail < 620
      const enrichS = React.useState(null)
      const enrichStatus = enrichS[0]
      const enrichRun = enrichStatus && enrichStatus.enrichRun ? enrichStatus.enrichRun : null
      const setEnrichStatus = enrichS[1]
      const chgS = React.useState(null)
      const chg = chgS[0]
      const setChg = chgS[1]
      const filtS = React.useState('')
      const chgFilter = filtS[0]
      const setChgFilter = filtS[1]
      const allS = React.useState(true)
      const showAll = allS[0]
      const setShowAll = allS[1]
      const rev = props.rev || revOf(ov)
      /**
       * ★ 2026-10-22（同日刷新）：依赖**修订号**而不是 dataDate。
       *   以前同一天再扫一次（或点「扫描已选榜」）时，上面计数会变、下面「今天的变化」还是旧列表。
       */
      React.useEffect(function () {
        if (!ov || !ov.dataDate) return undefined
        let alive = true
        jget('/changes').then(function (r) { if (alive) setChg(r) }).catch(function () { if (alive) setChg(null) })
        return function () { alive = false }
      }, [rev])
      // 补全进行中：5 秒一次盯进度；跑完后自动刷新一次，让补上的字段出现
      React.useEffect(function () {
        let alive = true
        let id = null
        let wasActive = false
        const tick = function () {
          // 页面不可见时不轮询（概览页开着一天会白打上万次请求）
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          jget('/enrich-status').then(function (r) {
            if (!alive) return
            const er = (r && r.enrichRun) || null
            setEnrichStatus(r || null)
            noteRequestInterval(r && r.requestIntervalMs)
            const active = !!(er && er.active === true)
            if (wasActive && !active) props.reload()
            wasActive = active
            if (!active && !(r && r.pending > 0)) { alive = false; if (id) clearInterval(id) }
          }).catch(function () { /* 读不到进度不影响面板 */ })
        }
        tick()
        id = setInterval(tick, 5000)
        return function () { alive = false; if (id) clearInterval(id) }
      }, [])
      if (!ov) return h('div', { style: C.muted }, '加载中…')
      const c = ov.counts || {}
      const total = (c.ok || 0) + (c.missing || 0) + (c.stale || 0) + (c.login_required || 0) + (c.truncated || 0)
      const rows = (ov.sites || []).flatMap(function (s) { return (s.boards || []).map(function (b) { return { ...b, siteName: s.siteName } }) })

      const scan = ov.scan || null
      const plan = (ov.services && ov.services.schedule) || null
      const staleIds = plan && plan.staleFlag
        ? Object.keys(plan.staleFlag).filter(function (k) { return plan.staleFlag[k] && plan.staleFlag[k].date === ov.dataDate })
        : []
      /**
       * ★ Spec S3（2026-10-22）：「未到计划」和「待补跑」不是失败。
       *   按站分时抓取（起点 01:30 / 番茄 08:30 / 菠萝包 09:30 / 刺猬猫 10:40 / 起点图 12:40）⇒
       *   每天中午之前打开概览，没到点的站本来就该是空的。旧实现把它们算成 missing，于是出现
       *   「已采集 0/20 · 待处理 18 项 · 重试失败 18 个榜」的假警报（Spec S3 / 方案 3.3）。
       *   口径：后端逐榜给 scheduleState=waiting|due（含 plannedTime）就用它；
       *   没给（旧宿主/旧数据）就退回 timer-plan 的站级 waiting/due 队列；两者都没有才当失败。
       */
      const siteOfBoardId = function (id) { return String(id || '').split('.')[0] }
      const scheduleStateOf = function (b) {
        if (b.scheduleState === 'waiting' || b.scheduleState === 'due') return b.scheduleState
        if (b.scheduleState === null) return null
        if (b.status === 'ok') return null
        const site = siteOfBoardId(b.boardId)
        if (((plan && plan.due) || []).indexOf(site) >= 0) return 'due'
        if (((plan && plan.waiting) || []).indexOf(site) >= 0) return 'waiting'
        return null
      }
      const plannedTimeOf = function (b) {
        if (b.plannedTime) return String(b.plannedTime)
        const times = (plan && plan.siteTimes) || (ov.defaults && ov.defaults.siteTimes) || {}
        return times[siteOfBoardId(b.boardId)] || ''
      }
      const waitingRows = rows.filter(function (b) { return scheduleStateOf(b) === 'waiting' })
      const dueRows = rows.filter(function (b) { return scheduleStateOf(b) === 'due' })
      // 「失败/待修」= 既不是 ok，也不是「还没到点」「等到兜底补跑」
      const badRows = rows.filter(function (b) { return b.status !== 'ok' && !scheduleStateOf(b) })
      rememberBoardNames(rows)
      const enrichPending = enrichStatus && typeof enrichStatus.pending === 'number' ? enrichStatus.pending : 0
      /** 「需要处理」= 状态异常 + 内容待核对 + 字段待补（**没有问题就整块不出现**） */
      const issues = []
      badRows.forEach(function (b) {
        const why = b.status === 'missing' ? '这次没抓到（当天没有快照）'
          : b.status === 'login_required' ? '起点 cookie 失效：导出 cookie 后上传即可恢复'
          : b.status === 'truncated' ? '没抓完（预算用尽或被取消）'
          : b.status === 'stale' ? '抓到的内容不可信（疑似未刷新或换榜）' : '状态异常'
        issues.push({
          key: 'b-' + b.boardId,
          name: b.siteName + ' · ' + b.name,
          why: why,
          detail: b.note || '',
          status: b.status,
          boardId: b.boardId,
          // Spec S5：问题要带**发生时间**（day-index 的 lastAttempt.at 早已具备），否则看不出是哪次尝试失败的
          at: (b.attempt && b.attempt.at) || b.lastCapture || null,
        })
      })
      staleIds.forEach(function (id) {
        if (badRows.some(function (b) { return b.boardId === id })) return
        const b = rows.filter(function (x) { return x.boardId === id })[0] || { name: id, siteName: '' }
        issues.push({ key: 's-' + id, name: (b.siteName ? b.siteName + ' · ' : '') + b.name, why: '与上一数据日整榜一致：站点可能还没换榜（内容待核对）', detail: '', status: 'stale', boardId: id, at: b.lastCapture || null })
      })
      if (enrichPending > 0) {
        issues.push({ key: 'enrich', name: '字段补全', why: enrichPending + ' 个榜还缺字段（进榜页点「补全缺失字段」，或等定时续跑）', detail: '', status: 'enrich', boardId: null, at: null })
      }
      const hasNoteCol = rows.some(function (b) { return !!b.note })
      /**
       * 今天的变化：按**站**分组展示（Spec S6），行可点进榜保上下文。
       * ★ 条数必须用后端给的真实总数：diffFor 每类只回前 20 条预览，
       *   旧实现拿「预览条数」当「总条数」，首订换批那天会写成「今天的变化（20 条）」而实际 100+。
       */
      const chgEntries = []
      const chgTotals = {}
      let chgSum = 0
      if (chg && chg.sites) {
        chg.sites.forEach(function (s) {
          (s.groups || []).forEach(function (g) {
            const items = g.items || []
            const n = typeof g.count === 'number' ? g.count : items.length
            chgTotals[g.group] = (chgTotals[g.group] || 0) + n
            chgSum += n
            items.forEach(function (it) { chgEntries.push({ site: s.site, siteName: s.siteName, group: g.group, it: it }) })
          })
        })
      }
      const groupNames = []
      chgEntries.forEach(function (e) { if (groupNames.indexOf(e.group) < 0) groupNames.push(e.group) })
      const groupCount = function (g) { return chgTotals[g] || 0 }
      const shownEntries = chgFilter ? chgEntries.filter(function (e) { return e.group === chgFilter }) : chgEntries
      const chgRealTotal = typeof (chg && chg.count) === 'number' && chg.count > chgSum ? chg.count : chgSum
      const previewLimited = chgRealTotal > chgEntries.length
      /** 首订榜每天整批换新（上架作品），叫「新入榜」会被读成榜单竞争意义的新入榜（Spec S7） */
      const changesGroupLabel = function (group, boardId) {
        return String(boardId || '').indexOf('qidiantu.shouding') === 0 && group === '新入榜' ? '本批上架' : group
      }
      /** 按站分组：同站的变化连在一起，行上不必再重复站名 */
      const shownBySite = []
      shownEntries.forEach(function (e) {
        const last = shownBySite[shownBySite.length - 1]
        if (last && last.site === e.site) last.items.push(e)
        else shownBySite.push({ site: e.site, siteName: e.siteName, items: [e] })
      })
      return h('div', null,
        /* ① 摘要带：日期 + 采集/待处理（文字，不靠颜色） */
        h('div', { style: C.row },
          h('span', { title: '扫描开始时刻的本地自然日', style: { fontWeight: 600 } }, '数据日期 ' + dash(ov.dataDate)),
          h('span', { style: C.muted }, '·'),
          h('span', null, '已采集 ' + (c.ok || 0) + '/' + total),
          waitingRows.length ? h('span', { style: C.muted, title: '这些站今天还没到自己的抓取时刻：不是失败' }, '· 未到计划 ' + waitingRows.length) : null,
          dueRows.length ? h('span', { style: { color: '#d9a441' }, title: '已过计划时刻但还没抓到：等兜底，或点「扫描已选榜」马上跑' }, '· 待补跑 ' + dueRows.length) : null,
          h('span', { style: issues.length ? { color: '#d9a441', fontWeight: 600 } : { color: '#3f9b4f' } },
            issues.length ? '待处理 ' + issues.length + ' 项' : '无待处理'),
          ov.hiddenCount ? h('span', { style: C.muted }, '· 未显示 ' + ov.hiddenCount + ' 个榜') : null),
        /* ② 主动作：扫描（联网）与重新载入（只读本地）分开写清 */
        h('div', { style: C.row },
          h('button', {
            style: props.busy ? C.btnOn : C.btn,
            disabled: props.busy,
            title: '按「设置 → 抓取范围」里勾选的榜逐个扫描（会联网）',
            onClick: function () { props.act('/scan') },
          }, props.busy ? '扫描中…' : '扫描已选榜'),
          props.busy ? h('button', { style: C.btn, onClick: function () { props.act('/cancel') } }, '停止本次（保留已完成）') : null,
          badRows.length ? h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.act('/retry') } }, '重试失败 ' + badRows.length + ' 个榜') : null,
          h('button', { style: C.btn, onClick: props.reload, title: '只重新读取本地数据：不联网、不采集' }, '重新载入'),
          h('span', { style: C.muted }, '上次 ' + scanLabel(scan))),
        /* 补全进度：面板顶部只有这一条（三态：跑着 / 还能续跑 / 当日已试满） */
        (function () {
          if (!enrichStatus) return null
          const run = enrichStatus.enrichRun
          const active = !!(run && run.active === true)
          const left = typeof enrichStatus.pending === 'number' ? enrichStatus.pending : 0
          if (!active && !left) return null
          // 「还能不能续跑」用宿主的 retryable 判（0 = 当日已试满），前端不自己猜
          const retryable = typeof enrichStatus.retryable === 'number' ? enrichStatus.retryable : null
          const label = active
            ? '补全中 ' + ((run && run.done) || 0) + '/' + ((run && run.total) || 0) + ' 个榜（可以先浏览，不用等）'
            : retryable === 0
              ? '补全已尽力：还缺 ' + left + ' 个榜（当日已试满，明天自动续跑）'
              : '补全未完成：还缺 ' + left + ' 个榜（后台会继续补，也可进榜点「补全缺失字段」）'
          return h('div', { style: { margin: '4px 0', padding: '4px 7px', borderRadius: '6px', background: 'rgba(255,152,0,0.12)', border: '1px solid rgba(255,152,0,0.45)' } }, label)
        })(),
        /* ③ 需要处理：仅有问题时出现 */
        issues.length ? h('div', { style: { margin: '6px 0', padding: '6px 8px', borderRadius: '8px', border: '1px solid rgba(217,164,65,.55)', background: 'rgba(217,164,65,.10)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, '需要处理'),
          issues.map(function (it) {
            /**
             * Spec S5：一条问题要给「榜名 + 发生时间 + 影响 + 可执行动作」。
             *   以前只有一个泛化「重试失败 N 个榜」，看不出是哪次尝试、也没法直接进榜看。
             */
            return h('div', { key: it.key, style: { ...C.row, alignItems: 'baseline' } },
              h('span', { style: C.dot(it.status === 'stale' || it.status === 'enrich' ? 'warn' : 'bad') }),
              h('span', { style: { fontWeight: 600 } }, it.name),
              it.at ? h('span', { style: C.muted }, fmtLocalHM(it.at)) : null,
              h('span', null, it.why),
              it.detail ? h('span', { style: C.muted }, '（' + String(it.detail).slice(0, 80) + '）') : null,
              it.boardId ? h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.onOpenBoard && props.onOpenBoard(it.boardId) }, title: '在「榜单」页打开这一榜（保上下文）' }, '查看本榜') : null,
              it.boardId ? h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.onRescanBoard && props.onRescanBoard(it.boardId) }, title: '只重扫这一榜（会联网）' }, '重扫本榜') : null)
          })) : null,
        /* ④ 今天的变化 */
        h('div', { style: C.siteBar }, '今天的变化' + (chgRealTotal ? '（' + chgRealTotal + ' 条）' : '')),
        chg && chg.note ? h('div', { style: C.muted }, chg.note) : null,
        previewLimited ? h('div', { style: C.muted }, '下表每榜每类最多列 20 条（本次 ' + chgEntries.length + ' 条，共 ' + chgRealTotal + ' 条）；点行到榜页看全部。') : null,
        chg && chg.count === 0 ? h('div', { style: C.muted }, '没有变化条目（或还没有可比基准）') : null,
        chgEntries.length ? h('div', { style: C.row },
          [{ label: '全部', value: '' }].concat(groupNames.map(function (g) { return { label: g, value: g } })).map(function (o) {
            return h('button', {
              key: 'f-' + (o.value || 'all'),
              style: chgFilter === o.value ? C.btnOn : C.btn,
              onClick: function () { setChgFilter(o.value) },
            }, o.label + ' ' + (o.value ? groupCount(o.value) : chgRealTotal))
          })) : null,
        /**
         * 变化列表：宽的时候是表格（分组 / 榜 / 书名 / 变化），窄的时候换卡片行 ——
         *   420px 下四列表格会把「分组/榜/书名/变化」挤成一条，书名被折成两行、星标掉到下一行。
         *   卡片行：第一行 分组 chip + 书名 + 星标 + 变化，第二行 榜名（次要信息，省略号）。
         */
        shownEntries.length ? (chgNarrow
          ? h('div', null, shownBySite.map(function (g) {
              return h('div', { key: 'nc-' + g.site },
                h('div', { style: { ...C.muted, marginTop: '6px', fontWeight: 600 } }, g.siteName + ' · ' + g.items.length + ' 条'),
                g.items.map(function (e, i) {
                  return h('div', {
                    key: 'nci-' + g.site + i,
                    tabIndex: 0,
                    title: '在「榜单」页打开：' + boardLabel(e.it.boardId),
                    style: { ...C.card, padding: '4px 7px', margin: '4px 0', cursor: 'pointer' },
                    onClick: function () { props.onOpenBoard && props.onOpenBoard(e.it.boardId) },
                    onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); props.onOpenBoard && props.onOpenBoard(e.it.boardId) } },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 } },
                      h('span', { style: { ...C.chip, flex: '0 0 auto', margin: 0 } }, changesGroupLabel(e.group, e.it.boardId)),
                      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: e.it.title }, e.it.title),
                      h('span', { style: { flex: '0 0 auto' }, onClick: function (ev) { ev.stopPropagation() } },
                        h(BookmarkStar, { bookKey: bookKeyOf(e.it.boardId, e.it.title), boardId: e.it.boardId, row: null, title: e.it.title })),
                      h('span', { style: { ...C.num, flex: '0 0 auto' }, title: '名次变化' }, dash(e.it.delta))),
                    h('div', { style: { ...C.muted, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.it.boardName))
                }))
            }))
          : h('table', { style: C.table },
              h('thead', null, h('tr', null, ['分组', '榜', '书名', '变化'].map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
              h('tbody', null, shownBySite.flatMap(function (g) {
                const head = h('tr', { key: 'ch-' + g.site },
                  h('td', { style: { ...C.td, paddingTop: '7px', fontWeight: 600, color: 'rgba(128,128,128,.95)' }, colSpan: 4 },
                    g.siteName + ' · ' + g.items.length + ' 条'))
                const body = g.items.map(function (e, i) {
                  return h('tr', {
                    key: 'c-' + g.site + i,
                    style: { cursor: 'pointer' },
                    title: '在「榜单」页打开：' + boardLabel(e.it.boardId),
                    onClick: function () { props.onOpenBoard && props.onOpenBoard(e.it.boardId) },
                  },
                    h('td', { style: { ...C.td, whiteSpace: 'nowrap' } }, changesGroupLabel(e.group, e.it.boardId)),
                    h('td', { style: { ...C.td, maxWidth: '160px' } }, h('span', { style: { ...C.ellip, maxWidth: Math.max(90, Math.round(avail * 0.2)) + 'px' }, title: e.it.boardName }, e.it.boardName)),
                    h('td', { style: { ...C.td, minWidth: '140px' } }, e.it.title, ' ',
                      h('span', { onClick: function (ev) { ev.stopPropagation() } },
                        h(BookmarkStar, { bookKey: bookKeyOf(e.it.boardId, e.it.title), boardId: e.it.boardId, row: null, title: e.it.title }))),
                    h('td', { style: { ...C.td, ...C.num } }, dash(e.it.delta)))
                })
                return [head].concat(body)
              })))) : null,
        /* ⑤ 全部榜单（可折叠） */
        h('div', { style: { ...C.row, marginTop: '8px' } },
          h('button', {
            style: C.btn,
            'aria-expanded': showAll ? 'true' : 'false',
            onClick: function () { setShowAll(!showAll) },
          }, (showAll ? '▾ ' : '▸ ') + '全部榜单（' + total + '）')),
        showAll ? h('table', { style: C.table },
          h('thead', null, h('tr', null, ['榜（按站）', '涨 / 新 / 退', '状态'].concat(hasNoteCol && !chgNarrow ? ['备注'] : []).map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
          h('tbody', null, (ov.sites || []).flatMap(function (s) {
            const okN = s.boards.filter(function (b) { return b.status === 'ok' }).length
            const times = s.boards.map(function (b) { return b.lastCapture ? fmtLocalHM(b.lastCapture) : '' })
            const sameTime = times.length > 0 && times.every(function (t) { return t === times[0] })
            const headTime = sameTime ? times[0] : ''
            const head = h('tr', { key: 'h-' + s.site },
              h('td', { style: { ...C.td, paddingTop: '7px', fontWeight: 600 }, colSpan: hasNoteCol && !chgNarrow ? 4 : 3 },
                h('span', { style: C.dot(okN === s.boards.length ? 'ok' : 'bad') }),
                ' ' + s.siteName,
                h('span', { style: C.muted }, '  ' + s.boards.length + ' 个榜 · 已采集 ' + okN + (headTime ? ' · 抓取 ' + headTime : ''))))
            const rowsOut = s.boards.map(function (b) {
              const noBase = b.up === null && b.newCount === null && b.out === null
              const label = b.name + (b.derived ? ' · 本地派生' : b.displayed ? '' : ' · 未显示')
              return h('tr', { key: b.boardId },
                h('td', { style: { ...C.td, paddingLeft: '16px', maxWidth: Math.max(140, Math.round(avail * 0.5)) } },
                  h('span', { style: { ...C.ellip, maxWidth: Math.max(120, Math.round(avail * 0.46)) + 'px' }, title: label }, label),
                  // 窄面板不单开「备注」列（会被压成一字一行），备注改到榜名下面
                  hasNoteCol && chgNarrow && b.note ? h('div', { style: { ...C.muted, whiteSpace: 'normal' } }, dash(b.note)) : null),
                h('td', { style: { ...C.td, ...C.num } }, noBase ? '—' : h('span', { style: { whiteSpace: 'nowrap' } },
                  '涨 ', h('span', { style: b.up > 0 ? C.up : null }, dash(b.up)), ' / ',
                  '新 ', h('span', { style: { fontWeight: 600 } }, dash(b.newCount)), ' / ',
                  '退 ', h('span', { style: b.out > 0 ? C.down : null }, dash(b.out)))),
                h('td', { style: C.td }, b.status === 'ok'
                  ? (headTime ? h('span', { style: C.muted }, '—') : (b.lastCapture ? fmtLocalHM(b.lastCapture) : '—'))
                  : h('span', { style: { color: b.status === 'stale' ? '#d9a441' : '#d9534f' } }, statusText(b.status))),
                hasNoteCol && !chgNarrow ? h('td', { style: C.td }, dash(b.note)) : null)
            })
            return [head].concat(rowsOut)
          }))) : null)
    }

    /**
     * 设置：四组 —— ① 抓取范围 ② 扫描计划 ③ 数据与性能 ④ 关于与诊断。
     *   · 勾选改动进**草稿**：底部常驻「未保存 / 放弃改动 / 保存设置」，离开前看得见
     *   · 扫描计划：开关即时生效（旁边写明开/关；失败回退），时刻改动走「保存计划」
     *   · 全站补全从榜单页挪到这里（按站「更多」），榜单页只保留「补全缺失字段」
     */
    function SettingsTab(props) {
      const ov = props.ov
      const [cat, setCat] = React.useState(null)
      const [picked, setPicked] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)
      const [autoEnrich, setAutoEnrich] = React.useState(true)
      const [qdEnrich, setQdEnrich] = React.useState(false)
      const [qdCache, setQdCache] = React.useState(null)
      const [intervalMs, setIntervalMs] = React.useState(1000)
      const [tOn, setTOn] = React.useState(false)
      const [tTimes, setTTimes] = React.useState({})
      const [tFall, setTFall] = React.useState('22:30')
      const [tNote, setTNote] = React.useState(null)
      const [tLast, setTLast] = React.useState(null)
      const [planLive, setPlanLive] = React.useState(null)
      const [retMsg, setRetMsg] = React.useState(null)
      /** 站分组默认展开（含已勾选榜的站更该展开）；只记「被收起」的，避免新站默认藏着 */
      const [closedGroups, setClosedGroups] = React.useState({})
      const load = React.useCallback(function () {
        jget('/catalog').then(function (c) {
          setCat(c)
          setPicked((c.captures || []).slice())
          setAutoEnrich(c.autoEnrich !== false)
          setQdEnrich(!!(c.qidian && c.qidian.enrich))
          setQdCache(c.qidian || null)
          setIntervalMs(typeof c.requestIntervalMs === 'number' ? c.requestIntervalMs : 1000)
          noteRequestInterval(c.requestIntervalMs)
          const t = c.timer || {}
          setTOn(t.enabled === true)
          setTTimes(t.siteTimes || {})
          setTFall(t.fallbackTime || '22:30')
          setTLast(t)
          // ★ 组件被卸载过：草稿优先（不拿服务端值盖掉用户没保存的选择）
          const d = DRAFTS.settings
          if (d && Array.isArray(d.picked)) {
            setPicked(d.picked.slice())
            if (typeof d.autoEnrich === 'boolean') setAutoEnrich(d.autoEnrich)
            if (typeof d.qdEnrich === 'boolean') setQdEnrich(d.qdEnrich)
            if (d.times && typeof d.times === 'object') setTTimes(d.times)
            if (typeof d.fall === 'string') setTFall(d.fall)
            setDirty(!!d.dirty)
            setNote('已恢复未保存的改动（还没保存）')
          } else setDirty(false)
        }).catch(function (e) { setNote(String(e)) })
      }, [])
      React.useEffect(function () { load() }, [load])
      // 只读的实时调度状态（3 分钟；有站到点待跑时 30 秒）——**不重载 /catalog**，免得冲掉草稿
      React.useEffect(function () {
        let alive = true
        let id = null
        const every = function (ms) { if (!alive) return; if (id) clearInterval(id); id = setInterval(tick, ms) }
        const tick = function () {
          jget('/timer-plan').then(function (r) {
            if (!alive) return
            const pl = (r && r.plan) || null
            if (pl) setPlanLive(pl)
            const hot = !!(pl && ((pl.due || []).length > 0 || (pl.fallback || []).length > 0))
            every(hot ? 30000 : 180000)
          }).catch(function () { if (alive) every(180000) })
        }
        tick()
        return function () { alive = false; if (id) clearInterval(id) }
      }, [])
      /** 计划时刻有没有未保存的改动（提前算：离开保护要用，且必须早于任何 return） */
      const timesDirty = !!tLast && (function () {
        const a0 = tTimes || {}
        const b0 = tLast.siteTimes || {}
        const keys = Object.keys({ ...a0, ...b0 })
        for (let i = 0; i < keys.length; i++) { if (String(a0[keys[i]] || '') !== String(b0[keys[i]] || '')) return true }
        return String(tFall || '') !== String(tLast.fallbackTime || '')
      })()
      /** 草稿写回组件外 + 登记脏状态（**含计划时刻**；面板切页/收起前据此拦一下） */
      React.useEffect(function () {
        if (!cat || !picked) return
        const anyDirty = dirty || timesDirty
        if (!anyDirty) { DRAFTS.settings = null; dirtyGuard.set('settings', false); return }
        DRAFTS.settings = { picked: (picked || []).slice(), autoEnrich: !!autoEnrich, qdEnrich: !!qdEnrich, times: tTimes || {}, fall: tFall || '', dirty: !!dirty }
        dirtyGuard.set('settings', true)
      }, [dirty, timesDirty, picked, autoEnrich, qdEnrich, tTimes, tFall])
      if (!cat || !picked) return h('div', { style: C.muted }, note || '加载中…')
      const has = function (id) { return picked.indexOf(id) >= 0 }
      const toggle = function (id, on) {
        const next = picked.slice()
        const at = next.indexOf(id)
        if (on && at < 0) next.push(id)
        if (!on && at >= 0) next.splice(at, 1)
        setPicked(next)
        setDirty(true)
        setNote(null)
      }
      const setAll = function (site, on) {
        const ids = cat.boards.filter(function (b) { return b.site === site }).map(function (b) { return b.boardId })
        setPicked(on ? picked.concat(ids.filter(function (i) { return picked.indexOf(i) < 0 })) : picked.filter(function (i) { return ids.indexOf(i) < 0 }))
        setDirty(true)
      }
      /**
       * ★ Spec S4「恢复默认」：只改**草稿**，并说清将新增/移除多少 —— 保存后才生效。
       *   默认集来自 catalog 的 defaultCaptures（宿主 defaultState().boards，唯一权威）；
       *   宿主没给就明确拒绝，不自己猜一套默认集（猜出来的东西会让「恢复默认」变成另一种事故）。
       */
      const restoreDefaults = function () {
        const def = cat && Array.isArray(cat.defaultCaptures) ? cat.defaultCaptures.slice() : null
        if (!def || !def.length) {
          setNote('这台宿主没有提供默认抓取集（catalog.defaultCaptures 缺失），只能手动勾选')
          return
        }
        const add = def.filter(function (id) { return picked.indexOf(id) < 0 })
        const del = picked.filter(function (id) { return def.indexOf(id) < 0 })
        setPicked(def)
        setDirty(true)
        setNote('已恢复默认抓取：将新增 ' + add.length + ' 个、移除 ' + del.length + ' 个（点「保存设置」才落盘）')
      }
      const toggleGroup = function (key) {
        const nx = Object.assign({}, closedGroups)
        nx[key] = !nx[key]
        setClosedGroups(nx)
      }
      const save = function () {
        setBusy(true)
        jpost('/select', { captures: picked, autoEnrich: !!autoEnrich, qidianEnrich: !!qdEnrich }).then(function (r) {
          setNote((r && r.note ? r.note : '已保存：' + picked.length + ' 个榜') + '（下次扫描生效）')
          setDirty(false)
          DRAFTS.settings = timesDirty ? { picked: picked.slice(), autoEnrich: !!autoEnrich, qdEnrich: !!qdEnrich, times: tTimes, fall: tFall, dirty: false } : null
          dirtyGuard.set('settings', timesDirty)
          if (props.onSaved) props.onSaved()
          try { window.dispatchEvent(new Event('rank-scan:saved')) } catch (e) {}
          return load()
        }).catch(function (e) { setNote('保存失败：' + e) }).then(function () { setBusy(false) })
      }
      const groups = []
      const seenG = {}
      cat.boards.forEach(function (b) {
        const k = b.site + '|' + b.group
        if (!seenG[k]) { seenG[k] = { site: b.site, siteName: b.siteName, group: b.group, items: [] }; groups.push(seenG[k]) }
        seenG[k].items.push(b)
      })
      const sites = []
      groups.forEach(function (g) { if (sites.indexOf(g.site) < 0) sites.push(g.site) })
      const siteNameOf = function (s) { const g = groups.filter(function (x) { return x.site === s })[0]; return g ? g.siteName : s }
      const pickedOf = function (site) {
        const ids = cat.boards.filter(function (b) { return b.site === site }).map(function (b) { return b.boardId })
        return picked.filter(function (i) { return ids.indexOf(i) >= 0 }).length
      }
      const siteTotal = function (site) { return cat.boards.filter(function (b) { return b.site === site }).length }
      /** 开关即时生效：乐观置位，失败**回退 UI** 并说明（不让界面说一套、服务端做另一套） */
      const toggleTimer = function (next) {
        const prev = tOn
        setTOn(next)
        setTNote(next ? '正在开启…' : '正在关闭…')
        jpost('/timer', { enabled: next }).then(function (r) {
          setTNote((r && r.note ? r.note : '已' + (next ? '开启' : '关闭')) + '（立即生效）')
          return jget('/catalog').then(function (c) { setTLast(c.timer || null) })
        }).catch(function (e) {
          setTOn(prev)
          setTNote('没能' + (next ? '开启' : '关闭') + '：' + e + '（已恢复原状态）')
        })
      }
      const savePlan = function () {
        setTNote('保存计划中…')
        jpost('/timer', { enabled: tOn, siteTimes: tTimes, fallbackTime: tFall }).then(function (r) {
          setTNote(r && r.note ? r.note : '计划已保存')
          return jget('/catalog').then(function (c) { setTLast(c.timer || null) })
        }).catch(function (e) { setTNote('保存失败：' + e) })
      }
      /** 全站补全：按站把抓取集里的榜逐个补（逐本 1 请求 + 当前间隔，会很慢） */
      const enrichSite = function (site) {
        const ids = (cat.captures || []).filter(function (id) { return String(id).split('.')[0] === site })
        if (!ids.length) { setNote('该站当前没有勾选任何榜'); return }
        setBusy(true)
        let done = 0
        let filled = 0
        let seq = Promise.resolve()
        ids.forEach(function (id) {
          seq = seq.then(function () {
            setNote('补全 ' + siteNameOf(site) + ' ' + done + '/' + ids.length + ' 个榜…')
            return jpost('/enrich?boardId=' + encodeURIComponent(id)).then(function (r) {
              done += 1
              filled += (r && r.filled) || 0
            }).catch(function () { done += 1 })
          })
        })
        seq.then(function () { setNote(siteNameOf(site) + ' 补全完成：' + ids.length + ' 个榜，共补 ' + filled + ' 条') })
          .catch(function (e) { setNote('补全失败：' + e) })
          .then(function () { setBusy(false) })
      }
      const retention = ov && ov.storage ? ov.storage.retentionDays : 180
      const sv = (ov && ov.services) || {}
      const diag = function () {
        const lines = []
        lines.push('dsh-rank-scan 诊断')
        lines.push('数据日期: ' + ((ov && ov.dataDate) || '—'))
        lines.push('已采集/总数: ' + (ov ? ((ov.counts || {}).ok || 0) + '/' + Object.keys(ov.counts || {}).reduce(function (s, k) { return s + ((ov.counts || {})[k] || 0) }, 0) : '—'))
        lines.push('服务: webServer=' + !!sv.webServer + ' timerService=' + !!sv.timerService + ' timerArmed=' + !!sv.timerArmed)
        lines.push('定时: enabled=' + tOn + ' 时刻=' + JSON.stringify(tTimes) + ' 兜底=' + tFall)
        lines.push('抓取集: ' + picked.length + ' 个榜')
        lines.push('上次扫描: ' + scanLabel(ov && ov.scan))
        return lines.join('\n')
      }
      return h('div', null,
        h(Section, { title: '抓取范围（' + picked.length + ' 个榜）', defaultOpen: true },
          h('div', { style: C.muted }, '勾选 = 抓什么；改动进草稿，点下面的「保存设置」才落盘（下次扫描生效）。抓到的榜就会显示。'),
          h('div', { style: C.row }, sites.map(function (s) {
            return h('span', { key: s, style: { ...C.row, margin: 0 } },
              h('span', { style: C.muted }, siteNameOf(s) + ' ' + pickedOf(s) + '/' + siteTotal(s)),
              h('button', { style: C.btn, onClick: function () { setAll(s, true) } }, '全选'),
              h('button', { style: C.btn, onClick: function () { setAll(s, false) } }, '全不选'),
              h(PopMenu, { label: '更多', width: 190, items: [
                { label: '补齐该站缺失字段', onClick: function () { enrichSite(s) }, title: '把该站已勾选的榜逐个补全（逐本 1 请求，很慢）' },
              ] }))
          })),
          groups.map(function (g) {
            const derived = g.items.length > 0 && String(g.items[0].boardId).indexOf('fanqie.derived.') === 0
            const gkey = g.site + '|' + g.group
            const closed = !!closedGroups[gkey]
            // Spec 4.4：站分组可折叠（20 个榜全铺开时找不到想改的那个）
            return h('div', { key: gkey },
              h('div', { style: { ...C.siteBar, cursor: 'pointer' }, onClick: function () { toggleGroup(gkey) }, title: '点一下折叠/展开这一组' },
                (closed ? '▸ ' : '▾ ') + g.siteName + ' · ' + g.group + '（' + g.items.length + '）'),
              derived ? h('div', { style: { ...C.muted, margin: '0 0 4px 2px' } }, '本地派生榜：不发请求，总是显示；不计入「未显示 N 个」。') : null,
              closed ? null : h('table', { style: C.table },
                h('tbody', null, g.items.map(function (b) {
                  return h('tr', { key: b.boardId },
                    h('td', { style: { ...C.td, width: '22px' } }, h('input', { type: 'checkbox', checked: has(b.boardId), onChange: function (e) { toggle(b.boardId, e.target.checked) } })),
                    h('td', { style: C.td }, b.label))
                }))))
          }),
          /**
           * ★ 2026-10-23（设置页 UI 重叠）：这条「保存设置」是 sticky 吸底，但背景只有 6%~12% 的灰/黄
           *   ⇒ 下面滚上来的勾选行直接透出来，和按钮文字叠在一起。改成**不透明底 + 高 z**，
           *   并加一道向上的投影，让「内容从下面滚过去」这件事看得出来。
           */
          h('div', { style: { position: 'sticky', bottom: '0', zIndex: 4, marginTop: '6px', padding: '5px 7px',
            border: '1px solid ' + (dirty ? 'rgba(217,164,65,.6)' : 'rgba(128,128,128,.28)') + '', borderRadius: '6px',
            background: 'var(--dsh-surface, #fff)',
            backgroundImage: dirty ? 'linear-gradient(rgba(217,164,65,.16), rgba(217,164,65,.16))' : 'linear-gradient(rgba(128,128,128,.06), rgba(128,128,128,.06))',
            boxShadow: '0 -8px 12px -8px rgba(0,0,0,.28)' } },
            h('div', { style: C.row },
              h('button', { style: dirty ? C.btnOn : C.btn, disabled: busy || !dirty, onClick: save }, dirty ? '保存设置（' + picked.length + ' 个榜）' : '已保存（' + picked.length + ' 个榜）'),
              // 放弃改动 = 真的丢掉草稿（否则 load 会按草稿再恢复一遍，等于没放弃）
              dirty ? h('button', { style: C.btn, disabled: busy, onClick: function () { DRAFTS.settings = null; dirtyGuard.set('settings', false); setNote('已放弃改动'); load() } }, '放弃改动') : null,
              dirty ? h('span', { style: { color: '#d9a441' } }, '有未保存的改动') : null,
              h('button', { style: C.btn, disabled: busy, onClick: restoreDefaults, title: '把勾选恢复成插件默认抓取集（只改草稿，保存后生效）' }, '恢复默认'),
              note ? h('span', { style: C.muted }, String(note).slice(0, 100)) : null)),
        ),
        h(Section, { title: '扫描计划', defaultOpen: false, summary: (tOn ? '已开启' : '已关闭') + ' · 兜底 ' + (tFall || '') + ' · ' + (tLast && tLast.wired ? '定时器已接线' : '定时器未接线') },
          h('label', { style: C.row },
            h('input', { type: 'checkbox', checked: tOn, onChange: function (e) { toggleTimer(e.target.checked) } }),
            h('span', null, tOn ? '已开启（立即生效）' : '已关闭（立即生效）'),
            h('span', { style: C.muted }, '按站分时：每站放它自己的刷新点之后抓一次，一次只跑一个站')),
          h('div', null, [['qidian', '起点'], ['sfacg', '菠萝包'], ['fanqie', '番茄'], ['ciweimao', '刺猬猫'], ['qidiantu', '起点图']].map(function (s) {
            const key = s[0]
            const pl = planLive || (tLast && tLast.plan) || {}
            const hit = (pl.siteLastScan || (tLast && tLast.siteLastScan) || {})[key] || null
            const hhmmss = hit && hit.at ? fmtLocalHM(hit.at) : ''
            const timerHM = (tLast && tLast.siteLastTimerAt && tLast.siteLastTimerAt[key]) ? fmtLocalHM(tLast.siteLastTimerAt[key]) : ''
            const why = timerHM ? '已跑（定时 ' + timerHM + '）'
              : (pl.fallback || []).indexOf(key) >= 0 ? '失败/待核对 → 兜底 ' + (tFall || '') + ' 补一次'
              : (pl.due || []).indexOf(key) >= 0 ? '已过计划时刻，待补跑'
              : hit ? '手动已抓 ' + hhmmss
              : (pl.waiting || []).indexOf(key) >= 0 ? '等到点' : '今天还没抓'
            return h('div', { key: key, style: { ...C.row, marginTop: '2px' } },
              h('span', { style: { width: '46px', flex: '0 0 auto' } }, s[1]),
              h('input', {
                type: 'time', style: { ...C.btn, width: '92px' }, value: (tTimes || {})[key] || '',
                onChange: function (e) { const nx = Object.assign({}, tTimes); nx[key] = e.target.value; setTTimes(nx) },
              }),
              h('span', { style: C.muted }, why))
          })),
          h('div', { style: { ...C.row, marginTop: '2px' } },
            h('span', { style: { width: '46px', flex: '0 0 auto' } }, '兜底'),
            h('input', { type: 'time', style: { ...C.btn, width: '92px' }, value: tFall, onChange: function (e) { setTFall(e.target.value) } }),
            h('span', { style: C.muted }, '当天失败或内容待核对的站，到这个点再补一次（每站每天一次）')),
          timesDirty ? h('div', { style: C.row },
            h('button', { style: C.btnOn, onClick: savePlan }, '保存计划'),
            h('span', { style: { color: '#d9a441' } }, '时刻有改动，未保存')) : null,
          h('div', { style: C.muted }, '状态更新于 ' + ((planLive && planLive.now) || '—') + (planLive && planLive.installedToday ? '　· 今天刚安装：安装当天不自动跑，明天起按上面的时刻执行' : '')),
          tNote ? h('div', { style: C.muted }, String(tNote).slice(0, 140)) : null),
        h(Section, { title: '数据与性能', defaultOpen: false, summary: (ov && ov.storage ? '数据目录 ' + fmtBytes(ov.storage.totalBytes) + ' · 保留 ' + retention + ' 天' : '') },
          h('div', { style: C.row },
            h('span', { style: C.muted }, '保留'),
            h('select', {
              style: { ...C.input, width: 'auto', padding: '1px 4px' },
              value: String(retention),
              title: '只影响数据日期目录（快照/报告）；配置、书签、书页缓存永不删',
              onChange: function (e) {
                const v = e.target.value === 'forever' ? 'forever' : Number(e.target.value)
                jpost('/retention', { days: v }).then(function (r) { setRetMsg((r && r.note) || '已更新'); if (props.onSaved) props.onSaved() })
                  .catch(function (e2) { setRetMsg('设置失败：' + e2) })
              },
            },
              [30, 90, 180, 365].map(function (n) { return h('option', { key: n, value: String(n) }, n + ' 天') }),
              h('option', { key: 'forever', value: 'forever' }, '永久保留')),
            retMsg ? h('span', { style: C.muted }, String(retMsg).slice(0, 80)) : null),
          ov && ov.storage ? h('div', { style: C.muted },
            '快照 ' + fmtBytes(ov.storage.snapshotBytes) + ' · state ' + fmtBytes(ov.storage.stateBytes) +
            ' · ' + ov.storage.dates + ' 天（' + dash(ov.storage.oldest) + ' 起）· 书签 ' + ov.storage.bookmarks + ' 条') : null,
          h('label', { style: C.row },
            h('input', { type: 'checkbox', checked: autoEnrich, onChange: function (e) { setAutoEnrich(e.target.checked); setDirty(true) } }),
            h('span', null, '扫描后自动补全缺失字段'),
            h('span', { style: C.muted }, '（榜页没有收藏/字数时要进书页取；补全在后台跑，抓榜先返回）')),
          h('div', { style: { ...C.row, marginTop: '4px' } },
            h('span', { style: C.muted }, '起点收藏补全'),
            h('input', { type: 'checkbox', checked: qdEnrich, onChange: function (e) { setQdEnrich(e.target.checked); setDirty(true) } }),
            h('span', { style: C.muted }, qdEnrich ? '已开启' : '已关闭（默认关）'),
            h('button', { style: C.btn, disabled: busy, onClick: function () { setBusy(true); jpost('/qidianEnrich').then(function (r) { setNote((r && r.note) || '起点补全完成'); return load() }).catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) }) } }, '补全起点收藏'),
            h('button', { style: C.btn, disabled: busy, onClick: function () { setBusy(true); jpost('/qidianCache', { clear: true }).then(function (r) { setNote((r && r.note) || '缓存已清'); return load() }).catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) }) } }, '清空书页缓存')),
          h('div', { style: C.muted }, '起点书页缓存 ' + (qdCache && qdCache.cache ? qdCache.cache.books : 0) + ' 本 · 有效期 ' + ((qdCache && qdCache.ttlDays) || 7) + ' 天' +
            (cat.bookCache ? '　· 通用书页缓存 ' + ((cat.bookCache.stat && cat.bookCache.stat.entries) || 0) + ' 本 · 有效期 ' + (cat.bookCache.ttlDays || 7) + ' 天' : '')),
          h(Section, { title: '高级：请求间隔', defaultOpen: false, summary: '当前 ' + fmtIntervalText(intervalMs) },
            h('div', { style: C.row },
              h('select', {
                style: { ...C.input, width: 'auto', padding: '1px 4px' },
                value: String(intervalMs),
                onChange: function (e) { setIntervalMs(Number(e.target.value)) },
              },
                [200, 500, 1000, 2000, 5000].map(function (v) { return h('option', { key: v, value: String(v) }, v + ' ms' + (v === 1000 ? '（默认）' : '')) }),
                h('option', { key: 0, value: '0' }, '不限速（仅本地测试）')),
              h('button', { style: C.btn, disabled: busy, onClick: function () { setBusy(true); jpost('/select', { requestIntervalMs: intervalMs }).then(function () { setNote('请求间隔已改为 ' + (intervalMs === 0 ? '不限速' : intervalMs + 'ms')); return load() }).catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) }) } }, '应用'),
              h('span', { style: C.muted }, '1s 是本项目自定的保守值（不是站点要求）；调小更快，也更容易被站点注意到')))),
        h(Section, { title: '关于与诊断', defaultOpen: false, summary: (sv.webServer ? '服务正常' : 'webServer 未注册') + ' · 定时' + (sv.timerArmed ? '已接线' : '未接线') },
          h(VersionRow, { setNote: setNote }),
          h('div', { style: C.muted }, '服务：webServer ' + (sv.webServer ? '✓' : '✗') + ' · timer ' + (sv.timerService ? '✓' : '✗') + ' · 定时器' + (sv.timerArmed ? '已接线' : '未接线')),
          note ? h('div', { style: C.muted }, '最近提示：' + String(note).slice(0, 160)) : null,
          h('div', { style: C.row },
            h('button', { style: C.btn, onClick: function () { try { navigator.clipboard.writeText(diag()); setNote('诊断信息已复制（不含凭证）') } catch (e) { setNote('复制失败：' + e) } } }, '复制诊断信息'))))
    }
    /**
     * ★ 版本区（2026-10-16）：显示当前版本 + 「一键更新」。
     * 口径全部来自 host 的 /update-check 回答（它内部用 update-check.ts 的五态状态机）：
     *   state=unavailable 只读降级（没装 dsh-market，或它不支持就地更新）；
     *   state=latest 已最新；update-available 可点；busy 进行中；failed 显示原因与可重试性。
     * ★ 纪律：**绝不自造进程控制** —— 重启只走 host 转发的市场 /restart（且 requiresRestart 且 supported 才显示）。
     */
    function VersionRow(props) {
      const [info, setInfo] = React.useState(null)
      const [chk, setChk] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState('')
      /**
       * ★ 2026-10-16 审计：一键更新的轮询链最多 30 次 × 2s（§runUpdate 的 poll）。
       *   旧写法没有任何取消令牌 ⇒ 组件卸载（收起浮窗/切页签/热重载）后旧链还在 setTimeout 里
       *   继续打 /update-check 并 setState。用 ref 当令牌，cleanup 时置 false。
       */
      const aliveRef = React.useRef(true)
      function refresh(opId) {
        return jget('/update-check' + (opId ? '?operationId=' + encodeURIComponent(opId) : ''))
          .then(function (j) { if (aliveRef.current) setChk(j); return j })
          .catch(function (e) { if (aliveRef.current) setNote('检查更新失败：' + String(e).slice(0, 80)); return null })
      }
      React.useEffect(function () {
        aliveRef.current = true
        let alive = true
        jget('/version').then(function (j) { if (alive) setInfo(j) }).catch(function () { if (alive) setInfo({ version: null }) })
        refresh()
        return function () { alive = false; aliveRef.current = false }
      }, [])
      function runUpdate() {
        setBusy('update'); setNote('已请求更新…')
        jpost('/update', {}).then(function (r) {
          const id = r && r.operationId
          if (!id) { setNote((r && r.error) || '更新提供方没有返回 operationId'); return refresh() }
          let n = 0
          function poll() {
            if (!aliveRef.current) return null
            n += 1
            return refresh(id).then(function (j) {
              if (!aliveRef.current) return j
              const st = j && j.state
              if (n < 30 && (st === 'busy' || st === 'update-available')) {
                return new Promise(function (res) { setTimeout(res, 2000) }).then(function () { return aliveRef.current ? poll() : j })
              }
              if (st === 'failed') setNote('更新未成功：' + ((j && j.reason) || '未知原因'))
              else if (j && j.action === 'refresh') setNote('更新完成，刷新页面即可生效')
              else if (j && j.action === 'restart') setNote('更新完成，按提示重启 DSH 生效')
              else if (j && j.action === 'manual') setNote('更新完成，但需要你自己重启 DSH 才能生效')
              else setNote('更新完成')
              return j
            })
          }
          return poll()
        }).catch(function (e) { if (aliveRef.current) setNote('更新请求失败：' + String(e).slice(0, 80)) })
          .then(function () { if (aliveRef.current) setBusy('') })
      }
      const st = chk ? chk.state : null
      const src = chk && chk.latestSource ? '（来源 ' + chk.latestSource + '）' : ''
      const line = !chk ? '读取版本…'
        : st === 'busy' ? '更新进行中…'
        : st === 'update-available' ? '当前 ' + chk.current + ' → 可更新到 ' + (chk.latest || '?') + src
        : st === 'failed' ? '更新失败：' + (chk.reason || '未知原因')
        : st === 'latest' ? '当前 ' + chk.current + '，已是最新' + src
        // ★ Q26（ticket 44）：dsh-rank-scan 尚未发布到 npm（registry 404）⇒「一键更新」这条路
        //   本来就不存在；如实告诉用户去哪儿更新，不要显示一句含混的「更新检查不可用」。
        : (chk.latestSource == null && !chk.latest)
          ? '当前 ' + chk.current + '：未发布到 npm，请用 Release 附件或仓库链接更新'
          : '当前 ' + chk.current + '（' + (chk.reason || '更新检查不可用') + '）' + (chk.latest ? '；registry 最新 ' + chk.latest : '')
      const canClick = !!(chk && (chk.canUpdateInPlace || chk.action === 'refresh' || chk.action === 'restart'))
      return h('div', { style: { margin: '8px 0', padding: '7px 9px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', background: 'rgba(128,128,128,.05)' } },
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '版本'),
        h('div', { style: C.muted }, line),
        (info && info.name && info.version) ? h('div', { style: C.muted }, info.name + '　v' + info.version) : null,
        h('div', { style: C.row },
          h('button', {
            style: C.btn,
            disabled: busy !== '' || !canClick,
            onClick: function () {
              if (!chk) return
              if (chk.action === 'refresh') { try { window.location.reload() } catch (e) {} return }
              if (chk.action === 'restart') {
                setBusy('update'); setNote('已请求重启…')
                jpost('/update-restart', {}).then(function (r) { setNote((r && r.ok) ? '重启请求已发出' : ('重启失败：' + ((r && r.error) || '?'))) })
                  .catch(function (e) { setNote('重启请求失败：' + String(e).slice(0, 80)) })
                  .then(function () { setBusy('') })
                return
              }
              if (chk.canUpdateInPlace) runUpdate()
              else refresh()
            },
          }, busy !== '' ? '处理中…' : (!chk ? '检查中…' : chk.buttonLabel)),
          h('button', { style: C.btn, disabled: busy !== '', onClick: function () { setNote(''); refresh() } }, '重新检查')),
        note ? h('div', { style: C.muted }, note) : null)
    }

    function cell(c, r) {
      const k = c.key
      const ex = r.extra || {}
      if (k === 'title') {
        const label = (r.title || '') + (ex.titleSuspect || ex.titleTruncated ? ' ⚠' : '')
        const link = h('a', { href: r.url || '#', style: { color: 'inherit' }, title: '在 DSH 侧栏浏览器打开', onClick: function (e) { e.preventDefault(); e.stopPropagation(); (c._openLink || function (u) { window.open(u, '_blank', 'noopener,noreferrer') })(r.url) } }, label)
        return c._boardId ? h('span', null, link, ' ', h(BookmarkStar, { bookKey: c._bmKey, row: r, boardId: c._boardId, dataDate: c._dataDate })) : link
      }
      // 名次变化：0 显示「0」（持平），不要显示「—」（— 留给「算不出来」：无基准/新入榜）
      // ★ 2026-10-16 跨期不可比（周期榜换期当天）：变化列显示「新期」，不显示一个跨期的假变化
      // ★ 2026-10-17（配色）：delta 是「名次前进为正」的口径 ⇒ >0 上升=绿、<0 下滑=红；0/新期/回榜 不上色
      if (k === 'delta') {
        if (ex.periodChanged === true) return '新期'
        if (r.deltaGroup === 'new') return '＋ 新'
        if (r.deltaGroup === 'rebound') return '回榜'
        if (r.delta === null || r.delta === undefined) return '—'
        if (r.delta > 0) return h('span', { style: C.up }, '↑ ' + r.delta)
        if (r.delta < 0) return h('span', { style: C.down }, '↓ ' + Math.abs(r.delta))
        return '0'
      }
      if (k === 'read') return fmtRead(ex.read !== undefined ? ex.read : r.value)
      if (k === 'value') return fmtRead(r.value)
      if (k === 'baseRead') return fmtRead(ex.baseRead !== undefined ? ex.baseRead : ex.prevRead)
      /**
       * 「在读变化」= **我方按天的数值差**（今日 − 上一数据日），口径见 spec-扫榜插件-v1 / 取证文档。
       * ★ 2026-10-16：必须读 extra.valueDelta —— 排在它后面的名次差（row.delta / extra.delta）
       *   是**另一件事**（站方升降）；旧代码读 extra.delta ⇒ 番茄整列显示的是名次差（名次没动就只有 0/—）。
       *   宿主没给 valueDelta 时只认「在读 − 昨日在读」，**绝不**退回名次差。
       */
      if (k === 'readDelta') {
        const vd = ex.valueDelta != null ? ex.valueDelta
          : (typeof r.value === 'number' && typeof ex.prevRead === 'number' ? r.value - ex.prevRead : null)
        if (vd == null) return '—'
        if (vd > 0) return h('span', { style: C.up }, '+' + fmtRead(vd))
        if (vd < 0) return h('span', { style: C.down }, String(vd))
        return '0'
      }
      if (k === 'dailyDelta') {
        if (ex.dailyDelta == null) return '—'
        return h('span', { style: ex.dailyDelta > 0 ? C.up : ex.dailyDelta < 0 ? C.down : null },
          (ex.dailyDelta > 0 ? '+' : '') + ex.dailyDelta)
      }
      // 每日增量已拆成 daily0..daily6 七列（见 view.ts），单元格只取那一天
      if (/^daily\d+$/.test(k)) {
        const d = (ex.daily || [])[Number(k.slice(5))]
        if (!d) return '—'
        return d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + d.delta
      }
      if (k === 'ratio') {
        // 起点图对「首订暂缺」的行把收订比写成 0/-1（伪造值）⇒ 按口径当缺失，不显示负数
        const v = ex.ratio
        return typeof v === 'number' && v > 0 ? v : '—'
      }
      if (k === 'settledDays') return dash(ex.settledDays)
      // 三江「期累计」= 本期已结算各日增量之和（未到的天不计）
      if (k === 'periodTotal') return ex.periodTotal == null ? '—' : (ex.periodTotal > 0 ? '+' : '') + ex.periodTotal
      // 番茄在读周榜：本期内第 N 天的逐日增量数组（与三江的每日增量同构）
      if (/^pday\d+$/.test(k)) {
        const arr = ex.pdays || []
        const v2 = arr[Number(k.slice(4))]
        return v2 == null ? '—' : (v2 > 0 ? '+' : '') + v2
      }
      // 派生榜「本期累计」（自然周内：今日在读 − 期首在读）；期中入池算不出来 ⇒ 「—」
      if (k === 'periodDelta') return ex.periodDelta == null ? '—' : (ex.periodDelta > 0 ? '+' : '') + ex.periodDelta
      if (k === 'collect') return fmtRead(ex.collect)
      if (k === 'collectBase') return fmtRead(ex.collectBase)
      if (k === 'fans') return fmtRead(ex.fans)
      if (k === 'score') return dash(ex.score)
      if (k === 'words') return fmtWords(ex.wordsText !== undefined ? ex.wordsText : ex.wordsCnt !== undefined ? ex.wordsCnt : ex.wordNumber !== undefined ? ex.wordNumber : ex.words)
      if (k === 'updated') return fmtTime(ex.lastChapterUpdateTime)
      if (k === 'subCat') return dash(ex.subCat)
      if (k === 'cat') return dash(ex.cat)
      if (k === 'days') return dash(r.days)
      if (k === 'author') return dash(r.author)
      if (k === 'rank') return dash(r.rank)
      if (k === 'buyNumRaw') return dash(ex.buyNumRaw)
      return dash(r[k])
    }

    /** 榜 + 站内书号 ⇒ bookKey（与 host 端同一套命名空间规则；起点图归并到 qidian） */
    /**
     * 榜名注册表：概览/目录任一处拿到 name 就记下来。
     * 书签详情、导出提示等处用它把 boardId 换成「站 · 榜名」（以前直接把 `qidiantu.shouding` 这种内部 id 甩给使用者）。
     */
    const BOARD_NAMES = (window.__rankScanBoardNames = window.__rankScanBoardNames || {})
    const rememberBoardNames = function (list) {
      (list || []).forEach(function (b) {
        if (!b || !b.boardId) return
        const label = b.name || b.label
        if (!label) return
        BOARD_NAMES[b.boardId] = b.siteName ? b.siteName + ' · ' + label : label
      })
    }
    const boardLabel = function (boardId) {
      const id = String(boardId || '')
      return BOARD_NAMES[id] || (id || '—')
    }

    function bookKeyOf(boardId, key) {
      const id = String(key == null ? '' : key).trim()
      if (!id) return ''
      const s = String(boardId || '')
      const ns = s.indexOf('qidiantu.') === 0 ? 'qidian' : s.indexOf('ciweimao.') === 0 ? 'ciweimao' : s.indexOf('sfacg.') === 0 ? 'sfacg' : s.indexOf('fanqie.') === 0 ? 'fanqie' : s.indexOf('qidian.') === 0 ? 'qidian' : ''
      return ns ? ns + ':' + id : ''
    }

    /** 行详情卡里的书签编辑：备注 + 夹一起**显式保存**（失败保留草稿） */
    function DetailBookmarkEditor(props) {
      const store = bmStore.use()
      const bk = props.bookKey
      const [note, setNote] = React.useState('')
      const [folders, setFolders] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [loaded, setLoaded] = React.useState(false)
      React.useEffect(function () {
        if (!bk) return
        jget('/bookmarks').then(function (r) {
          const hit = ((r && r.bookmarks) || []).filter(function (b) { return b.bookKey === bk })[0]
          if (hit) { setNote(hit.note || ''); setFolders((hit.folders || []).join(' ')) }
          setLoaded(true)
        }).catch(function () { setLoaded(true) })
      }, [bk, store.total])
      if (!bk || !store.has(bk)) return null
      const save = function () {
        setBusy(true)
        setMsg(null)
        store.act({ action: 'update', bookKey: bk, note: note, folders: String(folders || '').split(/[\s,，]+/).filter(Boolean) })
          .then(function () { setBusy(false); setMsg('已保存'); return store.refreshList() })
          .catch(function (e) { setBusy(false); setMsg('保存失败：' + e + '（草稿还在）') })
      }
      return h('div', { style: { ...C.detail, marginTop: '6px' } },
        h('div', { style: C.row },
          h('span', { style: C.muted }, '备注'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '160px' }, value: note, placeholder: '写点什么，可用 #标签', onChange: function (e) { setNote(e.target.value) } })),
        h('div', { style: C.row },
          h('span', { style: C.muted }, '书签夹'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '120px' }, value: folders, placeholder: '空格分隔，可属于多个夹', onChange: function (e) { setFolders(e.target.value) } }),
          h('button', { style: C.btnOn, disabled: busy || !loaded, onClick: save }, busy ? '保存中…' : '保存')),
        msg ? h('div', { style: { ...C.muted, color: String(msg).indexOf('失败') >= 0 ? '#d9534f' : null } }, msg) : null)
    }

    /**
     * 「我的书签」：**默认读，按需编辑**。
     *   · 紧凑卡：书名/作者/站 + 核心指标 + 数据截止 + 备注摘要/标签/夹
     *   · 备注与夹进同一个编辑面板，**显式保存/取消**；失败保留草稿（不再失焦即存）
     *   · 批量选择才出现复选框；导出先选范围（已选 / 当前筛选 / 全部）并写出条数
     *   · 添加作品、回收站、导出都收进「更多」；删除仍可撤销
     */
    function BookmarksTab(props) {
      const store = bmStore.use()
      const [, force] = React.useState(0)
      const bump = function () { force(function (x) { return x + 1 }) }
      const [undo, setUndo] = React.useState(null)
      const [slide, setSlide] = React.useState(0)
      const [trash, setTrash] = React.useState([])
      const [showTrash, setShowTrash] = React.useState(false)
      const [confirmPurge, setConfirmPurge] = React.useState(false)
      const [manual, setManual] = React.useState('')
      const [manualSite, setManualSite] = React.useState('')
      const [addOpen, setAddOpen] = React.useState(false)
      const [filtersOpen, setFiltersOpen] = React.useState(false)
      // 编辑态：草稿只活在本地 state；保存成功才清，失败保留并就地报错
      // ★ 草稿从组件外恢复：切页/收起把本组件卸了，回来还在（不丢用户写了一半的备注）
      const [editKey, setEditKey] = React.useState(function () { return DRAFTS.bm ? DRAFTS.bm.bookKey : null })
      const [draft, setDraft] = React.useState(function () { return DRAFTS.bm ? { note: DRAFTS.bm.note || '', folders: DRAFTS.bm.folders || '' } : { note: '', folders: '' } })
      const [editErr, setEditErr] = React.useState(null)
      const [editBusy, setEditBusy] = React.useState(false)
      const [discardAsk, setDiscardAsk] = React.useState(false)
      const [detailKey, setDetailKey] = React.useState(null)
      const [selectMode, setSelectMode] = React.useState(false)
      const [sel, setSel] = React.useState([])
      const [exportOpen, setExportOpen] = React.useState(false)
      const [scope, setScope] = React.useState('filtered')
      const [exporting, setExporting] = React.useState(false)
      const fmtS = React.useState(function () { try { return localStorage.getItem('rank-scan-panel:export:fmt:v1') || 'csv' } catch (e) { return 'csv' } })
      const fmt = fmtS[0]
      const setFmt = fmtS[1]
      const destS = React.useState(function () { try { return localStorage.getItem('rank-scan-panel:export:dest:v1') || '' } catch (e) { return '' } })
      const dest = destS[0]
      const setDest = destS[1]
      const exS = React.useState(null)
      const exMsg = exS[0]
      const setExMsg = exS[1]
      const toggleSel = function (k) {
        setSel(function (s) { return s.indexOf(k) >= 0 ? s.filter(function (x) { return x !== k }) : s.concat([k]) })
      }
      const load = function () {
        healStore(store)
        if (typeof store.refreshList === 'function') store.refreshList().then(bump).catch(function () { bump() })
        if (typeof store.trashList === 'function') store.trashList().then(function (t) { setTrash(t) })
      }
      const flt = healStore(store).filters
      React.useEffect(function () { load() }, [flt.q, flt.site, flt.folder, flt.tag])
      React.useEffect(function () {
        if (!undo) return undefined
        const t = setTimeout(function () { setUndo(null) }, 8000)
        const id = setInterval(function () { setSlide(function (s) { return s >= 100 ? 100 : s + 2 }) }, 100)
        return function () { clearTimeout(t); clearInterval(id) }
      }, [undo])
      const SITE_NAME = { qidian: '起点', qidiantu: '起点图', ciweimao: '刺猬猫', sfacg: '菠萝包', fanqie: '番茄' }
      const siteLabel = function (s) { return SITE_NAME[s] || s }
      const f = flt
      const setF = function (patch) { healStore(store); store.filters = { ...store.filters, ...patch }; bump() }
      const list = (store.list && store.list.bookmarks) || []
      const sites = []
      list.forEach(function (b) { if (sites.indexOf(b.site) < 0) sites.push(b.site) })
      const dirtyOf = function (b) {
        const note0 = String(b.note || '')
        const fold0 = (b.folders || []).join(' ')
        return String(draft.note || '') !== note0 || String(draft.folders || '').replace(/\s+/g, ' ').trim() !== fold0.replace(/\s+/g, ' ').trim()
      }
      /** 草稿写回组件外 + 登记脏状态（面板切页/收起前据此拦一下） */
      React.useEffect(function () {
        if (!editKey) { DRAFTS.bm = null; dirtyGuard.set('bm', false); return }
        const b = list.filter(function (x) { return x.bookKey === editKey })[0]
        const dirty = !!(b && dirtyOf(b))
        DRAFTS.bm = { bookKey: editKey, note: draft.note, folders: draft.folders, dirty: dirty }
        dirtyGuard.set('bm', dirty)
      }, [editKey, draft.note, draft.folders, store.total])
      const startEdit = function (b) {
        setEditKey(b.bookKey)
        setDraft({ note: String(b.note || ''), folders: (b.folders || []).join(' ') })
        setEditErr(null)
        setDiscardAsk(false)
      }
      const closeEdit = function () { setEditKey(null); setDraft({ note: '', folders: '' }); setEditErr(null); setDiscardAsk(false) }
      const cancelEdit = function (b) {
        if (dirtyOf(b)) { setDiscardAsk(true); return }
        closeEdit()
      }
      const saveEdit = function (b) {
        const note = String(draft.note || '')
        const folders = String(draft.folders || '').split(/[\s,，]+/).filter(Boolean)
        setEditBusy(true)
        setEditErr(null)
        store.act({ action: 'update', bookKey: b.bookKey, note: note, folders: folders })
          .then(function () { return store.refreshList() })
          .then(function () { setEditBusy(false); closeEdit(); bump() })
          .catch(function (e) { setEditBusy(false); setEditErr('保存失败：' + e + '　（草稿还在，可再试一次）') })
      }
      const doRemove = function (b) {
        setSlide(0)
        if (editKey === b.bookKey) closeEdit()
        store.act({ action: 'remove', bookKey: b.bookKey }).then(function () { setUndo(b); load() }).catch(function () {})
      }
      const doUndo = function () {
        if (!undo) return
        store.act({ action: 'restore', bookKey: undo.bookKey }).then(function () { setUndo(null); load() }).catch(function () {})
      }
      const doRefresh = function (keys) {
        store.msg = '更新中（每本 1 请求，逐本 ' + fmtIntervalText() + '）…'; bump()
        jpost('/bookmark/refresh', { bookKeys: keys }).then(function (r) {
          store.msg = (r && r.note) || '已更新'
          return store.refreshList()
        }).then(function () { bump() }).catch(function (e) { store.msg = '更新失败：' + e; bump() })
      }
      const scopeCount = function () {
        if (scope === 'selected') return sel.length
        if (scope === 'all') return store.total || list.length
        return list.length
      }
      const doExport = function () {
        const fmtV = fmt
        const destV = String(dest || '').trim()
        setExporting(true)
        setExMsg('导出中…')
        const keysP = scope === 'all'
          ? jget('/bookmarks').then(function (r) { return ((r && r.bookmarks) || []).map(function (x) { return x.bookKey }) })
          : Promise.resolve(scope === 'selected' ? sel.slice() : list.map(function (b) { return b.bookKey }))
        keysP.then(function (keys) {
          if (!keys || !keys.length) { setExMsg('这个范围没有可导出的条目'); return null }
          try {
            localStorage.setItem('rank-scan-panel:export:fmt:v1', fmtV)
            localStorage.setItem('rank-scan-panel:export:dest:v1', destV)
          } catch (e) {}
          return jpost('/bookmark/export-file', { format: fmtV, bookKeys: keys, dest: destV || undefined })
            .then(function (r) { setExMsg((r && r.note) || ('已导出 ' + keys.length + ' 条')) })
        }).catch(function (e) { setExMsg('导出失败：' + e) }).then(function () { setExporting(false) })
      }
      const addManual = function () {
        jpost('/bookmark/add-manual', { input: String(manual || '').trim(), site: manualSite || undefined }).then(function (r) {
          store.msg = (r && r.note) || '已添加'
          setManual('')
          return store.refreshList()
        }).then(function () { bump() }).catch(function (e) { store.msg = '添加失败：' + e; bump() })
      }
      const collectTitle = function (b, lab) {
        const src = b.collectFrom === 'qidian-book-cache' ? '来自起点书页缓存（扫描后补全回填）'
          : b.collectFrom === 'book-page' ? '来自书页刷新'
          : b.collectFrom === 'snapshot' ? '来自当天榜单行'
          : '这个榜的榜单行里没有该数据；点「更新本书数据」可按书页取一次'
        return lab + '：' + fmtRead(b.collect) + '　·　' + src
      }
      const moreItems = [
        { label: '批量选择', onClick: function () { setSelectMode(true) } },
        { label: '导出…', onClick: function () { setExportOpen(true) } },
        { label: '添加作品…', onClick: function () { setAddOpen(true) } },
        { label: '刷新列表', onClick: load },
        { sep: true },
        { label: (showTrash ? '收起' : '打开') + '回收站（' + trash.length + '）', onClick: function () { setShowTrash(!showTrash); store.trashList().then(function (t) { setTrash(t) }) } },
      ]
      return h('div', null,
        h('div', { style: C.row },
          h('input', { style: { ...C.input, flex: 1, minWidth: '130px' }, placeholder: '搜书名/作者/备注', value: f.q, onChange: function (e) { setF({ q: e.target.value }) } }),
          h('select', { style: C.input, value: f.site, onChange: function (e) { setF({ site: e.target.value }) } },
            h('option', { value: '' }, '全部站'), sites.map(function (s) { return h('option', { key: s, value: s }, siteLabel(s)) })),
          h('select', { style: C.input, value: f.folder, onChange: function (e) { setF({ folder: e.target.value }) } },
            h('option', { value: '' }, '全部夹'), (store.folders || []).map(function (x) { return h('option', { key: x, value: x }, x) })),
          h('button', { style: filtersOpen ? C.btnOn : C.btn, onClick: function () { setFiltersOpen(!filtersOpen) }, 'aria-expanded': filtersOpen ? 'true' : 'false' }, '筛选'),
          h(PopMenu, { label: '更多', items: moreItems, width: 200 })),
        filtersOpen ? h('div', { style: { ...C.row, padding: '4px 6px', border: '1px solid rgba(128,128,128,.28)', borderRadius: '6px' } },
          h('span', { style: C.muted }, '标签'),
          h('input', { style: { ...C.input, width: '120px' }, placeholder: '#标签', value: f.tag || '', onChange: function (e) { setF({ tag: String(e.target.value).replace(/^#/, '') }) } }),
          (f.q || f.site || f.folder || f.tag) ? h('button', { style: C.btn, onClick: function () { setF({ q: '', site: '', folder: '', tag: '' }) } }, '清除筛选') : null,
          h('span', { style: C.muted }, '备注里写的 #标签 会自动出现在这里')) : null,
        addOpen ? h('div', { style: { ...C.card, marginTop: '4px' } },
          h('div', { style: C.row },
            h('span', { style: C.muted }, '添加作品'),
            h('input', { style: { ...C.input, flex: 1, minWidth: '150px' }, placeholder: '贴书页 URL 或 qidian:<书号>（纯书号请选站）', value: manual, onChange: function (e) { setManual(e.target.value) } }),
            h('select', { style: C.input, value: manualSite, onChange: function (e) { setManualSite(e.target.value) } },
              h('option', { value: '' }, '（URL 可自动识别）'),
              h('option', { value: 'qidian' }, '起点'), h('option', { value: 'qidiantu' }, '起点图'), h('option', { value: 'ciweimao' }, '刺猬猫'), h('option', { value: 'sfacg' }, '菠萝包'), h('option', { value: 'fanqie' }, '番茄')),
            h('button', { style: C.btn, disabled: !String(manual || '').trim(), onClick: addManual }, '加入书签'),
            h('button', { style: C.btn, onClick: function () { setAddOpen(false) } }, '收起'))) : null,
        h('div', { style: C.muted }, (store.list === null ? '加载中…' : '共 ' + list.length + ' 条' + (store.total && store.total !== list.length ? '（全部 ' + store.total + ' 条，已按筛选）' : '') + '　·　不含回收站')),
        store.health && store.health.error ? h('div', { style: { ...C.muted, color: '#d9534f' } }, '⚠ ' + store.health.error) : null,
        selectMode ? h('div', { style: { ...C.row, padding: '4px 6px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '6px', background: 'rgba(128,128,128,.05)' } },
          h('span', null, '已选 ' + sel.length + ' 条'),
          h('button', { style: C.btn, onClick: function () { setSel(list.map(function (b) { return b.bookKey })) } }, '全选当前筛选（' + list.length + '）'),
          h('button', { style: C.btn, disabled: !sel.length, onClick: function () { setSel([]) } }, '取消选择'),
          h('button', { style: C.btn, disabled: !sel.length, onClick: function () { setScope('selected'); setExportOpen(true) } }, '导出已选'),
          h('button', { style: C.btn, onClick: function () { setSelectMode(false); setSel([]) } }, '退出批量选择')) : null,
        exportOpen ? h('div', { style: { ...C.card, marginTop: '4px' } },
          h('div', { style: { fontWeight: 600 } }, '导出书签'),
          h('div', { style: C.row },
            [['selected', '已选 ' + sel.length + ' 条'], ['filtered', '当前筛选 ' + list.length + ' 条'], ['all', '全部 ' + (store.total || list.length) + ' 条']].map(function (o) {
              return h('label', { key: o[0], style: C.row },
                h('input', { type: 'radio', name: 'rs-export-scope', checked: scope === o[0], onChange: function () { setScope(o[0]) } }),
                h('span', null, o[1]))
            })),
          h('div', { style: C.row },
            h('select', { style: C.input, value: fmt, onChange: function (e) { setFmt(e.target.value) } },
              h('option', { value: 'csv' }, 'CSV'), h('option', { value: 'json' }, 'JSON'), h('option', { value: 'md' }, 'Markdown')),
            h('input', { style: { ...C.input, flex: 1, minWidth: '150px' }, placeholder: '导出目录（留空 = 默认目录）', value: dest, onChange: function (e) { setDest(e.target.value) } }),
            h('button', { style: C.btnOn, disabled: exporting || scopeCount() === 0, title: scopeCount() === 0 ? '这个范围没有条目' : '', onClick: doExport }, exporting ? '导出中…' : '导出 ' + scopeCount() + ' 条'),
            h('button', { style: C.btn, onClick: function () { jpost('/bookmark/open-folder', { path: String(dest || '').trim() || undefined }).then(function (r) { setExMsg('已打开 ' + ((r && r.opened) || '')) }).catch(function (e) { setExMsg('打不开：' + e) }) } }, '打开文件夹'),
            h('button', { style: C.btn, onClick: function () { setExportOpen(false) } }, '收起')),
          exMsg ? h('div', { style: C.muted }, String(exMsg).slice(0, 140)) : null) : null,
        list.length === 0 ? h('div', { style: C.muted }, store.list === null ? '' : (f.q || f.site || f.folder || f.tag ? '没有符合筛选条件的书签' : '还没有书签：在「榜单」里点书名旁的 ☆ 就能加')) : null,
        list.map(function (b) {
          const lab = b.collectLabel || (b.site === 'fanqie' ? '在读' : '收藏')
          const editing = editKey === b.bookKey
          const noteText = String(b.note || '').replace(/\s+/g, ' ').trim()
          const metricText = metricChipText(b.metric, b.collect, lab)
          const oldMetric = b.metric && b.metric.value != null && b.metric.name === lab && b.metric.value !== b.collect ? b.metric.value : null
          return h('div', { key: b.bookKey, style: { ...C.card, padding: '6px 8px' } },
            h('div', { style: C.row },
              selectMode ? h('input', { type: 'checkbox', style: { margin: '0 2px', flex: '0 0 auto' }, checked: sel.indexOf(b.bookKey) >= 0, onChange: function () { toggleSel(b.bookKey) } }) : null,
              h('span', { style: C.cardTitle }, b.label),
              b.author ? h('span', { style: C.muted }, b.author) : null,
              h('span', { style: C.chip }, siteLabel(b.site)),
              b.collect == null
                ? h('span', { style: { ...C.chip, opacity: 0.55 }, title: collectTitle(b, lab) }, lab + ' —')
                : h('span', { style: C.chip, title: collectTitle(b, lab) }, lab + ' ' + fmtRead(b.collect)),
              oldMetric != null ? h('span', { style: { ...C.chip, opacity: 0.8 }, title: '书签记录：最近一次自动更新时该榜的' + lab + '（与上面的实时值不是同一时点）' }, '书签记录 ' + fmtRead(oldMetric)) : null,
              metricText ? h('span', { style: C.chip }, metricText) : null,
              b.capturedAt ? h('span', { style: C.muted, title: '这张卡的数据截止到这一天' }, '截止 ' + mdOf(b.capturedAt) + (b.ageDays != null ? '（' + b.ageDays + ' 天前）' : '')) : null,
              b.ageDays != null && b.ageDays >= 7 ? h('span', { style: { ...C.chip, color: '#d9a441' }, title: '超过 7 天没有变新：点「更新本书数据」试试；仍不变则这个来源可能取不到数了' }, '数据已 ' + b.ageDays + ' 天未更新') : null,
              b.valueFrom === 'manual' ? h('span', { style: C.chip }, '待补') : null),
            h('div', { style: C.row },
              h('button', {
                style: { ...C.btn, border: '1px dashed rgba(128,128,128,.35)', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                title: noteText ? '编辑备注' : '加备注',
                onClick: function () { startEdit(b) },
              }, noteText ? noteText.slice(0, 60) : '＋ 备注'),
              (b.tags || []).map(function (t) { return h('span', { key: 't' + t, style: C.chip }, '#' + t) }),
              (b.folders || []).map(function (x) { return h('span', { key: 'f' + x, style: C.chip }, '夹 ' + x) })),
            editing ? h('div', { style: { ...C.detail, marginTop: '4px' } },
              h('div', { style: C.row },
                h('span', { style: C.muted }, '备注'),
                h('textarea', {
                  rows: 2, value: draft.note, placeholder: '可用 #标签',
                  onChange: function (e) { setDraft({ ...draft, note: e.target.value }) },
                  style: { ...C.input, flex: 1, minWidth: '160px', resize: 'vertical', fontFamily: 'inherit' },
                })),
              h('div', { style: C.row },
                h('span', { style: C.muted }, '书签夹'),
                h('input', {
                  style: { ...C.input, flex: 1, minWidth: '120px' }, value: draft.folders, placeholder: '空格分隔，可属于多个夹',
                  onChange: function (e) { setDraft({ ...draft, folders: e.target.value }) },
                })),
              h('div', { style: C.row },
                h('button', { style: C.btnOn, disabled: editBusy, onClick: function () { saveEdit(b) } }, editBusy ? '保存中…' : '保存'),
                h('button', { style: C.btn, disabled: editBusy, onClick: function () { cancelEdit(b) } }, '取消'),
                discardAsk
                  ? h('span', { style: { ...C.row, color: '#d9a441' } },
                      h('span', null, '放弃这些改动？'),
                      h('button', { style: C.btn, onClick: function () { closeEdit() } }, '放弃'),
                      h('button', { style: C.btn, onClick: function () { setDiscardAsk(false) } }, '继续编辑'))
                  : null,
                editErr ? h('span', { style: { color: '#d9534f' } }, editErr) : null)) : null,
            h('div', { style: C.row },
              h('a', { href: b.url || '#', style: { color: 'inherit', padding: '3px 8px' }, title: '在 DSH 侧栏浏览器打开', onClick: function (e) { e.preventDefault(); (props.openLink || function (u) { window.open(u, '_blank', 'noopener,noreferrer') })(b.url) } }, '打开'),
              h(PopMenu, { label: '更多', width: 190, items: [
                { label: '编辑备注/夹', onClick: function () { startEdit(b) } },
                { label: '更新本书数据（联网）', onClick: function () { doRefresh([b.bookKey]) }, title: '按书页取一次最新读数' },
                { label: detailKey === b.bookKey ? '收起详情' : '查看详情', onClick: function () { setDetailKey(detailKey === b.bookKey ? null : b.bookKey) } },
                { sep: true },
                { label: '删除', onClick: function () { doRemove(b) } },
              ] })),
            detailKey === b.bookKey ? h('div', { style: { ...C.detail, marginTop: '4px' } },
              b.firstSeen
                ? h('div', { style: C.muted }, '首次发现：' + boardLabel(b.firstSeen.boardId) + ' 第 ' + (b.firstSeen.rank == null ? '—' : b.firstSeen.rank) + ' 名（' + b.firstSeen.dataDate + '）')
                : h('div', { style: C.muted }, '手动添加 · 无榜单来源'),
              b.source === 'manual' ? h('div', { style: C.muted }, '不在任何榜里 ⇒ 不会自动更新；点「更新本书数据」按书页取一次') : null,
              (b.seenBoards || []).length > 1
                ? h('div', { style: C.muted }, '也上过：' + (b.seenBoards || []).map(function (s) { return boardLabel(s.boardId) }).join('、'))
                : null,
              h('div', { style: C.muted }, '备注与夹只由你改：任何自动更新都不会覆盖。')) : null)
        }),
        undo ? h('div', { style: { ...C.row, padding: '5px 7px', border: '1px solid rgba(217,164,65,.5)', borderRadius: '6px', background: 'rgba(217,164,65,.10)' } },
          h('span', null, '已删除「' + undo.label + '」'),
          h('button', { style: C.btnOn, onClick: doUndo }, '撤销'),
          h('span', { style: C.muted }, '（8 秒内；之后可在回收站找回）')) : null,
        showTrash ? h('div', { style: { marginTop: '8px', padding: '6px 8px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px' } },
          h('div', { style: C.row },
            h('span', { style: { fontWeight: 600 } }, '回收站（' + trash.length + '）'),
            trash.length
              ? (confirmPurge
                  ? h('span', { style: C.row },
                      h('span', { style: { color: '#d9534f' } }, '清空后不可恢复，确定？'),
                      h('button', { style: { ...C.btn, color: '#d9534f' }, onClick: function () { jpost('/bookmark', { action: 'purge', bookKeys: trash.map(function (b) { return b.bookKey }) }).then(function () { setConfirmPurge(false); load() }) } }, '确认清空'),
                      h('button', { style: C.btn, onClick: function () { setConfirmPurge(false) } }, '取消'))
                  : h('button', { style: C.btn, onClick: function () { setConfirmPurge(true) } }, '清空回收站'))
              : null),
          trash.length === 0 ? h('div', { style: C.muted }, '回收站是空的') : trash.map(function (b) {
            return h('div', { key: 'tr' + b.bookKey, style: { ...C.card, opacity: 0.8 } },
              h('div', { style: C.row },
                h('span', { style: C.cardTitle }, b.label),
                h('span', { style: C.muted }, '删除于 ' + String(b.deletedAt).slice(0, 10) + '　还可找回 ' + b.daysLeft + ' 天'),
                h('button', { style: C.btn, onClick: function () { store.act({ action: 'restore', bookKey: b.bookKey }).then(function () { load() }).catch(function () {}) } }, '恢复')))
          })) : null,
        exMsg && !exportOpen ? h('div', { style: C.muted }, String(exMsg).slice(0, 140)) : null,
        store.msg ? h('div', { style: C.muted }, store.msg) : null,
        h('div', { style: { ...C.muted, marginTop: '6px' } }, '书签是你的数据：独立于快照与保留策略；备注与夹不会被自动更新覆盖。'))
    }
    /**
     * 榜单：首屏先给作品 —— 工具栏只留 站/榜/日期/排序 + 「更多」。
     *   · 抓取条数、扫描本榜、补全、历史直查 都收进「更多」（低频、会联网）
     *   · 历史直查**按榜的能力**出现：只有能核对内容日期的榜才有入口
     *   · 状态带一行写清：数据日期 · 源数据日期 · 对比基准（隔几天）· 跨期不可比
     * ★ 2026-10-22（B）：同一天重扫会静默重读，且不重置站/榜/日期/排序/详情。
     */
    function BoardTab(props) {
      const ov = props.ov
      /**
       * ★ 2026-10-23：可用宽度（面板宽减去正文左右 padding 与纵向滚动条）决定两件事 ——
       *   ① 表格装几列（fitColumns，按宽装、超了从最不重要的列丢）；
       *   ② 太窄（<560）就整体换成卡片行，别硬留两列把右半屏空着。
       */
      const avail = Math.max(320, Number(props.width) || (props.narrow ? 520 : 960))
      const cards = avail < 560
      const sites = (ov && ov.sites) || []
      // 收起面板会卸载 BoardTab ⇒ 站/榜选择要持久化；日期/排序按榜各记各的
      const [stSite, setStSite] = React.useState(function () { return sel.get().site })
      const [bt, setBt] = React.useState(function () { return sel.get().board })
      const [sd, setSd] = React.useState(function () { return sel.pref(sel.get().board, 'date') })
      const [ss, setSs] = React.useState(function () { return sel.pref(sel.get().board, 'sort') })
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [pick, setPick] = React.useState(null)
      const [depth, setDepth] = React.useState('')
      const [info, setInfo] = React.useState({ max: 100, can: true, hint: '' })
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [qDate, setQDate] = React.useState('')
      // 读取序号：只有最后一次发起的请求允许写界面（防旧响应覆盖）
      const loadSeqRef = React.useRef(0)
      const catSeqRef = React.useRef(0)
      const curSite = stSite || (sites[0] && sites[0].site)
      const curBoards = ((sites.filter(function (s) { return s.site === curSite })[0] || {}).boards) || []
      const curBoard = bt || (curBoards[0] && curBoards[0].boardId)
      const isDerived = String(curBoard || '').indexOf('fanqie.derived.') === 0
      const colKeys = ((data && data.columns) || []).map(function (c) { return c.key })
      const sortOpts = ((data && data.sortOptions) || [{ value: '', label: '默认' }, { value: 'rank', label: '名次' }])
        .filter(function (o) { return !o.value || o.value === 'rank' || colKeys.indexOf(o.value) >= 0 })
      // 日期下拉只用**这个榜自己**有快照的日期（/board 回的 data.dates）
      const allDates = (data && data.dates && data.dates.length ? data.dates : [])
      const dateOpts = [{ value: '', label: '最新' }].concat(allDates.slice().reverse().map(function (d) { return { value: d, label: d } }))
      React.useEffect(function () {
        const my = ++catSeqRef.current
        jget('/catalog').then(function (c) {
          if (my !== catSeqRef.current) return   // 已经换榜了：这份回答作废
          const v = (c.depths || {})[curBoard]
          const b = (c.boards || []).filter(function (x) { return x.boardId === curBoard })[0] || {}
          setDepth(v != null ? String(v) : (b.depth != null ? String(b.depth) : ''))
          setInfo({ depth: v != null ? v : null, max: b.maxDepth || 100, can: b.canDepth !== false, hint: b.depthHint || '' })
        }).catch(function () {})
      }, [curBoard])
      /**
       * silent=true：同日重扫后的静默重读（保留详情卡与选择）。
       * ★ 2026-10-22（并发）：每次读都领一个序号，回来时序号已经不是最新的就**丢掉** ——
       *   否则快切榜/快改日期时，先发的旧请求后到，会把新榜的数据覆盖掉。
       */
      const reloadBoard = React.useCallback(function (silent) {
        if (!curBoard) return
        const my = ++loadSeqRef.current
        const q = '/board?boardId=' + encodeURIComponent(curBoard) + (sd ? '&date=' + sd : '') + (ss ? '&sort=' + ss : '')
        jget(q).then(function (d) {
          if (my !== loadSeqRef.current) return
          setData(d); setErr(null); if (!silent) setPick(null)
        })
          // 读失败**保留现有列表**，只在上方报错（不能清空界面伪装成「没有条目」）
          .catch(function (e) { if (my !== loadSeqRef.current) return; setErr(String(e)) })
      }, [curBoard, sd, ss])
      React.useEffect(function () { reloadBoard(false) }, [reloadBoard])
      // 同日重扫：修订号变了就静默重读一次（不动站/榜/日期/排序/详情）
      const revRef = React.useRef(null)
      React.useEffect(function () {
        const rev = props.rev || ''
        if (revRef.current === null) { revRef.current = rev; return }
        if (rev !== revRef.current) { revRef.current = rev; reloadBoard(true) }
      }, [props.rev, reloadBoard])
      const selXS = function (label, value, options, onChange) {
        return h('label', { style: C.row }, h('span', { style: C.muted }, label),
          h('select', { value: value, onChange: function (e) { onChange(e.target.value) }, style: C.btn },
            options.map(function (o) { return h('option', { key: o.value, value: o.value }, o.label) })))
      }
      const pickBoard = function (v) { sel.set({ board: v }); setBt(v); setSd(sel.pref(v, 'date')); setSs(sel.pref(v, 'sort')); setPick(null) }
      const pickSite = function (v) { sel.set({ site: v, board: null }); setStSite(v); setBt(null); setSd(''); setSs(''); setPick(null) }
      const pickDate = function (v) { setSd(v); sel.setPref(curBoard, 'date', v) }
      const pickSort = function (v) { setSs(v); sel.setPref(curBoard, 'sort', v) }
      /** 只保存条数（**不采集**）；另有一个明确的「保存并扫描本榜」 */
      const saveDepth = function (alsoScan) {
        const n = Math.max(1, Math.min(info.max || 100, Number(depth) || 10))
        setBusy(true)
        setNote('正在保存每榜取数 ' + n + ' 条…')
        jpost('/depth', { boardId: curBoard, depth: n })
          .then(function (r) {
            setNote((r && r.note) || ('已保存：每榜取 ' + n + ' 条'))
            if (!alsoScan) return null
            setNote('已保存 ' + n + ' 条，正在扫描本榜…')
            return jpost('/scan', { boards: curBoard }).then(function (rr) {
              const got = ((rr && rr.boards) || []).map(function (x) { return x.boardId + ' ' + x.rows + ' 条' }).join('')
              setNote('已保存并扫描：' + (got || '完成'))
              return reloadBoard(true)
            }).catch(function (e2) {
              // ★ 保存成功、采集失败要**分开说**，否则用户会以为设置没存住、反复点
              setNote('条数已保存，但扫描失败：' + e2 + '（可稍后重试扫描）')
            })
          })
          .catch(function (e) { setNote('保存失败：' + e) })
          .then(function () { setBusy(false) })
      }
      const scanBoard = function () {
        setBusy(true)
        setNote('正在扫描本榜…')
        jpost('/scan', { boards: curBoard })
          .then(function (rr) {
            const b0 = ((rr && rr.boards) || [])[0]
            setNote(b0 ? '已扫描：' + b0.boardId + ' ' + b0.rows + ' 条' : '已扫描')
            return reloadBoard(true)
          })
          .catch(function (e) { setNote('扫描失败：' + e) })
          .then(function () { setBusy(false) })
      }
      const doEnrich = function () {
        setBusy(true)
        setNote('补全中（逐本请求 + ' + fmtIntervalText() + '，可能要几十秒）…')
        jpost('/enrich?boardId=' + encodeURIComponent(curBoard)).then(function (r) {
          setNote(r && r.note ? r.note : '补全完成')
          return reloadBoard(true)
        }).catch(function (e) { setNote('补全失败：' + e) }).then(function () { setBusy(false) })
      }
      /**
       * 按日期回看：只在**支持核对的榜**出现（能力驱动）。
       * 首订榜的站点口径是 n-1（上架 24 小时后才结算），所以「上架日」与「数据日期」不是一回事，
       * 这里把两者分开写，不让用户以为选的是同一个日子。
       */
      const queryDay = function (save) {
        if (!qDate) { setNote('先选上架日'); return }
        // ★ 上架日 X ⇒ 数据日期 X+1（首订按 n-1 锚；适配器 contentDateFor(数据日) = 数据日-1）
        const dDate = addDaysStr(qDate, 1)
        if (!dDate) { setNote('日期格式不对：应为 YYYY-MM-DD'); return }
        const my = ++loadSeqRef.current
        setBusy(true)
        setNote((save ? '抓取' : '查看') + '上架日 ' + qDate + '（数据日期 ' + dDate + '）…')
        jpost('/day', { boardId: curBoard, date: dDate, save: !!save }).then(function (r) {
          if (my !== loadSeqRef.current) return null
          if (r && (r.ok === false || r.code)) {
            setNote('已拒绝：' + (r.error || '站点给不出这一天可核对的数据'))
            return null
          }
          const shown = (r && r.date) || dDate
          setNote(r && r.note ? r.note : (save ? '已抓取：上架日 ' + qDate + ' 存为数据日期 ' + dDate + ' 的快照' : '已查看（未落盘）'))
          if (save) { setSd(shown); sel.setPref(curBoard, 'date', shown); return null }
          setSs('')
          setData(function (prev) {
            return {
              ...(prev || {}),
              boardId: curBoard,
              rows: (r.rowsAll || []).map(function (x) { return { ...x, delta: null, days: null } }),
              dataDate: shown,
              dates: (function () {
                const ds = ((prev && prev.dates) || []).slice()
                if (ds.indexOf(shown) < 0) ds.push(shown)
                return ds
              })(),
              note: '直查站点 ' + shown + (r.contentDate && r.contentDate !== shown ? '（站点内容日期 ' + r.contentDate + '）' : ''),
              _queryDate: shown,
            }
          })
        }).catch(function (e) { setNote('直查失败：' + e) }).then(function () { setBusy(false) })
      }
      // Esc：先关详情卡（面板本身由 Panel 那层关）
      useEscLayer(pick ? function () { setPick(null); return true } : null)
      /** 状态带：一行说清「你在看哪份数据、跟哪天比」 */
      const band = (function () {
        if (!data) return null
        const bits = []
        const src = (data.rows && data.rows[0] && data.rows[0].extra && data.rows[0].extra.showDate) || null
        bits.push('数据日期 ' + (data.dataDate || '—'))
        if (src && src !== data.dataDate) bits.push('源数据 ' + src)
        /** Spec S7：首订榜整批换的是「本期上架作品」，不标清会被读成榜单竞争意义的新入榜 */
        if (String(curBoard || '').indexOf('qidiantu.shouding') === 0) {
          bits.push('本期上架作品' + (src ? '（上架日 ' + src + '）' : '') + ' · 首订 = 上架后首订')
        }
        if (data.baselineDate) {
          const g = data.dataDate ? dayGap(data.baselineDate, data.dataDate) : null
          bits.push('对比 ' + data.baselineDate + (g && g > 1 ? '（隔 ' + g + ' 天，变化是累计值）' : ''))
        } else bits.push('无可比基准（不报 0）')
        const crossed = !!(data.rows && data.rows[0] && data.rows[0].extra && data.rows[0].extra.periodChanged)
        if (crossed) bits.push('新期：变化不可比')
        return bits.join(' · ')
      })()
      const enrichMissing = data && data.enrich && data.enrich.missing > 0 ? data.enrich.missing : 0
      // 减掉正文左右 padding（20）、纵向滚动条与一点余量 ⇒ 表格不会溢出成横向滚动
      const cols = fitColumns(data && data.columns, avail - 48)
      const viewDate = (data && (data._queryDate || sd)) || ''
      const menuItems = [
        { label: '扫描本榜（联网）', disabled: busy, onClick: scanBoard, title: '只抓当前这一榜，不动其它榜' },
        { sep: true },
        {
          rows: h('div', null,
            h('div', { style: { ...C.muted, marginBottom: '3px' } }, '每榜取多少条'),
            h('div', { style: C.row },
              h('input', {
                type: 'number', min: 1, max: info.max, value: depth, placeholder: String(info.max), disabled: !info.can,
                title: info.hint, onChange: function (e) { setDepth(e.target.value) },
                style: { width: '58px', fontSize: '12px', padding: '2px 4px' },
              }),
              h('span', { style: C.muted }, info.can ? '条（上限 ' + info.max + '）' : '条 · ' + info.hint),
              h('button', { style: C.btn, disabled: !info.can || busy, onClick: function () { saveDepth(false) }, title: '只保存，下次扫描生效' }, '保存'),
              h('button', { style: C.btn, disabled: !info.can || busy, onClick: function () { saveDepth(true) }, title: '保存后立刻抓一次这一榜（会联网）' }, '保存并扫描本榜'))),
        },
        { sep: true },
        {
          label: enrichMissing ? '补全缺失字段（' + enrichMissing + ' 条）' : '补全缺失字段（当前没有待补）',
          disabled: busy || !enrichMissing,
          onClick: doEnrich,
          title: '只补当前这一榜还没取到的字段（收藏/字数等），可能走书页缓存',
        },
        // 补全没跑完必须可见（别让「有行但字段空」静默）
        enrichMissing ? { rows: h('div', { style: C.muted }, '补全未完成：还缺 ' + enrichMissing + ' 条（补全没跑完或被中断；点上面重试，或等定时续跑）') } : null,
      ]
      if (canDayQuery(curBoard)) {
        menuItems.push({ sep: true })
        menuItems.push({
          rows: h('div', null,
            h('div', { style: { ...C.muted, marginBottom: '3px' } }, '按上架日回看（仅本榜支持核对）'),
            h('div', { style: C.row },
              h('input', { type: 'date', value: qDate, onChange: function (e) { setQDate(e.target.value) }, style: { fontSize: '12px', padding: '2px 4px' } }),
              h('button', { style: C.btn, disabled: busy || !qDate, onClick: function () { queryDay(false) } }, '查看'),
              h('button', { style: C.btn, disabled: busy || !qDate, onClick: function () { queryDay(true) }, title: '抓取该上架日并存为本地快照（已有快照不覆盖）' }, '存入本地')),
            h('div', { style: { ...C.muted, marginTop: '2px' } }, '首订按 n-1 锚：选上架日 X ⇒ 请求数据日期 X+1（页面内容日期就是 X）；保存后快照记在 X+1 名下。站点给的日期对不上会被拒绝，不写任何文件。')),
        })
      }
      /**
       * ★ 2026-10-23（窄面板「作品只显示书名前面的信息，后面一大片空白」）：
       *   以前窄的时候是把次级列**整列删掉**、再让表格 width:100% 铺满 ⇒ 每行只剩名次 + 书名，
       *   右半张桌子全空，被删掉的指标也没有别处可看。窄的时候改成**卡片行**：
       *   第一行 名次 · 书名 · 作者 · 星标；第二行把这一榜要看的指标做成 chip（放不下自动换行）。
       */
      const CHIP_SKIP = { title: 1, rank: 1, author: 1, cat: 1, subCat: 1, updated: 1, days: 1 }
      const chipCols = ((data && data.columns) || []).filter(function (c) { return !CHIP_SKIP[c.key] }).slice(0, 6)
      /** 该行是否正展开详情 */
      const isOpen = function (r) { return !!(pick && pick.key === r.key) }
      /**
       * ★ 2026-10-23（点了没反应）：详情卡原来挂在**整张列表之后** ⇒ 列表一长就在视口外
       *   （实测 820×640 面板：详情卡 top=738、可视区底 731，根本没进画面）。
       *   现在改成「点哪一行，详情就展开在哪一行下面」。
       */
      const detailCard = function (r) {
        const ex = r.extra || {}
        return h('div', { style: { ...C.detail, marginTop: '4px' } },
          h('div', { style: { fontWeight: 600 } }, dash(r.title)),
          h('div', { style: C.muted }, '作者 ' + dash(r.author) + ' · 名次 ' + dash(r.rank) + ' · 字数 ' + fmtWords(ex.wordsText || ex.wordsCnt || ex.wordNumber || ex.words)),
          h('div', { style: C.muted }, '更新 ' + fmtTime(ex.lastChapterUpdateTime)),
          h('div', { style: C.row },
            h(BookmarkStar, { bookKey: bookKeyOf(curBoard, r.key), row: r, boardId: curBoard, dataDate: data && data.dataDate }),
            h(DetailBookmarkEditor, { bookKey: bookKeyOf(curBoard, r.key) }),
            h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); if (props.openLink) props.openLink(r.url); else window.open(r.url, '_blank', 'noopener,noreferrer') } }, '在 DSH 侧栏浏览器打开'),
            h('a', { href: r.url || '#', target: '_blank', rel: 'noreferrer', style: { color: 'inherit', padding: '3px 8px' }, onClick: function (e) { e.stopPropagation() } }, '新标签打开'),
            h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); try { navigator.clipboard.writeText(r.url || '') } catch (err) {} } }, '复制链接'),
            h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); setPick(null) } }, '关闭')),
          ex.qidiantuUrl || ex.sourceUrl
            ? h('div', { style: C.row },
                (ex.qidiantuUrl ? h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(ex.qidiantuUrl) } }, '看起点图原始页') : null),
                (ex.sourceUrl ? h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(ex.sourceUrl) } }, '看原数据来源页') : null),
                h('span', { style: C.muted }, '（数据口径以来源页为准）'))
            : null)
      }
      const rowCellProps = function (r, c) {
        return { ...c, _openLink: props.openLink, _boardId: data.boardId, _dataDate: data.dataDate, _bmKey: bookKeyOf(data.boardId, r.key) }
      }
      const narrowRow = function (r, i) {
        const open = !!(pick && pick.key === r.key)
        const ex = r.extra || {}
        const titleText = (r.title || '') + (ex.titleSuspect || ex.titleTruncated ? ' ⚠' : '')
        const chips = chipCols.map(function (c) {
          const v = cell(rowCellProps(r, c), r)
          if (v === '—' || v === null || v === undefined || v === '') return null
          return h('span', { key: 'c' + c.key, style: C.chip, title: c.note || c.label },
            h('span', { style: { opacity: 0.62 } }, c.label), ' ', v)
        }).filter(Boolean)
        return h('div', {
          key: r.key || ('row' + i),
          tabIndex: 0,
          style: { ...C.card, padding: '5px 8px', margin: '5px 0', cursor: 'pointer',
            borderColor: open ? 'rgba(128,128,128,.62)' : undefined,
            background: open ? 'rgba(128,128,128,.10)' : undefined },
          onClick: function () { setPick(open ? null : r) },
          onKeyDown: function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPick(open ? null : r) } },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 } },
            h('span', { style: { ...C.num, ...C.muted, flex: '0 0 auto', minWidth: '16px', textAlign: 'right' } }, dash(r.rank)),
            h('a', {
              href: r.url || '#', title: '在 DSH 侧栏浏览器打开',
              style: { color: 'inherit', fontWeight: 600, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              onClick: function (e) { e.preventDefault(); e.stopPropagation(); (props.openLink || function (u) { window.open(u, '_blank', 'noopener,noreferrer') })(r.url) },
            }, titleText),
            r.author ? h('span', { style: { ...C.muted, flex: '0 0 auto', maxWidth: '92px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: r.author }, r.author) : null,
            h(BookmarkStar, { bookKey: bookKeyOf(data.boardId, r.key), row: r, boardId: data.boardId, dataDate: data.dataDate })),
          chips.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' } }, chips) : null)
      }
      return h('div', null,
        h('div', { style: C.row },
          selXS('站', curSite || '', sites.map(function (s) { return { value: s.site, label: s.siteName } }), pickSite),
          selXS('榜', curBoard || '', curBoards.map(function (b) { return { value: b.boardId, label: b.name } }), pickBoard),
          isDerived ? null : selXS('日期', sd, dateOpts, pickDate),
          selXS('排序', ss, sortOpts, pickSort),
          h(PopMenu, { label: '更多', items: menuItems, width: 260, title: '采集与详情（低频操作）' })),
        band ? h('div', { style: { ...C.muted, marginTop: '2px' } }, band) : null,
        /* Spec 4.2：补全缺多少条要**就近可见**，别只藏在「更多」菜单里 */
        enrichMissing ? h('div', { style: { ...C.row, marginTop: '2px' } },
          h('span', { style: { color: '#d9a441' } }, '补全未完成：还缺 ' + enrichMissing + ' 条字段'),
          h('button', { style: C.btn, disabled: busy, onClick: doEnrich }, '补全'),
          h('span', { style: C.muted }, '（榜页没给收藏/字数，要进书页取；1 秒/本）')) : null,
        viewDate ? h('div', { style: { ...C.row, alignItems: 'center', gap: '6px', padding: '4px 6px', marginTop: '2px', background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.45)', borderRadius: '4px' } },
          h('span', { style: { fontWeight: 600 } }, '正在查看历史：' + viewDate),
          h('span', { style: C.muted }, data && data._queryDate ? '（直查站点，未落盘）' : '（本地快照）'),
          h('button', { style: C.btn, onClick: function () { setSs(''); setData(null); pickDate(''); } }, '回到最新')) : null,
        data && data.fallbackFrom ? h('div', { style: C.muted }, '当天（' + data.requestedDate + '）没有快照 ⇒ 回落到 ' + data.fallbackFrom) : null,
        data && data.source ? h('div', { style: C.muted }, '来源：' + data.source) : null,
        err ? h('div', { style: { ...C.row, color: '#d9534f' } },
          h('span', null, '⚠ 读取失败：' + String(err).slice(0, 120)),
          h('button', { style: C.btn, onClick: function () { reloadBoard(false) } }, '重试')) : null,
        note ? h('div', { style: C.muted }, note) : null,
        data && data.rows && data.rows.length
          ? (cards
              ? h('div', null, data.rows.map(function (r, i) {
                  // 卡片行 + 展开时紧跟其后的详情卡（详情别再挂到列表末尾）
                  return h('div', { key: 'w' + (r.key || i) }, narrowRow(r, i), isOpen(r) ? detailCard(r) : null)
                }))
              : h('table', { style: C.table },
              h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { key: c.key, style: C.th, title: c.note || '' }, c.label) }))),
              h('tbody', null, data.rows.flatMap(function (r, i) {
                const tr = h('tr', {
                  key: r.key || i,
                  tabIndex: 0,
                  style: { cursor: 'pointer' },
                  onClick: function () { setPick(isOpen(r) ? null : r) },
                  onKeyDown: function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPick(isOpen(r) ? null : r) } },
                }, cols.map(function (c) {
                  return h('td', { key: c.key, style: isNumCol(c.key) ? { ...C.td, ...C.num } : C.td }, cell(rowCellProps(r, c), r))
                }))
                // 详情卡作为紧跟那一行的一行（colSpan 占满），点哪一行就在哪一行下面展开
                return isOpen(r)
                  ? [tr, h('tr', { key: 'd' + (r.key || i) }, h('td', { colSpan: Math.max(1, cols.length), style: { padding: '0 0 4px' } }, detailCard(r)))]
                  : [tr]
              }))))
          : h('div', { style: C.muted }, data ? dash(data.note || '没有条目') : '加载中…'),
        h('div', { style: { ...C.muted, marginTop: '6px' } }, '列随榜变化：该站没有的字段整列不出现；有字段但这条没抓到显示「—」。面板变窄时列会按宽度自动收起（先收作者/分类/字数这类次级列，名次/变化/书名与该榜主指标一直在），再窄就换成卡片行；点行看详情。'))
    }

    /**
     * 面板开/关的共享状态：左栏入口按钮 与 浮窗 共用。
     * ★ 挂在模块级 SHARED 上（2026-10-15）：本会话观察到 loader 可能把 factory 跑两遍，
     *   若 store 建在 apply 里，入口和浮窗会拿到**两个不同的 store** ⇒ 点入口面板不开（订阅不在同一份上）。
     *   放模块级 + window 锚 ⇒ 无论几个实例都共用一份。
     */
    const panelOpen = SHARED.panelOpen || (SHARED.panelOpen = {
      value: readPanelOpen(),
      subs: new Set(),
      set: function (v) {
        this.value = v
        try { localStorage.setItem(LS_OPEN, v ? '1' : '0') } catch (e) {}
        this.subs.forEach(function (f) { try { f(v) } catch (e) {} })
      },
      use: function () {
        const [o, setO] = React.useState(panelOpen.value)
        React.useEffect(function () {
          const f = function (v) { setO(v) }
          panelOpen.subs.add(f)
          return function () { panelOpen.subs.delete(f) }
        }, [])
        return [o, function (v) { panelOpen.set(v) }]
      },
    })

    /**
     * 左栏入口 occupant（sidebar.panellist 槽）。
     * ★ 宿主契约（@deepseek-ai/dsh-client-ui-sidebar 的 PanelRow）：
     *     <button aria-label={label} onClick={selectPanel(id)}>{ renderSlot('sidebar.panellist', { size, active }, { only: id }) }</button>
     *   所以 occupant 必须是**只吃 size 的纯图标**：
     *     · 自己再渲染 <button> = 按钮套按钮，内层点击还会冒泡再触发一次 selectPanel；
     *     · 把整块 UI（页签/说明/计数）塞进图标位会把侧栏撑破；
     *     · 无障碍名由注册项的 label 提供（宿主做 aria-label + tooltip），不是内部 id。
     *   开关浮窗的入口在下方的「薄 main 面板」里（Q29）。
     */
    function SidebarEntryIcon(props) {
      const size = Number(props && props.size) || 16
      const active = !!(props && props.active)
      /**
       * ★ 2026-10-16（使用者反馈「我点开就跳到扫榜面板、会话被顶掉」）：
       *   点这个图标要**就地弹出浮窗**，而不是把主区域切到薄 main 面板。做法：
       *     · 外层用 <div> 承接点击（不再嵌 <button>，避免按钮套按钮）；
       *     · onClick 里 stopPropagation() ⇒ 挡掉宿主 PanelRow 那个 selectPanel(id)，会话视图不被顶走；
       *     · 浮窗由 panelOpen 打开 ⇒ 一次点击就出窗。薄 main 面板照旧注册（键盘/无障碍路径仍有落点）。
       */
      // ★ 2026-10-16 定稿（使用者两轮反馈后）：**纯图标**（文字由宿主那行自己的 label 提供），
      //   点击时四种事件全部吃掉 ⇒ 就地弹浮窗、不切主区域。
      // ★ 2026-10-16 定稿（使用者：「为什么要两个按钮，统一一个不就行了」）：整行只保留宿主的
      //   那个 <button>。图标这里降级为**纯展示节点**（不挂任何点击处理器），点击接管只有一处：
      //   下面这个 effect 在「标记节点所在根节点」的捕获阶段注册一次 —— 图标/文字/行内空白行为一致。
      React.useEffect(function () {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined
        const mark = document.querySelector('[data-rank-scan-entry]')
        const root = (mark && mark.getRootNode && mark.getRootNode()) || document
        if (!root.addEventListener || root.__rankScanRowHooked) return undefined
        root.__rankScanRowHooked = true
        const onRowActivate = function (e) {
          try {
            const t = e.target
            const btn = t && t.closest ? t.closest('button, [role="button"]') : null
            const node = document.querySelector('[data-rank-scan-entry]')
            if (!btn || !node || !btn.contains(node)) return
            if (e.stopPropagation) e.stopPropagation()
            if (e.preventDefault) e.preventDefault()
            panelOpen.set(true)
          } catch (err) { /* 宿主 DOM 变了也不该把插件带崩 */ }
        }
        root.addEventListener('click', onRowActivate, true)
        root.addEventListener('pointerdown', onRowActivate, true)
        return undefined
      }, [])
      return h('div', {
        title: '打开扫榜浮窗',
        // 行标记：捕获阶段靠它认出「这一行是我们的」（只此一处接管）
        'data-rank-scan-entry': '1',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', lineHeight: 1, fontSize: '12px', opacity: active ? 1 : 0.92, whiteSpace: 'nowrap' },
      },
        h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          style: { display: 'block' },
          'aria-hidden': 'true', focusable: 'false',
        },
          // 三条由长到短的横杠 + 一个对勾：一眼认出是「榜单」，不是别的面板
          h('path', { d: 'M2 3.5h12M2 8h9M2 12.5h6' }),
          h('path', { d: 'M12.2 9.4l1.6 1.6 2-2.6' })))
      // ★ 2026-10-16：这里原来还挂了一个「扫榜」文字 span，结果左边我们一个「扫榜」、右边宿主的
      //   label「扫榜面板」，重复啰嗦。改为**纯图标**：文字由宿主那行自己的 label 提供。
    }

    function Panel(props) {
      const [open, setOpen] = panelOpen.use()
      // 收起面板会卸载 Panel ⇒ 用持久化的 tab（否则每次打开都跳回「概览」）
      const [tab, setTab] = React.useState(function () { return sel.get().tab || 'ov' })
      const LEAVE_LABEL = { bm: '书签备注', settings: '设置草稿' }
      const switchTab = function (t) {
        if (t === tab) return
        // 有没保存的东西：先拦一下（草稿不会丢，回来还在）
        if (dirtyGuard.any()) { setLeaveAsk({ tab: t, keys: dirtyGuard.list() }); return }
        sel.set({ tab: t }); setTab(t)
      }
      const doLeave = function () {
        const ask = leaveAsk
        setLeaveAsk(null)
        if (!ask) return
        if (ask.tab) { sel.set({ tab: ask.tab }); setTab(ask.tab) } else setOpen(false)
      }
      const [ov, setOv] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [rect, setRect] = useRect()

      /** 有未保存草稿时切页/收起先问一句（草稿留在 DRAFTS，回来还在） */
      const [leaveAsk, setLeaveAsk] = React.useState(null)
      const [, bumpDirty] = React.useState(0)
      React.useEffect(function () {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined
        const onDirty = function () { bumpDirty(function (x) { return x + 1 }) }
        window.addEventListener('rank-scan:dirty', onDirty)
        return function () { window.removeEventListener('rank-scan:dirty', onDirty) }
      }, [])
      const reload = React.useCallback(function () { jget('/overview').then(setOv).catch(function (e) { setMsg(String(e)) }) }, [])
      React.useEffect(function () { reload() }, [reload])
      // 轻量轮询：每 20s 静默刷新（不改变面板尺寸/位置，避免闪烁）
      // ★ 2026-10-16（票 27）：收起后必须彻底停 —— 旧写法把 `if (!open) return null` 放在 hooks 之后，
      //   面板收起时这个 interval 仍在跑（每 20s 打一次 /overview）。现在：收起即清，重新展开立即拉一次；
      //   页面隐藏（切到别的标签页）时跳过，恢复可见时补一次。
      const polledOnce = React.useRef(false)
      React.useEffect(function () {
        if (!open) return undefined
        if (polledOnce.current) reload()
        else polledOnce.current = true
        const t = setInterval(function () {
          if (!busy && document.visibilityState !== 'hidden') reload()
        }, 20000)
        const onVis = function () { if (document.visibilityState === 'visible') reload() }
        document.addEventListener('visibilitychange', onVis)
        return function () { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
      }, [reload, busy, open])
      /**
       * 跳到某个榜（概览的「查看本榜」与变化行都走这里）：写进 sel 再切页，
       * BoardTab 挂载时按 sel 初始化 ⇒ 站/榜/日期/排序/详情都保留（Spec S6「保上下文」）。
       */
      const openBoard = function (boardId) {
        const id = String(boardId || '')
        if (!id) return
        sel.set({ site: id.split('.')[0], board: id })
        switchTab('board')
      }
      /** path + 可选 JSON body（概览「重扫本榜」要传 {boards}，以前 act 吞掉了 body） */
      const act = function (path, body) {
        setBusy(true)
        jpost(path, body).then(function (r) { setMsg(r && r.note ? r.note : '完成：' + (r.outcome || 'ok')); return reload() })
          .catch(function (e) { setMsg(String(e)) })
          .then(function () { setBusy(false) })
      }
      // Esc：没有菜单/详情打开时收起面板；编辑中不收起（全局处理器已挡）
      // Esc 的最后一层：没有菜单/详情打开时收起面板（编辑中由全局处理器挡住）
      const closePanelLayer = React.useCallback(function () {
        if (dirtyGuard.any()) { setLeaveAsk({ tab: null, keys: dirtyGuard.list() }); return true }
        setOpen(false)
        return true
      }, [setOpen])
      useEscLayer(open ? closePanelLayer : null)
      // 收起后：按钮同样可拖动、同样记住位置（用同一份 rect，不再回右上角）
      if (!open) return null
      const narrow = rect.w < 720
      const rev = revOf(ov)
      return h('div', { 'data-rank-scan-win': '1', style: { ...C.win, left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px', fontSize: '13px' } },
        h(DragBar, {
          rect: rect, setRect: setRect,
          onCollapse: function () {
            if (dirtyGuard.any()) { setLeaveAsk({ tab: null, keys: dirtyGuard.list() }); return }
            setOpen(false)
          },
        }),
        h('div', { style: C.body },
          h('div', { style: C.tabs },
            h('button', { style: C.tab(tab === 'ov'), onClick: function () { switchTab('ov') } }, '概览'),
            h('button', { style: C.tab(tab === 'board'), onClick: function () { switchTab('board') } }, '榜单'),
            h('button', { style: C.tab(tab === 'bm'), onClick: function () { switchTab('bm') } }, '书签'),
            h('button', { style: C.tab(tab === 'pick'), onClick: function () { switchTab('pick') } }, '设置')),
          msg ? h('div', { style: C.muted }, msg) : null,
          leaveAsk ? h('div', { style: { ...C.row, margin: '4px 0', padding: '5px 7px', borderRadius: '6px', border: '1px solid rgba(217,164,65,.55)', background: 'rgba(217,164,65,.12)' } },
            h('span', null, '有未保存的改动（' + (leaveAsk.keys || []).map(function (k) { return LEAVE_LABEL[k] || k }).join('、') + '）'),
            h('span', { style: C.muted }, '草稿会保留，下次进来还在'),
            h('button', { style: C.btnOn, onClick: doLeave }, '仍然离开'),
            h('button', { style: C.btn, onClick: function () { setLeaveAsk(null) } }, '继续编辑')) : null,
          h(TabBoundary, { name: tab },
            tab === 'ov' ? h(Overview, {
              ov: ov, busy: busy, act: act, reload: reload, narrow: narrow, width: rect.w, rev: rev,
              onOpenBoard: openBoard,
              onRescanBoard: function (boardId) { act('/scan', { boards: String(boardId) }) },
            })
              : tab === 'board' ? h(BoardTab, { ov: ov, openLink: props.openLink, narrow: narrow, width: rect.w, rev: rev })
              : tab === 'bm' ? h(BookmarksTab, { openLink: props.openLink })
              : h(SettingsTab, { ov: ov, onSaved: reload }))),
        h(ResizeHandle, { rect: rect, setRect: setRect }))
    }

    /** 打开作品页：
     * 首选 DSH **侧栏内嵌浏览器**（@deepseek-ai/dsh-client-ui-sidebar-browser 注册的 kind='browser'）
     * —— 该服务是可选依赖，用 ctx.inject(['sidebarRight']) 晚绑定；拿不到就退回新标签。 */
    /** 侧栏浏览器服务（可选依赖，晚绑定捕获后复用） */
    let sidebarSvc = null
    /**
     * 打开链接。★ 兼容两种调用方式（2026-10-15 修）：
     *   ① openLink(ctx, url) —— 早先的写法；
     *   ② openLink(url)      —— 行内「书名」与详情卡按钮都是这么调的。
     * 之前只认 ①，行内/详情卡传进来的是 (url) ⇒ url 形参恒 undefined ⇒ **静默 return，什么也不发生**，
     * 于是「看起点图原始页」点了没反应（使用方 2026-10-15 反馈的就是这个）。
     */
    function openLink(ctx, url) {
      if (typeof ctx === 'string' && url === undefined) { url = ctx; ctx = null }
      if (!url) return
      const c = ctx || {}
      try {
        const sr = sidebarSvc || c.sidebarRight
        if (sr && typeof sr.openTab === 'function') {
          sr.openTab('browser', { params: { url }, revealIfOpened: true })
          if (c.logger?.info) c.logger.info('[dsh-rank-scan] 已在侧栏浏览器打开：' + url)
          return
        }
        if (c.logger?.warn) c.logger.warn('[dsh-rank-scan] 侧栏浏览器服务不可见（ctx.sidebarRight 缺失），退回新标签')
      } catch (e) {}
      try { window.open(url, '_blank', 'noopener,noreferrer') } catch (e) {}
    }

    /** 自检：侧栏浏览器服务是否可见（改面板时用来确认在 DSH 里打开作品页这条路通不通） */
    function diagLink(ctx) {
      const sr = ctx && ctx.sidebarRight
      return {
        hasSidebarRight: !!sr,
        hasOpenTab: !!(sr && typeof sr.openTab === 'function'),
        hasOpenTabIn: !!(sr && typeof sr.openTabIn === 'function'),
        hasTabs: !!(ctx && ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === 'function'),
      }
    }
    /**
     * ★ 2026-10-16 审计（加载期死码）：这里原来在**模块求值期**跑 diagLink(ctx) 并往 DOM 里塞一个
     *   自检标记节点，而 `ctx` 只作为 apply(ctx) 的形参存在 ⇒ 每次加载都抛 ReferenceError，
     *   又被紧跟的空 catch 吞掉：标记永远不出现（自检形同虚设），还在加载路径上白留一个 try/catch，
     *   并把「模块求值期碰了宿主作用域」这类缺陷藏起来。要查侧栏浏览器可见性，看 apply 里捕获的
     *   sidebarSvc / window.__rankScanLinkSvc 即可（diagLink 保留，供 apply 内按需调用）。
     */

    const inject = ['slots']
    function apply(ctx) {
      // ★ 首次安装自动弹一次：认领点从「模块求值期」移到这里（apply 真的跑到了才算数）
      if (claimAutoOpen()) panelOpen.set(true)
      // 可选依赖晚绑定：侧栏浏览器服务可用后捕获（不在 inject 列表里，避免服务缺失时整个面板挂不上）
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sidebarRight'], function (scope) {
            sidebarSvc = (scope && scope.sidebarRight) || (scope && scope.reflect && typeof scope.reflect.get === 'function' ? scope.reflect.get('sidebarRight') : null) || null
            if (sidebarSvc) window.__rankScanLinkSvc = true
          })
        } catch (e) {}
      }
      // 自检：此刻 ctx 是真的，记下侧栏浏览器服务可见性（排查「打开作品页退化到新标签」用）
      try { window.__rankScanLinkDiag = diagLink(ctx) } catch (e) {}
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: PANEL_ID, order: 900 }, function RankScanPanel() { return h(Panel, { openLink: function (u) { openLink(ctx, u) } }) })
      })
      /**
       * ★ 2026-10-16 使用者口径 B：**这里不再注册 main 面板**。审计时我按「宿主 selectPanel 对未注册
       *   main id 会抛」的顾虑加了那个中间页，但事实是：审计前一直直接弹浮窗、用得好好的。
       *   现在恢复原状：点入口只弹浮窗，不产生任何可切换的页面。
       *   （保留原注释备查）
       * ★ 旧口径（Q29 / 审计-2 2026-10-16）：
       *   宿主 PanelRow 点击时调 layout.selectPanel(id)，而 layout.selectPanel 对**没有注册的 main 面板
       *   id** 是直接抛异常的（`main panel "x" is not registered`）。所以入口 id 必须与 main 槽的 key 一致。
       *   这里只放「一行说明 + 打开浮窗」：浮窗的拖动/缩放/位置记忆全部保留，不迁进主面板。
       */
      // 入口放 DSH **左侧栏会话列表下方**（使用方 2026-10-15 口径：收起按钮不要浮在对话上）
      // id 与 main 面板一致（PANEL_ID）⇒ 宿主那一行的 selectPanel(id) 不会抛；label 给宿主做 aria-label。
      try {
        const reg = function (slot) {
          try {
            ctx.slots.inject(slot, function () {
              // ★ 2026-10-16（使用者反馈「点『扫榜面板』文字本身没反应」）：宿主把 label 文字画在同一行的
          //   那个 <button> 里，点文字走的是宿主的 selectPanel(入口 id)；而我们的入口 id 没有对应
          //   main 面板 ⇒ 什么都不会发生。这里在 document 的**捕获阶段**接管：只要点击（或指针按下）
          //   落在「含我们入口标记的那个 button」内，就就地弹浮窗并阻断宿主处理 —— 图标与文字整行一致。
          return ctx.slots.register({ name: slot, id: ENTRY_ID, order: 900, label: '扫榜面板' }, SidebarEntryIcon)
            })
            return true
          } catch (e) { console.warn('[dsh-rank-scan] 入口槽位注册失败：' + slot, e); return false }
        }
        window.__rankScanEntry = reg('sidebar.panellist') ? 'sidebar.panellist' : reg('sidebar.footer.action') ? 'sidebar.footer.action' : null
      } catch (e) { console.warn('[dsh-rank-scan] 入口注册失败：', e) }
    }
    /**
   * 书签卡片的「站方指标」chip 文案（纯函数，便于单测）。null ⇒ 不渲染。
   * 规则（2026-10-16 使用反馈）：
   *   ① 没有数值就不渲染 —— 名次型榜（起点/刺猬猫/菠萝包）的 row.value 恒为 null，
   *      以前会画成「名次 —」这种只有标签没有内容的空 chip；
   *   ② 与 collect chip 同源同值时不重复渲染 —— 番茄的 metric 与 collect 都是 row.value（在读）。
   */
  function metricChipText(metric, collect, collectLabel) {
    if (!metric || metric.value == null) return null
    if (collect != null && metric.value === collect) return null
    /**
     * ★ 2026-10-17：同口径（例如番茄的 metric 与 collect 都是「在读」）不再另画一个同名 chip ——
     *   上层会把它渲染成「书签记录 X」并说明不是同一时点；否则就是两个「在读」并排，看着像 bug。
     */
    if (collectLabel && metric.name === collectLabel) return null
    return metric.name + ' ' + metric.value
  }
  // 测试缝：宿主只消费 name/inject/apply，多挂一个纯展示函数对运行无影响
  // 测试缝：宿主只消费 name/inject/apply；多挂纯函数与组件给离线测试用（对运行无影响）
  return { name: 'dsh-rank-scan', inject: inject, apply: apply, __test: {
    metricChipText: metricChipText,
    helpers: { revOf: revOf, statusText: statusText, scanLabel: scanLabel, canDayQuery: canDayQuery, fitColumns: fitColumns, colPrio: colPrio, mdOf: mdOf, boardLabel: boardLabel, rememberBoardNames: rememberBoardNames },
    components: { Overview: Overview, BoardTab: BoardTab, BookmarksTab: BookmarksTab, SettingsTab: SettingsTab, PopMenu: PopMenu, Panel: Panel },
  } }
  },
})
