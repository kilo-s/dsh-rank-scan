/**
 * 20-ui-kit.js：通用 UI：Banner、Toast、PopMenu、Section、格式化/状态/列宽工具、useRect。依赖 10。不要放整页页签。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    function Banner(props) {
      const role = props.live === false ? null : (props.tone === 'error' ? 'alert' : 'status')
      return h('div', { className: 'rs-banner is-' + (props.tone || 'info'), role: role },
        props.title ? h('strong', null, props.title) : null, props.children)
    }
    /**
     * Toast：模块级队列，任何页签直接 toast(tone, text)，不必层层传 props。
     * success/info/warn 4 秒自动消失；error 常驻，带关闭按钮。最多同时 3 条。
     */
    const TOAST_MAX = 3
    const toastStore = (function () {
      const subs = new Set()
      const timers = new Map()
      let items = []
      let seq = 0
      const emit = function () { subs.forEach(function (f) { try { f(items.slice()) } catch (e) {} }) }
      const drop = function (id) {
        items = items.filter(function (t) { return t.id !== id })
        const tm = timers.get(id)
        if (tm) { clearTimeout(tm); timers.delete(id) }
        emit()
      }
      const arm = function (t) {
        if (t.tone === 'error') return
        const tm = setTimeout(function () { drop(t.id) }, t.ms || 4000)
        timers.set(t.id, tm)
      }
      const push = function (tone, text, opts) {
        const o = opts || {}
        const t = { id: 'toast-' + (++seq), tone: tone || 'info', text: String(text == null ? '' : text), ms: o.ms || 4000 }
        items = items.concat(t)
        while (items.length > (o.max || TOAST_MAX)) {
          const old = items.shift()
          const tm = timers.get(old.id)
          if (tm) { clearTimeout(tm); timers.delete(old.id) }
        }
        emit()
        arm(t)
        return t.id
      }
      const pause = function (id) { const tm = timers.get(id); if (tm) { clearTimeout(tm); timers.delete(id) } }
      const resume = function (id) { const t = items.filter(function (x) { return x.id === id })[0]; if (t) arm(t) }
      return {
        push: push,
        remove: drop,
        pause: pause,
        resume: resume,
        get: function () { return items.slice() },
        subscribe: function (f) { subs.add(f); return function () { subs.delete(f) } },
      }
    })()
    /** 最近一条提示：诊断复制与「最近提示」用（不进 Toast 的纯状态文字不会进来） */
    const lastNote = (function () {
      let v = ''
      const subs = new Set()
      return {
        get: function () { return v },
        set: function (s) { v = String(s == null ? '' : s); subs.forEach(function (f) { try { f(v) } catch (e) {} }) },
        subscribe: function (f) { subs.add(f); return function () { subs.delete(f) } },
      }
    })()
    const toast = function (tone, text, opts) {
      const s = String(text == null ? '' : text)
      lastNote.set(s)
      return toastStore.push(tone, s, opts)
    }
    function useLastNote() {
      const [v, setV] = React.useState(lastNote.get())
      React.useEffect(function () { return lastNote.subscribe(setV) }, [])
      return v
    }
    function ToastHost() {
      const [items, setItems] = React.useState(toastStore.get())
      React.useEffect(function () { return toastStore.subscribe(setItems) }, [])
      if (!items.length) return null
      return h('div', { className: 'rs-toasts' },
        items.map(function (t) {
          return h('div', {
            key: t.id,
            className: 'rs-toast is-' + t.tone,
            role: t.tone === 'error' ? 'alert' : 'status',
            onMouseEnter: function () { toastStore.pause(t.id) },
            onMouseLeave: function () { toastStore.resume(t.id) },
          },
          h('span', { className: 'rs-toast-text' }, t.text),
          t.tone === 'error'
            ? h('button', { className: 'rs-toast-x', onClick: function () { toastStore.remove(t.id) }, 'aria-label': '关闭提示', title: '关闭' }, '×')
            : null)
        }))
    }
    /**
     * ★ 2026-10-17（易用性 P0）：哪些列算「数字列」—— 只有它们套 C.num（不折行 + 等宽数字）。
     *   书名/作者/分类这类文本列仍允许换行，否则长书名会把整张表撑宽。
     */
    // 0.6 收尾：新增的首订 / 首日增量也是数字列（右对齐 + 等宽数字）
    const NUM_COL_RE = /^(rank|delta|words|collect|collectBase|value|ratio|fans|read|readDelta|periodTotal|periodDelta|score|days|buyNumRaw|shouding|firstDay|daily\d*|pday\d*)$/
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
    /**
     * 扫描结果 → 人话（Spec E / Standards 2026-10-24）。
     *   以前只映射 completed/cancelled/failed，而域类型里真正会出现的是
     *   running / over_budget / aborted_stalled ⇒ 概览会直接显示英文枚举。
     *   inFlight=false 的 running 是「上一轮进程没走完」留下的落盘记录，不能冒充「正在跑」。
     */
    const SCAN_OUTCOME_TEXT = {
      running: '扫描中',
      completed: '已完成',
      cancelled: '已取消',
      over_budget: '超出本次预算，已停',
      aborted_stalled: '长时间没有进展，已中止',
      failed: '失败',
    }
    /**
     * 轮询节奏（纯函数，便于单测）：运行中 2s，空闲 20s。
     * scanActBusy = 刚点完扫描/重试/停止、POST 还没回来的那段时间 ——
     * 那时 overview 里仍是上一轮的 completed，若只看 scanLive 会退回 20s，
     * 用户点完「扫描已选榜」要等很久才看到 0/N。
     */
    const pollDelay = function (scanLive, scanActBusy) {
      return (scanLive || scanActBusy) ? 2000 : 20000
    }
    const scanLabel = function (scan) {
      if (!scan) return '还没扫描过'
      let out = SCAN_OUTCOME_TEXT[scan.outcome] || String(scan.outcome || '')
      if (scan.outcome === 'running' && scan.inFlight === false) out = '未完成（进程已退出）'
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
          className: 'rs-btn is-ghost' + (open ? ' is-on' : ''),
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
            padding: '5px', borderRadius: '8px', border: '1px solid ' + T.border, background: T.surface, color: T.fg,
            boxShadow: T.shadowMenu, display: 'flex', flexDirection: 'column', gap: '4px' },
        }, items.map(function (it, i) {
          if (!it) return null
          if (it && it.sep) return h('div', { key: 's' + i, style: { height: '1px', background: T.border, margin: '3px 0' } })
          if (it && it.rows) return h('div', { key: 'r' + i, style: { padding: '2px 2px 4px' } }, it.rows)
          return h('button', {
            key: 'i' + i,
            role: 'menuitem',
            disabled: !!it.disabled,
            title: it.title || '',
            className: 'rs-btn rs-menu-item', style: { opacity: it.disabled ? 0.45 : 1 },
            onClick: function () { if (it.disabled) return; close(); if (it.onClick) it.onClick() },
          }, it.label)
        })) : null)
    }
    /** 设置页的分组块（默认展开第一组；其余收起，需要时再展开） */
    function Section(props) {
      const st = React.useState(props.defaultOpen !== false)
      const open = st[0]
      const setOpen = st[1]
      return h('div', { style: { margin: '8px 0', padding: '6px 8px', border: '1px solid ' + T.border, borderRadius: '8px', background: T.surface2 } },
        h('button', {
          className: 'rs-section-toggle',
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
