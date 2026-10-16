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
    const jget = (p) => fetch(API + p, { headers: { Accept: 'application/json' } }).then((r) => r.json())
    // ⚠️ 之前这里**丢掉了 body**（调用方写的 {captures:…} 全被忽略）⇒ 面板里所有「保存」实际都没带参数：
    //    抓取集保存不动、每榜深度存不进去。现在统一带 JSON body。
    const jpost = (p, body) => fetch(API + p, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json())

    const LS_POS = 'rank-scan-panel:rect:v1'
    // 面板开关的本地记忆：v1 = 用户最后一次的开/关；auto = 「首次安装已自动弹过」
    // 需求（2026-10-15 使用方口径）：安装成功后第一次打开 DSH 自动弹一次，之后用户关掉就不再自动弹。
    const LS_SEL = 'rank-scan-panel:sel:v1'
/** 面板 UI 选择（tab + 站 + 榜）：模块级共享，收起面板/刷新页面都回到原界面 */
const sel = (function () {
  let s = { tab: 'ov', site: null, board: null }
  try {
    const raw = localStorage.getItem(LS_SEL)
    if (raw) { const o = JSON.parse(raw); s = { tab: o.tab || 'ov', site: o.site || null, board: o.board || null } }
  } catch (e) {}
  return {
    get: function () { return s },
    set: function (patch) {
      s = { ...s, ...patch }
      try { localStorage.setItem(LS_SEL, JSON.stringify(s)) } catch (e) {}
    },
  }
})()
// 模块级单例锚：即使 loader 把 factory 跑两遍（本会话确实见到重复入口），两个实例也共用同一份状态
const SHARED = (window.__rankScanShared = window.__rankScanShared || {})
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
      th: { textAlign: 'left', padding: '2px 5px', borderBottom: '1px solid rgba(128,128,128,.3)', whiteSpace: 'nowrap', fontWeight: 600 },
      td: { padding: '2px 5px', borderBottom: '1px solid rgba(128,128,128,.1)', verticalAlign: 'top' },
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
    const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v)
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
      const w = Math.min(Math.max(420, num(r.w, 660)), Math.max(420, vw - 16))
      const h = Math.min(Math.max(240, num(r.h, 480)), Math.max(240, vh - 16))
      const x = Math.min(Math.max(0, num(r.x, Math.max(8, vw - 700))), Math.max(0, vw - 80))
      const y = Math.min(Math.max(0, num(r.y, 64)), Math.max(0, vh - 48))
      return { x: x, y: y, w: w, h: h }
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
        if (e.target && e.target.closest && e.target.closest('button')) return
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
        h('button', { style: C.btn, onClick: props.onCollapse }, '收起'))
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

    /** 概览：单行汇总 + 站点一行一表；异常榜折叠；今天的变化 */
    function Overview(props) {
      const ov = props.ov
      const chgS = React.useState(null)
      const setChg = chgS[1]
      const badS = React.useState(false)
      const showBad = badS[0]
      const setShowBad = badS[1]
      // ★ 2026-10-16：保留策略设置的回执（面板以前只能显示「保留 N 天」，改不了）
      const retS = React.useState(null)
      const retMsg = retS[0]
      const setRetMsg = retS[1]
      React.useEffect(function () { if (ov && ov.dataDate) jget('/changes').then(setChg).catch(function () { setChg(null) }) }, [ov && ov.dataDate])
      if (!ov) return h('div', { style: C.muted }, '加载中…')
      const c = ov.counts || {}
      const total = (c.ok || 0) + (c.missing || 0) + (c.stale || 0) + (c.login_required || 0) + (c.truncated || 0)
      const bad = (c.missing || 0) + (c.stale || 0) + (c.login_required || 0) + (c.truncated || 0)
      const rows = (ov.sites || []).flatMap((s) => s.boards.map((b) => ({ ...b, siteName: s.siteName })))
      const badRows = rows.filter((b) => b.status !== 'ok')
      const scan = ov.scan || null
      return h('div', null,
        // 一行汇总（不再堆 ok/ok/ok）
        h('div', { style: C.row },
          h('span', null, '数据日期 ' + dash(ov.dataDate)),
          h('span', { style: C.muted }, '·'),
          h('span', null, '基期 ' + dash(ov.baselineDate)),
          h('span', { style: C.muted }, '·'),
          h('span', null, total + ' 个榜'),
          h('span', null, bad === 0 ? '全部正常' : '异常 ' + bad + ' / 正常 ' + (c.ok || 0)),
          h('span', { style: C.muted }, '隐藏 ' + (ov.hiddenCount || 0) + ' 个'),
          scan ? h('span', { style: C.muted }, '上次 ' + scan.outcome + (scan.trigger ? '/' + scan.trigger : '')) : null),
        h('div', { style: C.row },
          h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.act('/scan') } }, props.busy ? '扫描中…' : '立刻扫一次'),
          h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.act('/cancel') } }, '停止本次'),
          h('button', { style: C.btn, disabled: props.busy, onClick: function () { props.act('/retry') } }, '重试失败的榜'),
          h('button', { style: C.btn, onClick: props.reload }, '刷新')),
        // 数据目录占用（ticket 22）：快照与 state/ 分开显示 —— retentionDays 只影响前者
        ov.storage ? h('div', { style: { ...C.row, marginTop: '2px', padding: '4px 7px', border: '1px solid rgba(128,128,128,.25)', borderRadius: '6px', background: 'rgba(128,128,128,.05)' } },
          h('span', { style: C.muted }, '数据目录 ' + fmtBytes(ov.storage.totalBytes)),
          h('span', { style: C.muted }, '·'),
          h('span', null, '快照 ' + fmtBytes(ov.storage.snapshotBytes)),
          h('span', { style: C.muted }, '·'),
          h('span', null, 'state ' + fmtBytes(ov.storage.stateBytes)),
          h('span', { style: C.muted }, '（书签/配置/缓存，不受保留策略影响）'),
          h('span', { style: C.muted }, '·'),
          h('span', null, ov.storage.dates + ' 天（' + dash(ov.storage.oldest) + ' 起）'),
          h('span', { style: C.muted }, '·'),
          h('span', { style: C.muted }, '保留'),
          h('select', {
            style: { ...C.input, width: 'auto', padding: '1px 4px' },
            value: String(ov.storage.retentionDays),
            title: '只影响数据日期目录（快照/报告）；state/ 里的配置、书签、书页缓存永不删',
            onChange: function (e) {
              const v = e.target.value === 'forever' ? 'forever' : Number(e.target.value)
              props.post('/retention', { days: v })
                .then(function (r) { setRetMsg(r && r.note ? r.note : '已更新'); return props.reload() })
                .catch(function (e2) { setRetMsg('设置失败：' + e2) })
            },
          },
            [30, 90, 180, 365].map(function (n) { return h('option', { key: n, value: String(n) }, n + ' 天') }),
            h('option', { key: 'forever', value: 'forever' }, '永久保留')),
          retMsg ? h('span', { style: { color: '#2e7d32' } }, String(retMsg).slice(0, 60)) : null,
          h('span', { style: C.muted }, '·'),
          h('span', null, '书签 ' + ov.storage.bookmarks + ' 条')) : null,
        // ★ 票 26：诊断栏 —— 服务可见性 / 定时接线 / 占用缓存时间。缺能力时这里一眼能看出来，
        //   而不是「面板打不开、什么都不知道」（配合票 21 的 README 一节）。
        (function () {
          const sv = ov.services || {}
          const miss = []
          if (!sv.webServer) miss.push('webServer（/api/rank-scan/* 未注册）')
          if (!sv.timerService) miss.push('timer（定时扫描不可用）')
          return h('div', { style: { ...C.row, marginTop: '2px', padding: '4px 7px', border: '1px solid rgba(128,128,128,.25)', borderRadius: '6px', background: 'rgba(128,128,128,.05)' } },
            h('span', { style: C.muted }, '诊断'),
            h('span', { style: C.muted }, '·'),
            h('span', null, sv.webServer ? '接口 ✓' : '接口 ✗'),
            h('span', { style: C.muted }, '·'),
            h('span', null, sv.timerService ? (sv.timerArmed ? '定时已接线' : '定时未接线') : '定时服务 ✗'),
            h('span', { style: C.muted }, '·'),
            h('span', null, '占用缓存 ' + (ov.storage && ov.storage.cachedAt ? new Date(ov.storage.cachedAt).toLocaleTimeString() : '—')),
            miss.length ? h('span', { style: { color: '#d9534f' } }, '⚠ 缺失：' + miss.join('、')) : null)
        })(),
        bad > 0 ? h('div', { style: C.row },
          h('span', { style: C.dot('bad') }),
          h('button', { style: C.btn, onClick: function () { setShowBad(!showBad) } }, (showBad ? '收起' : '展开') + '异常 ' + bad + ' 个榜')) : null,
        showBad ? h('table', { style: C.table },
          h('thead', null, h('tr', null, ['站', '榜', '状态', '备注'].map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
          h('tbody', null, badRows.map(function (b) {
            return h('tr', { key: b.boardId },
              h('td', { style: C.td }, b.siteName),
              h('td', { style: C.td }, b.name),
              h('td', { style: C.td }, b.status),
              h('td', { style: C.td }, dash(b.note)))
          }))) : null,
        h('table', { style: C.table },
          h('thead', null, h('tr', null, ['榜（按站）', '涨 / 新 / 退', '上次抓取', '备注'].map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
          h('tbody', null, (ov.sites || []).flatMap(function (s) {
            const okN = s.boards.filter(function (b) { return b.status === 'ok' }).length
            const head = h('tr', { key: 'h-' + s.site },
              h('td', { style: { ...C.td, paddingTop: '7px', fontWeight: 600 }, colSpan: 3 },
                h('span', { style: C.dot(okN === s.boards.length ? 'ok' : 'bad') }),
                ' ' + s.siteName,
                h('span', { style: C.muted }, '  ' + s.boards.length + ' 个榜 · 正常 ' + okN)))
            const rows = s.boards.map(function (b) {
              const noBase = b.up === null && b.newCount === null && b.out === null
              return h('tr', { key: b.boardId },
                h('td', { style: { ...C.td, paddingLeft: '16px' } }, (b.status === 'ok' ? '' : '⚠ ') + b.name + (b.displayed ? '' : ' · 未显示')),
                h('td', { style: C.td }, noBase ? '—' : '涨 ' + dash(b.up) + ' / 新 ' + dash(b.newCount) + ' / 退 ' + dash(b.out)),
                h('td', { style: C.td }, (b.lastCapture ? fmtLocalHM(b.lastCapture) : '') || '—'),
                h('td', { style: C.td }, dash(b.note)))
            })
            return [head].concat(rows)
          }))),
        h('div', { style: C.siteBar }, '今天的变化'),
        chgS[0] && chgS[0].note ? h('div', { style: C.muted }, chgS[0].note) : null,
        chgS[0] && chgS[0].count === 0 ? h('div', { style: C.muted }, '没有变化条目') : null,
        chgS[0] && chgS[0].sites ? chgS[0].sites.map(function (s) {
          return h('div', { key: 'chg-' + s.site },
            h('div', { style: C.siteBar }, s.siteName),
            h('table', { style: C.table },
              h('thead', null, h('tr', null, ['分组', '榜', '书名', '变化'].map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
              h('tbody', null, s.groups.flatMap(function (g) {
                return g.items.map(function (it, i) {
                  return h('tr', { key: g.group + i },
                    h('td', { style: C.td }, i === 0 ? g.group : ''),
                    h('td', { style: C.td }, it.boardName),
                    h('td', { style: C.td }, it.title, ' ', h(BookmarkStar, { bookKey: bookKeyOf(it.boardId, it.title), boardId: it.boardId, row: null, title: it.title })),
                    h('td', { style: C.td }, dash(it.delta)))
                })
              }))))
        }) : null)
    }

    /** 抓什么：站 → 榜种 → 分类 勾选。**本地先改、点「保存」才落盘**（抓了就显示，不再有单独的显示开关） */
    function CaptureTab(props) {
      const [cat, setCat] = React.useState(null)
      const [picked, setPicked] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)
      const [autoEnrich, setAutoEnrich] = React.useState(true)
      // 起点书页补全（收藏/精确字数）：默认关；缓存规模用来给用户看「要不要真打请求」
      const [qdEnrich, setQdEnrich] = React.useState(false)
      const [qdCache, setQdCache] = React.useState(null)
      // 定时扫描设置（默认关；新安装不自动抓）
      const [tOn, setTOn] = React.useState(false)
      const [tTime, setTTime] = React.useState('01:30')
      const [tNote, setTNote] = React.useState(null)
      const [tLast, setTLast] = React.useState(null)
      // ★ 2026-10-16：按站分时抓取（每站一个时刻 + 一个兜底时刻）
      const [tTimes, setTTimes] = React.useState({})
      const [tFall, setTFall] = React.useState('22:30')
      // 只读的实时调度状态（60s 轮询；**不重载 /catalog**，免得冲掉还没保存的勾选）
      const [planLive, setPlanLive] = React.useState(null)
      const load = React.useCallback(function () {
        jget('/catalog').then(function (c) {
          setCat(c)
          setPicked((c.captures || []).slice())
          setAutoEnrich(c.autoEnrich !== false)
          setQdEnrich(!!(c.qidian && c.qidian.enrich))
          setQdCache(c.qidian || null)
          const t = c.timer || {}
          setTOn(t.enabled === true)
          setTTime(t.scanTime || '01:30')
          setTTimes(t.siteTimes || {})
          setTFall(t.fallbackTime || '22:30')
          setTLast(t)
          setDirty(false)
        }).catch(function (e) { setNote(String(e)) })
      }, [])
      const saveTimer = function (enabled, times, fall) {
        setTNote('保存中…')
        jpost('/timer', { enabled: enabled, siteTimes: times, fallbackTime: fall }).then(function (r) {
          setTNote(r && r.note ? r.note : '已保存')
          return jget('/catalog').then(function (c) { setTLast(c.timer || null) })
        }).catch(function (e) { setTNote(String(e)) })
      }
      React.useEffect(function () { load() }, [load])
      React.useEffect(function () {
        let alive = true
        let id = null
        // ★ 2026-10-16 审计：卸载后不许再排下一轮。旧写法在 catch 分支里无条件 every(180000)，
        //   组件已经卸载、cleanup 也跑过了，它又挂上一个新 interval 永久残留（每 3 分钟打一次接口）。
        const every = function (ms) { if (!alive) return; if (id) clearInterval(id); id = setInterval(tick, ms) }
        const tick = function () {
          jget('/timer-plan').then(function (r) {
            if (!alive) return
            const pl = (r && r.plan) || null
            if (pl) setPlanLive(pl)
            // ★ 2026-10-16（使用方：60s 有必要吗）：定时一天只跑 5 次，60s 轮询 99% 是空转。
            //   常态 3 分钟一次；只有「有站到点待跑」这段才缩到 30s（那时状态才真的在变）。
            const busy = !!(pl && ((pl.due || []).length > 0 || (pl.fallback || []).length > 0))
            every(busy ? 30000 : 180000)
          }).catch(function () { if (alive) every(180000) })
        }
        tick()
        return function () { alive = false; if (id) clearInterval(id) }
      }, [])
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
      const save = function () {
        setBusy(true)
        jpost('/select', { captures: picked, autoEnrich: !!autoEnrich, qidianEnrich: !!qdEnrich }).then(function (r) {
          setNote((r && r.note ? r.note : '已保存：' + picked.length + ' 个榜') + '（面板已同步）')
          setDirty(false)
          if (props.onSaved) props.onSaved()
          try { window.dispatchEvent(new Event('rank-scan:saved')) } catch (e) {}
          return load()
        }).catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) })
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
      return h('div', null,
        h('div', { style: C.muted }, '勾选 = 抓什么（**改了先点保存**，下次扫描生效）。抓到的榜就会显示。'),
        h('div', { style: C.row },
          h('button', { style: dirty ? C.btnOn : C.btn, disabled: busy || !dirty, onClick: save }, dirty ? '保存改动（' + picked.length + ' 个榜）' : '已保存（' + picked.length + ' 个榜）'),
          h('button', { style: C.btn, disabled: busy, onClick: function () { setPicked(['qidian.sign.cat12']); setDirty(true) } }, '恢复默认日常抓取'),
          h('button', { style: C.btn, onClick: load }, '放弃改动 / 刷新'),
          note ? h('span', { style: C.muted }, note) : null),
        h('label', { style: C.row },
          h('input', { type: 'checkbox', checked: autoEnrich, onChange: function (e) { setAutoEnrich(e.target.checked); setDirty(true) } }),
          h('span', { style: C.muted }, '扫描后自动补全番茄/刺猬猫/菠萝包的字数·收藏（榜页没有这些字段，要进书页取，约 90~100 请求）。**定时与手动「立刻扫一次」都会补**，且只补本次扫描范围内的榜；起点收藏与三江字数另见下面的开关。')),
        h('div', { style: { margin: '8px 0', padding: '7px 9px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', background: 'rgba(128,128,128,.05)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '定时扫描'),
          h('label', { style: C.row },
            h('input', {
              type: 'checkbox', checked: tOn,
              onChange: function (e) { setTOn(e.target.checked); saveTimer(e.target.checked, tTimes, tFall) },
            }),
            h('span', null, tOn ? '已开启（默认开；安装当天不自动跑）' : '已关闭（你的选择会保留，重载不翻）'),
            h('span', { style: C.muted }, '按站分时（每个站放它自己刷新点之后抓一次；一次只跑一个站）')),
          h('div', { style: { marginTop: '4px' } },
            [['qidian', '起点'], ['sfacg', '菠萝包'], ['fanqie', '番茄'], ['ciweimao', '刺猬猫'], ['qidiantu', '起点图']].map(function (s) {
              const key = s[0]
              const pl = planLive || (tLast && tLast.plan) || {}
              const today = pl.today || ''
              const slr = (tLast && tLast.siteLastRun) || {}
              const scan = pl.siteLastScan || (tLast && tLast.siteLastScan) || {}
              const hit = scan[key] || null
              const hhmmss = hit && hit.at ? fmtLocalHM(hit.at) : ''
              const doneTag = hit
                ? '今天已抓（' + (hit.by === 'timer' ? '定时' : hit.by === 'manual' ? '手动' : hit.by || '扫描') + (hhmmss ? ' ' + hhmmss : '') + '）'
                : slr[key] === today ? '今天已跑（定时）' : '今天已抓'
              const why = (pl.done || []).indexOf(key) >= 0 ? doneTag
                : (pl.due || []).indexOf(key) >= 0 ? '到点待跑'
                : (pl.waiting || []).indexOf(key) >= 0 ? '等到点'
                : (pl.fallback || []).indexOf(key) >= 0 ? '漏了 → 兜底补' : '—'
              const sf = pl.staleFlag || {}
              const sb = Object.keys(sf).find(function (b) { return b.split('.')[0] === key && sf[b] && sf[b].date === pl.today })
              const isStale = (pl.staleSites || []).indexOf(key) >= 0
              return h('div', { key: key, style: { ...C.row, marginTop: '2px' } },
                h('span', { style: { width: '48px', flex: '0 0 auto' } }, s[1]),
                h('input', {
                  type: 'time', style: { ...C.btn, width: '96px' }, value: (tTimes || {})[key] || '',
                  onChange: function (e) { const nx = Object.assign({}, tTimes); nx[key] = e.target.value; setTTimes(nx) },
                  onBlur: function (e) { if (e.target.value !== ((tLast && tLast.siteTimes && tLast.siteTimes[key]) || '')) { const nx = Object.assign({}, tTimes); nx[key] = e.target.value; saveTimer(tOn, nx, tFall) } },
                }),
                h('span', { style: C.muted }, why),
                isStale ? h('span', { style: { color: '#d9534f' }, title: '与上一数据日整榜完全一致 ⇒ 站点很可能还没换榜；到兜底时刻会自动补抓一次，也可以现在手动重抓' },
                  '⚠ 疑似未刷新（与 ' + ((sb && sf[sb] && sf[sb].prevDate) || '上一日') + ' 完全一致）') : null,
                isStale ? h('button', {
                  style: C.btn,
                  onClick: function () {
                    const ids = (cat.boards || []).filter(function (b) { return b.site === key }).map(function (b) { return b.boardId })
                    jpost('/scan', { boards: ids }).then(function () { setTNote('已重抓 ' + s[1] + '（' + ids.length + ' 个榜）') })
                      .catch(function (e) { setTNote('重抓失败：' + e) })
                  },
                }, '重抓该站') : null)
            }),
            h('div', { style: { ...C.row, marginTop: '2px' } },
              h('span', { style: { width: '48px', flex: '0 0 auto' } }, '兜底'),
              h('input', {
                type: 'time', style: { ...C.btn, width: '96px' }, value: tFall,
                onChange: function (e) { setTFall(e.target.value) },
                onBlur: function (e) { if (e.target.value !== ((tLast && tLast.fallbackTime) || '')) saveTimer(tOn, tTimes, e.target.value) },
              }),
              h('span', { style: C.muted }, '当天没跑成的站到这个点补跑一次')),
            h('div', { style: { ...C.muted, marginTop: '2px' } },
              '状态更新于 ' + ((planLive && planLive.now) || '—') + '（常态 3 分钟刷新，有站到点待跑时 30 秒；「今天已抓」= 这个站今天的快照已经在盘上，手动扫的也算）'),
            (planLive && planLive.installedToday)
              ? h('div', { style: { ...C.muted, marginTop: '2px' } }, '★ 今天刚安装：新装默认开着定时，但**安装当天不自动跑**，明天起按上面的时刻执行。')
              : null),
          h('div', { style: C.muted },
            (tLast && tLast.lastRun ? '上次定时扫描：' + tLast.lastRun + '（' + (tLast.lastState || '?') + '）' + (tLast.lastRunAt ? ' @' + fmtLocalStamp(tLast.lastRunAt) : '') : '本地还没跑过定时扫描') +
            '　·　定时器' + ((tLast && !tLast.enabled)
              ? '未接线（定时开关关着）'
              : (tLast && tLast.wired) ? '已接线' : '未接线（宿主 timer 服务不可用）') +
            (tLast && tLast.inFlight ? '　·　正在扫描' : '')),
          tNote ? h('div', { style: C.muted }, tNote) : null),
        h('div', { style: { margin: '8px 0', padding: '7px 9px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', background: 'rgba(128,128,128,.05)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '起点收藏（书页补全）'),
          h('label', { style: C.row },
            h('input', { type: 'checkbox', checked: qdEnrich, onChange: function (e) { setQdEnrich(e.target.checked); setDirty(true) } }),
            h('span', null, qdEnrich ? '已开启' : '已关闭（默认关）'),
            h('span', { style: C.muted }, '起点任何榜单页都没有收藏，只能逐本进作品页（约 103 KB/本）。开启后靠书页缓存跳过重复的书，只有新入榜/缓存过期的才真打请求。')),
          h('div', { style: C.muted },
            '缓存：' + (qdCache && qdCache.cache ? qdCache.cache.books : 0) + ' 本' +
            (qdCache && qdCache.cache && qdCache.cache.newest ? '（最近 ' + (fmtLocalStamp(qdCache.cache.newest) || qdCache.cache.newest.slice(0, 16)) + '）' : '') +
            '　·　有效期 ' + ((qdCache && qdCache.ttlDays) || 7) + ' 天'),
          h('div', { style: C.row },
            h('button', {
              style: C.btn, disabled: busy,
              onClick: function () {
                setBusy(true)
                jpost('/qidianEnrich').then(function (r) { setNote(r && r.note ? r.note : '起点补全完成'); return load() })
                  .catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) })
              },
            }, '补全起点收藏（只打没缓存的书）'),
            h('button', {
              style: C.btn, disabled: busy,
              onClick: function () {
                setBusy(true)
                jpost('/qidianCache', { clear: true }).then(function (r) { setNote(r && r.note ? r.note : '缓存已清'); return load() })
                  .catch(function (e) { setNote(String(e)) }).then(function () { setBusy(false) })
              },
            }, '清空书页缓存（强制重抓）'))),
        h('div', { style: C.row }, sites.map(function (s) {
          return h('span', { key: s, style: { marginRight: '6px' } },
            h('button', { style: C.btn, onClick: function () { setAll(s, true) } }, '全选 ' + siteNameOf(s)),
            ' ',
            h('button', { style: C.btn, onClick: function () { setAll(s, false) } }, '全不选'))
        })),
        h(VersionRow, { setNote: setNote }),
        groups.map(function (g) {
          const derived = g.items.length > 0 && String(g.items[0].boardId).indexOf('fanqie.derived.') === 0
          return h('div', { key: g.site + g.group },
            h('div', { style: C.siteBar }, g.siteName + ' · ' + g.group),
            derived ? h('div', { style: { ...C.muted, margin: '0 0 4px 2px' } }, '本地派生榜：不发请求（0 请求），总是显示在面板里 —— 它不走「显示集」，所以概览里的「隐藏 N 个」不包含它。') : null,
            h('table', { style: C.table },
              h('tbody', null, g.items.map(function (b) {
                return h('tr', { key: b.boardId },
                  h('td', { style: { ...C.td, width: '22px' } }, h('input', { type: 'checkbox', checked: has(b.boardId), onChange: function (e) { toggle(b.boardId, e.target.checked) } })),
                  h('td', { style: C.td }, b.label))
              }))))
        }))
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
      if (k === 'delta') return (ex.periodChanged === true) ? '新期' : r.deltaGroup === 'new' ? '＋ 新' : r.deltaGroup === 'rebound' ? '回榜' : r.delta === null || r.delta === undefined ? '—' : (r.delta > 0 ? '↑ ' + r.delta : r.delta < 0 ? '↓ ' + Math.abs(r.delta) : '0')
      if (k === 'read') return fmtRead(ex.read !== undefined ? ex.read : r.value)
      if (k === 'value') return fmtRead(r.value)
      if (k === 'baseRead') return fmtRead(ex.baseRead !== undefined ? ex.baseRead : ex.prevRead)
      if (k === 'readDelta') return ex.delta != null ? (ex.delta > 0 ? '+' + fmtRead(ex.delta) : String(ex.delta)) : '—'
      if (k === 'dailyDelta') return ex.dailyDelta == null ? '—' : (ex.dailyDelta > 0 ? '+' : '') + ex.dailyDelta
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
    function bookKeyOf(boardId, key) {
      const id = String(key == null ? '' : key).trim()
      if (!id) return ''
      const s = String(boardId || '')
      const ns = s.indexOf('qidiantu.') === 0 ? 'qidian' : s.indexOf('ciweimao.') === 0 ? 'ciweimao' : s.indexOf('sfacg.') === 0 ? 'sfacg' : s.indexOf('fanqie.') === 0 ? 'fanqie' : s.indexOf('qidian.') === 0 ? 'qidian' : ''
      return ns ? ns + ':' + id : ''
    }

    /** 行详情卡里的书签编辑：备注（失焦保存）+ 夹 */
    function DetailBookmarkEditor(props) {
      const store = bmStore.use()
      const bk = props.bookKey
      const [note, setNote] = React.useState('')
      const [folders, setFolders] = React.useState('')
      const [msg, setMsg] = React.useState(null)
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
        store.act({ action: 'update', bookKey: bk, note: note, folders: folders.split(/[\s,，]+/).filter(Boolean) })
          .then(function () { setMsg('已保存'); return store.refreshList() })
          .catch(function (e) { setMsg('保存失败：' + e) })
      }
      return h('div', { style: { ...C.detail, marginTop: '6px' } },
        h('div', { style: C.row },
          h('span', { style: C.muted }, '备注'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '160px' }, value: note, placeholder: '写点什么，可用 #标签', onChange: function (e) { setNote(e.target.value) }, onBlur: save })),
        h('div', { style: C.row },
          h('span', { style: C.muted }, '书签夹'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '120px' }, value: folders, placeholder: '空格分隔，可属于多个夹', onChange: function (e) { setFolders(e.target.value) }, onBlur: save }),
          h('span', { style: C.muted }, '（失焦即保存）')),
        msg ? h('div', { style: C.muted }, msg) : null)
    }

    /** 「我的书签」：卡片列表 + 搜索/过滤 + 备注夹编辑 + 回收站 + 添加 + 导出 */
    function BookmarksTab(props) {
      const store = bmStore.use()
      const [, force] = React.useState(0)
      const bump = function () { force(function (x) { return x + 1 }) }
      const [undo, setUndo] = React.useState(null)
      const [slide, setSlide] = React.useState(0)
      const [trash, setTrash] = React.useState([])
      const [showTrash, setShowTrash] = React.useState(false)
      const [manual, setManual] = React.useState('')
      const [manualSite, setManualSite] = React.useState('')
      const [local, setLocal] = React.useState({})
      // ★ 2026-10-16（使用方需求）：勾选导出 + 格式 + 目标目录 + 在文件夹里打开
      const selS = React.useState([])
      const sel = selS[0]
      const setSel = selS[1]
      const fmtS = React.useState('csv')
      const fmt = fmtS[0]
      const setFmt = fmtS[1]
      const destS = React.useState('')
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
        if (typeof store.trashList === 'function') store.trashList().then(function (t) { setTrash(t); bump() })
      }
      // 依赖数组里也不能直接摸 store.filters（旧闭包 + 新 store 的组合下它就是 undefined）
      const flt = healStore(store).filters
      React.useEffect(function () { load() }, [flt.q, flt.site, flt.folder, flt.tag])
      // 撤销：5 秒窗口（只在这里给；刷新页面后就靠回收站）
      React.useEffect(function () {
        if (!undo) return
        // 撤销窗口 8 秒（★ 实测：5 秒在下拉/看快照的间隙里就过期了，太紧；回收站仍是兜底）
        const t = setTimeout(function () { setUndo(null) }, 8000)
        const id = setInterval(function () { setSlide(function (s) { return s >= 100 ? 100 : s + 2 }) }, 100)
        return function () { clearTimeout(t); clearInterval(id) }
      }, [undo])
      const doRemove = function (b) {
        setSlide(0)
        store.act({ action: 'remove', bookKey: b.bookKey }).then(function () { setUndo(b); load() }).catch(function () {})
      }
      const doUndo = function () {
        if (!undo) return
        store.act({ action: 'restore', bookKey: undo.bookKey }).then(function () { setUndo(null); load() }).catch(function () {})
      }
      const saveNote = function (b, note, folders) {
        store.act({ action: 'update', bookKey: b.bookKey, note: note, folders: folders })
          .then(function () { return store.refreshList() }).then(function () { setLocal({}); bump() }).catch(function () {})
      }
      const doRefresh = function (keys) {
        store.msg = '刷新中（每本 1 请求，逐本 1 秒）…'; bump()
        jpost('/bookmark/refresh', { bookKeys: keys }).then(function (r) {
          store.msg = (r && r.note) || '已刷新'
          return store.refreshList()
        }).then(function () { bump() }).catch(function (e) { store.msg = '刷新失败：' + e; bump() })
      }
      const list = (store.list && store.list.bookmarks) || []
      const sites = []
      list.forEach(function (b) { if (sites.indexOf(b.site) < 0) sites.push(b.site) })
      // 站 id → 显示名（书签条目里只有 site 字符串，这里做一层人话映射）
      const SITE_NAME = { qidian: '起点', qidiantu: '起点图', ciweimao: '刺猬猫', sfacg: '菠萝包', fanqie: '番茄' }
      const siteLabel = function (s) { return SITE_NAME[s] || s }
      // 渲染体里统一用这个 f（已 ensure 过）
      const f = flt
      const setF = function (patch) { healStore(store); store.filters = { ...store.filters, ...patch }; bump() }
      const val = function (b, k) { return local[b.bookKey] && local[b.bookKey][k] != null ? local[b.bookKey][k] : (k === 'note' ? b.note : (b.folders || []).join(' ')) }
      return h('div', null,
        h('div', { style: C.row },
          h('input', { style: { ...C.input, flex: 1, minWidth: '140px' }, placeholder: '搜书名/作者/备注', value: f.q, onChange: function (e) { setF({ q: e.target.value }) } }),
          h('select', { style: C.input, value: f.site, onChange: function (e) { setF({ site: e.target.value }) } },
            h('option', { value: '' }, '全部站'), sites.map(function (s) { return h('option', { key: s, value: s }, siteLabel(s)) })),
          h('select', { style: C.input, value: f.folder, onChange: function (e) { setF({ folder: e.target.value }) } },
            h('option', { value: '' }, '全部夹'), (store.folders || []).map(function (x) { return h('option', { key: x, value: x }, x) })),
          h('button', { style: C.btn, onClick: load }, '刷新列表')),
        h('div', { style: C.muted }, '共 ' + list.length + ' 条' + (store.total && store.total !== list.length ? '（全部 ' + store.total + ' 条，已过滤）' : '') + '　·　不含回收站'),
        store.health && store.health.error ? h('div', { style: { ...C.muted, color: '#d9534f' } }, '⚠ ' + store.health.error) : null,
        list.length === 0 ? h('div', { style: C.muted }, f.q || f.site || f.folder ? '没有符合过滤条件的书签' : '还没有书签：在「当前榜单」里点书名旁的 ☆ 就能加') : null,
        list.map(function (b) {
          const lv = local[b.bookKey] || {}
          return h('div', { key: b.bookKey, style: C.card },
            h('div', { style: C.row },
              h('input', { type: 'checkbox', style: { margin: '0 2px', flex: '0 0 auto' }, checked: sel.indexOf(b.bookKey) >= 0, onChange: function () { toggleSel(b.bookKey) } }),
              h('span', { style: C.cardTitle }, b.label),
              b.author ? h('span', { style: C.muted }, b.author) : null,
              b.words != null ? h('span', { style: C.muted }, fmtWords(b.words)) : null,
              h('span', { style: C.muted }, '数据日期 ' + String(b.capturedAt || '').slice(0, 10) + (b.ageDays != null ? '（' + b.ageDays + ' 天前）' : '')),
              // 久未更新 ⇒ 明确告诉用户「这本可能已经取不到数了」（否则旧值会被当成现值）
              b.stale ? h('span', { style: { ...C.chip, color: '#d9534f' }, title: '这张卡片的数据超过 7 天没变新：点「刷新」试试；仍不变则可能已无法更新' }, '已无法更新？') : null,
              b.valueFrom === 'manual' ? h('span', { style: C.chip }, '待补') : null),
            h('div', { style: C.row },
              // ★ 站方数据：起点/起点图/刺猬猫/菠萝包 = 收藏；番茄 = 在读（readCount）。
              //   来源多样（榜单行自带 / 起点书页缓存 / 书页刷新）⇒ 用 title 说明「这个数哪来的」。
              (function () {
                const lab = b.collectLabel || (b.site === 'fanqie' ? '在读' : '收藏')
                const src = b.collectFrom === 'qidian-book-cache' ? '来自起点书页缓存（扫描后补全回填）'
                  : b.collectFrom === 'book-page' ? '来自书页刷新'
                  : b.collectFrom === 'snapshot' ? '来自当天榜单行'
                  : '这个榜的榜单行里没有该数据；点「刷新」可按书页取一次'
                if (b.collect == null) return h('span', { style: { ...C.chip, opacity: 0.55 }, title: lab + '：' + src }, lab + ' —')
                return h('span', { style: C.chip, title: lab + '：' + fmtRead(b.collect) + '　·　' + src }, lab + ' ' + fmtRead(b.collect))
              })(),
              // ★ 2026-10-16（使用者反馈）：只在**真有数值**且与上面 collect chip 不同源时渲染。
              //   名次型榜（起点/刺猬猫/菠萝包）的 metric.value 恒 null ⇒ 以前画成「名次 —」（无内容的空标签）；
              //   番茄的 metric 与 collect 都是 row.value（在读）⇒ 以前画两遍「在读」。
              //   这里同时兜住**存量**书签：旧盘上写下的 {名次,null} / 重复项一律不再显示（autoUpdate 是合并语义，不回头改盘）。
              (function () { const t = metricChipText(b.metric, b.collect); return t ? h('span', { style: C.chip }, t) : null })(),
              b.firstSeen ? h('span', { style: C.muted }, '首次发现：' + b.firstSeen.boardId + ' 第 ' + (b.firstSeen.rank == null ? '—' : b.firstSeen.rank) + ' 名（' + b.firstSeen.dataDate + '）') : h('span', { style: C.muted }, '手动添加 · 无榜单来源'),
              b.source === 'manual' ? h('span', { style: C.muted }, '（不在榜 ⇒ 不会自动更新）') : null),
            (b.seenBoards || []).filter(function (s) { return !b.firstSeen || s.boardId !== b.firstSeen.boardId }).length
              ? h('div', { style: C.muted }, '也上过：' + (b.seenBoards || []).filter(function (s) { return !b.firstSeen || s.boardId !== b.firstSeen.boardId }).map(function (s) { return s.boardId }).join('、'))
              : null,
            (b.tags || []).length ? h('div', { style: C.row }, (b.tags || []).map(function (t) { return h('span', { key: t, style: C.chip }, '#' + t) })) : null,
            h('div', { style: C.row },
              h('span', { style: C.muted }, '备注'),
              h('input', { style: { ...C.input, flex: 1, minWidth: '140px' }, value: val(b, 'note'), placeholder: '可用 #标签',
                onChange: function (e) { setLocal({ ...local, [b.bookKey]: { ...lv, note: e.target.value } }) },
                onBlur: function (e) { saveNote(b, e.target.value, (val(b, 'folders')).split(/[\s,，]+/).filter(Boolean)) } }),
              h('span', { style: C.muted }, '夹'),
              h('input', { style: { ...C.input, width: '110px' }, value: val(b, 'folders'), placeholder: '可多个',
                onChange: function (e) { setLocal({ ...local, [b.bookKey]: { ...lv, folders: e.target.value } }) },
                onBlur: function (e) { saveNote(b, val(b, 'note'), e.target.value.split(/[\s,，]+/).filter(Boolean)) } })),
            h('div', { style: C.row },
              h('button', { style: C.btn, onClick: function () { doRefresh([b.bookKey]) } }, '刷新'),
              // ★ 2026-10-16 使用方：书签卡「打开」与榜单页「书名」走同一条路 —— 首选 DSH 侧栏浏览器，服务不可见才退回新标签
              h('a', { href: b.url || '#', style: { color: 'inherit', padding: '3px 8px' }, title: '在 DSH 侧栏浏览器打开', onClick: function (e) { e.preventDefault(); (props.openLink || function (u) { window.open(u, '_blank', 'noopener,noreferrer') })(b.url) } }, '打开'),
              h('button', { style: C.btn, onClick: function () { doRemove(b) } }, '删除')))
        }),
        undo ? h('div', { style: { ...C.row, padding: '5px 7px', border: '1px solid rgba(217,164,65,.5)', borderRadius: '6px', background: 'rgba(217,164,65,.10)' } },
          h('span', null, '已删除「' + undo.label + '」'),
          h('button', { style: C.btnOn, onClick: doUndo }, '撤销'),
          h('span', { style: C.muted }, '（8 秒内；之后可在回收站找回）')) : null,
        h('div', { style: { ...C.row, marginTop: '8px' } },
          h('button', { style: C.btn, onClick: function () { setShowTrash(!showTrash); store.trashList().then(function (t) { setTrash(t); bump() }) } }, (showTrash ? '收起' : '展开') + '最近删除（' + trash.length + '）'),
          trash.length && showTrash ? h('button', { style: C.btn, onClick: function () { jpost('/bookmark', { action: 'purge', bookKeys: trash.map(function (b) { return b.bookKey }) }).then(function () { load() }) } }, '清空回收站') : null),
        showTrash ? (trash.length === 0 ? h('div', { style: C.muted }, '回收站是空的') : trash.map(function (b) {
          return h('div', { key: b.bookKey, style: { ...C.card, opacity: 0.75 } },
            h('div', { style: C.row }, h('span', { style: C.cardTitle }, b.label), h('span', { style: C.muted }, '删除于 ' + String(b.deletedAt).slice(0, 10) + '　还可找回 ' + b.daysLeft + ' 天'),
              h('button', { style: C.btn, onClick: function () { store.act({ action: 'restore', bookKey: b.bookKey }).then(function () { load() }).catch(function () {}) } }, '恢复')))
        })) : null,
        h('div', { style: { ...C.row, marginTop: '10px' } },
          h('span', { style: C.muted }, '添加作品'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '150px' }, placeholder: '贴书页 URL 或 qidian:<书号>（纯书号请选站）', value: manual, onChange: function (e) { setManual(e.target.value) } }),
          h('select', { style: C.input, value: manualSite, onChange: function (e) { setManualSite(e.target.value) } },
            h('option', { value: '' }, '（URL 可自动识别）'),
            h('option', { value: 'qidian' }, '起点'), h('option', { value: 'qidiantu' }, '起点图'), h('option', { value: 'ciweimao' }, '刺猬猫'), h('option', { value: 'sfacg' }, '菠萝包'), h('option', { value: 'fanqie' }, '番茄')),
          h('button', { style: C.btn, disabled: !manual.trim(), onClick: function () {
            jpost('/bookmark/add-manual', { input: manual.trim(), site: manualSite || undefined }).then(function (r) {
              store.msg = (r && r.note) || '已添加'
              setManual('')
              return store.refreshList()
            }).then(function () { bump() }).catch(function (e) { store.msg = '添加失败：' + e; bump() })
          } }, '加入书签')),
        h('div', { style: { ...C.row, marginTop: '10px', flexWrap: 'wrap' } },
          h('span', { style: C.muted }, '导出'),
          h('span', { style: C.muted }, sel.length ? '已选 ' + sel.length + ' 条' : '未选（= 全部 ' + list.length + ' 条）'),
          h('button', { style: C.btn, onClick: function () { setSel(list.map(function (b) { return b.bookKey })) } }, '全选当前列表'),
          h('button', { style: C.btn, disabled: !sel.length, onClick: function () { setSel([]) } }, '清空选择'),
          h('button', {
            style: C.btn,
            title: '只勾选当前「站」筛选下的作品',
            onClick: function () { setSel(list.filter(function (b) { return !f.site || b.site === f.site }).map(function (b) { return b.bookKey })) },
          }, '按站全选'),
          h('button', {
            style: C.btn,
            title: '只勾选当前「夹」筛选下的作品',
            onClick: function () { setSel(list.filter(function (b) { return !f.folder || (b.folders || []).indexOf(f.folder) >= 0 }).map(function (b) { return b.bookKey })) },
          }, '按夹全选'),
          h('select', { style: C.input, value: fmt, onChange: function (e) { setFmt(e.target.value) } },
            h('option', { value: 'csv' }, 'CSV'), h('option', { value: 'json' }, 'JSON'), h('option', { value: 'md' }, 'Markdown')),
          h('input', { style: { ...C.input, flex: 1, minWidth: '180px' }, placeholder: '导出目录（默认 我的文档\\rank-scan-export）', value: dest, onChange: function (e) { setDest(e.target.value) } }),
          h('button', {
            style: C.btnOn,
            onClick: function () {
              setExMsg('导出中…')
              jpost('/bookmark/export-file', { format: fmt, bookKeys: sel, dest: dest.trim() || undefined })
                .then(function (r) { setExMsg((r && r.note) || '已导出'); return store.refreshList() })
                .then(function () { bump() })
                .catch(function (e) { setExMsg('导出失败：' + e); bump() })
            },
          }, '导出到目录'),
          h('button', {
            style: C.btn,
            title: '在资源管理器 / Finder 里打开导出目录',
            onClick: function () {
              jpost('/bookmark/open-folder', { path: dest.trim() || undefined })
                .then(function (r) { setExMsg('已打开 ' + ((r && r.opened) || '')) })
                .catch(function (e) { setExMsg('打不开：' + e) })
            },
          }, '打开文件夹'),
          exMsg ? h('span', { style: C.muted, flexBasis: '100%' }, String(exMsg).slice(0, 120)) : null,
          store.msg ? h('span', { style: C.muted }, store.msg) : null),
        h('div', { style: C.muted, marginTop: '6px' }, '书签是你的数据：独立于快照与保留策略；备注与夹不会被自动更新覆盖。'))
    }
    function BoardTab(props) {
      const ov = props.ov
      const sites = (ov && ov.sites) || []
      // 收起面板会卸载 BoardTab ⇒ 站/榜选择也要持久化，否则再打开跳回第一个站/第一个榜
      const [stSite, setStSite] = React.useState(function () { return sel.get().site })
      const [bt, setBt] = React.useState(function () { return sel.get().board })
      const [sd, setSd] = React.useState('')
      const [ss, setSs] = React.useState('')
      const [data, setData] = React.useState(null)
      const [pick, setPick] = React.useState(null)
      const [depth, setDepth] = React.useState('')
      const [info, setInfo] = React.useState({ max: 100, can: true, hint: '' })
      const [enrichBusy, setEnrichBusy] = React.useState(false)
      const [enrichNote, setEnrichNote] = React.useState(null)
      const [qDate, setQDate] = React.useState('')
      const curSite = stSite || (sites[0] && sites[0].site)
      const curBoards = ((sites.filter(function (s) { return s.site === curSite })[0] || {}).boards) || []
      const curBoard = bt || (curBoards[0] && curBoards[0].boardId)
      // 派生榜（本地按区间算）：没有快照日期 ⇒ 隐藏「日期」下拉；总是显示最新一期
      const isDerived = String(curBoard || '').indexOf('fanqie.derived.') === 0
      const curMeta = curBoards.filter(function (b) { return b.boardId === curBoard })[0] || {}
      const mainLabel = curMeta.mainLabel || '名次'
      // 排序项由宿主按「这个榜真有什么」给出；再按当前列集合过滤一次（没有的列不给排）
      const colKeys = ((data && data.columns) || []).map(function (c) { return c.key })
      const sortOpts = ((data && data.sortOptions) || [{ value: '', label: '默认' }, { value: 'rank', label: '名次' }])
        .filter(function (o) { return !o.value || o.value === 'rank' || colKeys.indexOf(o.value) >= 0 })
      // ★ 日期下拉只用**这个榜自己**有快照的日期（/board 回的 data.dates）。
      //   之前用全局 ov.dates ⇒ 给某个榜点一次历史查询，那个日期就出现在所有站点的下拉里（使用方 2026-10-15 反馈）。
      const allDates = (data && data.dates && data.dates.length ? data.dates : [])
      const dateOpts = [{ value: '', label: '最新' }].concat(allDates.slice().reverse().map(function (d) { return { value: d, label: d } }))
      React.useEffect(function () {
        jget('/catalog').then(function (c) {
          const v = (c.depths || {})[curBoard]
          const b = (c.boards || []).filter(function (x) { return x.boardId === curBoard })[0] || {}
          // 没配过就显示该站默认（番茄/刺猬猫 30），而不是空着
          setDepth(v != null ? String(v) : (b.depth != null ? String(b.depth) : ''))
          setInfo({ depth: v != null ? v : null, max: b.maxDepth || 100, can: b.canDepth !== false, hint: b.depthHint || '' })
        }).catch(function () {})
      }, [curBoard])
      const reloadBoard = React.useCallback(function () {
        if (!curBoard) return
        const q = '/board?boardId=' + encodeURIComponent(curBoard) + (sd ? '&date=' + sd : '') + (ss ? '&sort=' + ss : '')
        jget(q).then(function (d) { setData(d); setPick(null) }).catch(function (e) { setData({ note: String(e), rows: [], columns: [] }) })
      }, [curBoard, sd, ss])
      React.useEffect(function () { reloadBoard() }, [reloadBoard])
      /** 局部下拉构造器（原名 sel，与模块级选择存储 store 区分开） */
      const selXS = function (label, value, options, onChange) {
        return h('label', { style: C.row }, h('span', { style: C.muted }, label),
          h('select', { value: value, onChange: function (e) { onChange(e.target.value) }, style: C.btn },
            options.map(function (o) { return h('option', { key: o.value, value: o.value }, o.label) })))
      }
      /** 保存条数后**立即重抓本榜**（否则要等下一次扫描，用户会以为没生效） */
      const saveDepth = function () {
        const n = Math.max(1, Math.min(info.max || 100, Number(depth) || 10))
        setEnrichBusy(true)
        setEnrichNote('已设为 ' + n + ' 条，正在重抓本榜…')
        jpost('/depth', { boardId: curBoard, depth: n })
          .then(function () { return jpost('/scan', { boards: curBoard }) })
          .then(function (r) { setEnrichNote('已保存并重抓：' + ((r && r.boards) || []).map(function (x) { return x.boardId + ' ' + x.rows + ' 条' }).join('')) ; return reloadBoard() })
          .catch(function (e) { setEnrichNote(String(e)) })
          .then(function () { setEnrichBusy(false) })
      }
      const doEnrich = function () {
        setEnrichBusy(true)
        setEnrichNote('补全中（逐本 1 请求 + 1s 限速，可能要几十秒）…')
        jpost('/enrich?boardId=' + encodeURIComponent(curBoard)).then(function (r) {
          setEnrichNote(r && r.note ? r.note : '补全完成')
          return reloadBoard()
        }).catch(function (e) { setEnrichNote(String(e)) }).then(function () { setEnrichBusy(false) })
      }
      /** 起点图支持按日期直查：面板不必等本地有那天的快照 */
      const queryDay = function (save) {
        if (!qDate) { setEnrichNote('先选一个日期'); return }
        setEnrichBusy(true)
        setEnrichNote('直查 ' + qDate + ' …')
        jpost('/day', { boardId: curBoard, date: qDate, save: !!save }).then(function (r) {
          const qDateShown = (r && r.date) || qDate
          setEnrichNote(r && r.note ? r.note : (save ? '已抓取并存入本地快照' : '已直查（未落盘）'))
          if (save) {
            // ★ 存本地后要把「日期」下拉切到那一天（使用方 2026-10-15 反馈：点了却跳回最新）
            //   只设 sd 不手动 reload：sd 变化会由 reloadBoard 的 useEffect 触发，且带上 date 参数。
            setSd(qDateShown)
            return null
          }
          // ★ 未落盘直查（2026-10-15 使用方反馈「点了还是显示原本的日期」）：
          //   表格**确实**换成了目标日期的数据，但界面上没有任何地方标出「你现在看的是哪天」，
          //   而且「排序」还沿用着上一个视图的选择 ⇒ 看起来像没反应。
          //   现在：① 切到直查视图时把排序复位成「默认（名次）」；② 用醒目的 _queryDate 标出当前查看日期。
          setSs('')
          setData(function (prev) {
            return {
              ...(prev || {}),
              boardId: curBoard,
              rows: (r.rowsAll || []).map(function (x) { return { ...x, delta: null, days: null } }),
              dataDate: qDateShown,
              // 让「日期」下拉也能显示这一天（直查的日期不在本地 dates 里，临时补进选项）
              dates: (function () {
                const ds = ((prev && prev.dates) || []).slice()
                if (ds.indexOf(qDateShown) < 0) ds.push(qDateShown)
                return ds
              })(),
              note: '直查站点 ' + qDateShown + (r.contentDate && r.contentDate !== qDateShown ? '（站点内容日期 ' + r.contentDate + '）' : ''),
              _queryDate: qDateShown,
            }
          })
        }).catch(function (e) { setEnrichNote(String(e)) }).then(function () { setEnrichBusy(false) })
      }
      /** 番茄全部已抓分类：逐榜补，**显示进度**（每本 1 请求 + 1s 限速，榜多就慢） */
      const doEnrichFanqie = function () {
        setEnrichBusy(true)
        jget('/catalog').then(function (cat) {
          const ids = (cat.captures || []).filter(function (x) { return x.indexOf('fanqie.m.') === 0 })
          if (!ids.length) { setEnrichNote('抓取集里没有番茄分类榜'); setEnrichBusy(false); return null }
          let done = 0
          let filled = 0
          let seq = Promise.resolve()
          ids.forEach(function (id) {
            seq = seq.then(function () {
              setEnrichNote('番茄补全中 ' + done + '/' + ids.length + ' 个榜（' + id + '）…')
              return jpost('/enrich?boardId=' + encodeURIComponent(id)).then(function (r) {
                done += 1
                filled += (r && r.filled) || 0
                if (r && r.learned) setEnrichNote('番茄 ' + done + '/' + ids.length + '：字体映射已学到 ' + r.learned + ' 字')
              }).catch(function () { done += 1 })
            })
          })
          return seq.then(function () {
            setEnrichNote('番茄补全完成：' + ids.length + ' 个榜，共补 ' + filled + ' 条')
            return reloadBoard()
          })
        }).catch(function (e) { setEnrichNote(String(e)) }).then(function () { setEnrichBusy(false) })
      }
      return h('div', null,
        h('div', { style: C.row },
          selXS('站', curSite || '', sites.map(function (s) { return { value: s.site, label: s.siteName } }), function (v) { sel.set({ site: v, board: null }); setStSite(v); setBt(null) }),
          selXS('榜', curBoard || '', curBoards.map(function (b) { return { value: b.boardId, label: b.name } }), function (v) { sel.set({ board: v }); setBt(v) }),
          // 派生榜没有快照日期（总是算最新一期）⇒ 不显示日期下拉，避免选了半天没反应
          isDerived ? null : selXS('日期', sd, dateOpts, setSd),
          selXS('排序', ss, sortOpts, setSs)),
        h('div', { style: C.row },
          h('span', { style: C.muted }, '每榜取'),
          h('input', { type: 'number', min: 1, max: info.max, value: depth, placeholder: String(info.max), disabled: !info.can, title: info.hint, onChange: function (e) { setDepth(e.target.value) }, style: { width: '56px', fontSize: '12px', padding: '2px 4px' } }),
          h('span', { style: C.muted }, info.can ? '条（上限 ' + info.max + '）' : '条 · ' + info.hint),
          h('button', { style: C.btn, disabled: !info.can || enrichBusy, onClick: saveDepth, title: '改这一榜的取数条数，并立刻重抓**当前打开的这一榜**（换榜重抓不影响别的榜）' }, '保存并重抓本榜'),
          h('button', { style: enrichBusy ? C.btnOn : C.btn, disabled: enrichBusy, onClick: doEnrich, title: '只补**当前打开的这一榜**的行内字段：起点/起点图三江=精确字数(+收藏)（走书页缓存）；番茄=干净书名/作者；刺猬猫/菠萝包=收藏+字数（逐本 1 请求、1s 限速）' }, enrichBusy ? '补全中…' : '补全本榜'),
          // 只对番茄显示：这按钮是「把该站所有已抓分类一次补完」，在别的站出现是干扰（使用方 2026-10-15）
          curSite === 'fanqie'
            ? h('button', { style: enrichBusy ? C.btnOn : C.btn, disabled: enrichBusy, onClick: doEnrichFanqie, title: '把**抓取集里所有番茄分类榜**一次补齐（逐榜、逐本 1 请求 + 1s 限速，会很慢）' }, enrichBusy ? '补全中…' : '补齐番茄全部分类')
            : null,
          data && data.note && String(data.boardId).indexOf('qidian.') !== 0 ? h('span', { style: C.muted }, dash(data.note)) : null),
        curSite === 'qidiantu'
          ? h('div', { style: C.row },
              h('span', { style: C.muted }, '查历史日期（站点可直查）'),
              h('input', { type: 'date', value: qDate, onChange: function (e) { setQDate(e.target.value) }, style: { fontSize: '12px', padding: '2px 4px' } }),
              h('button', { style: C.btn, disabled: enrichBusy || !qDate, onClick: function () { queryDay(false) } }, '直接查看'),
              h('button', { style: C.btn, disabled: enrichBusy || !qDate, onClick: function () { queryDay(true) }, title: '抓取该日期并存为本地快照（当天已有的快照不会被覆盖）' }, '抓取并存入本地'))
          : null,
        // ★ 直查视图的日期横幅（使用方 2026-10-15）：直接查看历史日期时，这里明确写出「你在看哪天」
        data && data._queryDate
          ? h('div', { style: { ...C.row, alignItems: 'center', gap: '8px', padding: '4px 6px', background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.45)', borderRadius: '4px' } },
              h('span', { style: { fontWeight: 600 } }, '📅 正在查看直查日期 ' + data._queryDate),
              h('span', { style: C.muted }, '（未落盘；按日期直查站点，所以没有名次变化/在榜天数）'),
              h('button', { style: C.btn, onClick: function () { setSs(''); setData(null); reloadBoard() } }, '回到最新'))
          : null,
        enrichNote ? h('div', { style: C.muted }, enrichNote) : null,
        data && data.fallbackFrom ? h('div', { style: C.muted }, '当天（' + data.requestedDate + '）没有快照 ⇒ 回落到 ' + data.fallbackFrom) : null,
        data && data.baselineDate ? h('div', { style: C.muted }, '基期 ' + data.baselineDate + ' · 数据日期 ' + dash(data.dataDate)) : null,

        data && data.source ? h('div', { style: C.muted }, '来源：' + data.source) : null,
        data && data.rows && data.rows.length
          ? h('table', { style: C.table },
              h('thead', null, h('tr', null, (data.columns || []).map(function (c) { return h('th', { key: c.key, style: C.th, title: c.note || '' }, c.label) }))),
              h('tbody', null, data.rows.map(function (r, i) {
                return h('tr', { key: r.key || i, style: { cursor: 'pointer' }, onClick: function () { setPick(pick && pick.key === r.key ? null : r) } },
                  (data.columns || []).map(function (c) { return h('td', { key: c.key, style: C.td }, cell({ ...c, _openLink: props.openLink, _boardId: data.boardId, _dataDate: data.dataDate, _bmKey: bookKeyOf(data.boardId, r.key) }, r)) }))
              })))
          : h('div', { style: C.muted }, data ? dash(data.note || '没有条目') : '加载中…'),
        pick ? h('div', { style: C.detail },
          h('div', { style: { fontWeight: 600 } }, dash(pick.title)),
          h('div', { style: C.muted }, '作者 ' + dash(pick.author) + ' · 名次 ' + dash(pick.rank) + ' · 字数 ' + fmtWords((pick.extra || {}).wordsText || (pick.extra || {}).wordsCnt || (pick.extra || {}).wordNumber || (pick.extra || {}).words)),
          h('div', { style: C.muted }, '更新 ' + fmtTime((pick.extra || {}).lastChapterUpdateTime)),
          h('div', { style: C.row },
            h(BookmarkStar, { bookKey: bookKeyOf(curBoard, pick.key), row: pick, boardId: curBoard, dataDate: data && data.dataDate }),
            h(DetailBookmarkEditor, { bookKey: bookKeyOf(curBoard, pick.key) }),
            h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); if (props.openLink) props.openLink(pick.url); else window.open(pick.url, '_blank', 'noopener,noreferrer') } }, '在 DSH 侧栏浏览器打开'),
            h('a', { href: pick.url || '#', target: '_blank', rel: 'noreferrer', style: { color: 'inherit', padding: '3px 8px' }, onClick: function (e) { e.stopPropagation() } }, '新标签打开'),
            h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); try { navigator.clipboard.writeText(pick.url || '') } catch (err) {} } }, '复制链接'),
            h('button', { style: C.btn, onClick: function () { setPick(null) } }, '关闭')),
          // 原始数据来源页跳转（起点图首订 → 起点图 /info；刺猬猫首订（约）→ 第三方源）
          (pick.extra || {}).qidiantuUrl || (pick.extra || {}).sourceUrl
            ? h('div', { style: C.row },
                ((pick.extra || {}).qidiantuUrl
                  ? h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(pick.extra.qidiantuUrl) } }, '看起点图原始页')
                  : null),
                ((pick.extra || {}).sourceUrl
                  ? h('button', { style: C.btn, onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(pick.extra.sourceUrl) } }, '看原数据来源页')
                  : null),
                h('span', { style: C.muted }, '（数据口径以来源页为准）'))
            : null) : null,
        h('div', { style: C.muted, marginTop: '6px' }, '列随榜变化：该站没有的字段整列不出现；有字段但这条没抓到显示「—」。'))
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
      return h('div', {
        onClick: function (e) {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
          panelOpen.set(true)
        },
        title: '打开扫榜浮窗',
        style: { display: 'block', cursor: 'pointer', lineHeight: 0 },
      }, h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { display: 'block', opacity: active ? 1 : 0.78 },
        'aria-hidden': 'true', focusable: 'false',
      },
        // 三条由长到短的横杠 + 一个对勾：一眼认出是「榜单」，不是别的面板
        h('path', { d: 'M2 3.5h12M2 8h9M2 12.5h6' }),
        h('path', { d: 'M12.2 9.4l1.6 1.6 2-2.6' })))
    }

    function Panel(props) {
      const [open, setOpen] = panelOpen.use()
      // 收起面板会卸载 Panel ⇒ 用持久化的 tab（否则每次打开都跳回「概览」）
      const [tab, setTab] = React.useState(function () { return sel.get().tab || 'ov' })
      const switchTab = function (t) { sel.set({ tab: t }); setTab(t) }
      const [ov, setOv] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [rect, setRect] = useRect()
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
      const act = function (path) {
        setBusy(true)
        jpost(path).then(function (r) { setMsg(r && r.note ? r.note : '完成：' + (r.outcome || 'ok')); return reload() })
          .catch(function (e) { setMsg(String(e)) })
          .then(function () { setBusy(false) })
      }
      // 收起后：按钮同样可拖动、同样记住位置（用同一份 rect，不再回右上角）
      if (!open) return null
      return h('div', { style: { ...C.win, left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' } },
        h(DragBar, { rect: rect, setRect: setRect, onCollapse: function () { setOpen(false) } }),
        h('div', { style: C.body },
          h('div', { style: C.tabs },
            h('button', { style: C.tab(tab === 'ov'), onClick: function () { switchTab('ov') } }, '概览'),
            h('button', { style: C.tab(tab === 'board'), onClick: function () { switchTab('board') } }, '当前榜单'),
            // 使用方 2026-10-15 口径：我的书签夹在「当前榜单」与「抓什么」之间（榜 → 书签 → 抓取配置）
            h('button', { style: C.tab(tab === 'bm'), onClick: function () { switchTab('bm') } }, '我的书签'),
            h('button', { style: C.tab(tab === 'pick'), onClick: function () { switchTab('pick') } }, '抓什么')),
          msg ? h('div', { style: C.muted }, msg) : null,
          h(TabBoundary, { name: tab },
            tab === 'ov' ? h(Overview, { ov: ov, busy: busy, act: act, reload: reload, post: function (p, b) { return jpost(p, b) } })
              : tab === 'board' ? h(BoardTab, { ov: ov, openLink: props.openLink })
              : tab === 'bm' ? h(BookmarksTab, { openLink: props.openLink })
              : h(CaptureTab, { onSaved: reload }))),
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
       * ★ 薄 main 面板（Q29 / 审计-2 2026-10-16）：
       *   宿主 PanelRow 点击时调 layout.selectPanel(id)，而 layout.selectPanel 对**没有注册的 main 面板
       *   id** 是直接抛异常的（`main panel "x" is not registered`）。所以入口 id 必须与 main 槽的 key 一致。
       *   这里只放「一行说明 + 打开浮窗」：浮窗的拖动/缩放/位置记忆全部保留，不迁进主面板。
       */
      try {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: PANEL_ID, order: 900 }, function RankScanMainPanel() {
            return h('div', { style: { padding: '16px', fontSize: '13px', lineHeight: 1.7 } },
              h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '扫榜面板'),
              h('div', { style: C.muted }, '榜单以可拖动、可缩放的浮窗显示，位置与尺寸会本地记忆。'),
              h('div', { style: { ...C.row, marginTop: '8px' } },
                h('button', { style: C.btn, onClick: function () { panelOpen.set(true) } }, '打开浮窗')))
          })
        })
      } catch (e) { console.warn('[dsh-rank-scan] 注册 main 面板失败（宿主 layout 未就绪？）', e) }
      // 入口放 DSH **左侧栏会话列表下方**（使用方 2026-10-15 口径：收起按钮不要浮在对话上）
      // id 与 main 面板一致（PANEL_ID）⇒ 宿主那一行的 selectPanel(id) 不会抛；label 给宿主做 aria-label。
      try {
        const reg = function (slot) {
          try {
            ctx.slots.inject(slot, function () {
              return ctx.slots.register({ name: slot, id: PANEL_ID, order: 900, label: '扫榜面板' }, SidebarEntryIcon)
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
  function metricChipText(metric, collect) {
    if (!metric || metric.value == null) return null
    if (collect != null && metric.value === collect) return null
    return metric.name + ' ' + metric.value
  }
  // 测试缝：宿主只消费 name/inject/apply，多挂一个纯展示函数对运行无影响
  return { name: 'dsh-rank-scan', inject: inject, apply: apply, __test: { metricChipText: metricChipText } }
  },
})
