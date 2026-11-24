/**
 * 39-overview-canvas.js：概览自由画布基础设施（四站独立卡片布局归一化、原生指针+长按拖拽引擎、卡片壳 OverviewCardShell 与卡片管理弹层）。依赖 00/10/20。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    const OV_PLAT_CARD_TYPES = ['plat-qidian', 'plat-fanqie', 'plat-ciweimao', 'plat-sfacg']
    const OV_PLAT_PID_OF_TYPE = {
      'plat-qidian': 'qidian',
      'plat-fanqie': 'fanqie',
      'plat-ciweimao': 'ciweimao',
      'plat-sfacg': 'sfacg',
    }

    const OV_CARD_META = {
      watch: { title: '盯盘', desc: '已盯作品走势与异动', canAddExtra: false },
      'plat-qidian': { title: '起点', desc: '起点 + 起点图签约/首订/三江动态', canAddExtra: false },
      'plat-fanqie': { title: '番茄', desc: '番茄男频新书榜与在读周榜动态', canAddExtra: false },
      'plat-ciweimao': { title: '刺猬猫', desc: '刺猬猫点击/新书/首订动态', canAddExtra: false },
      'plat-sfacg': { title: '菠萝包', desc: '菠萝包新书/热榜/VIP 动态', canAddExtra: false },
      'weekly-race': { title: '周榜竞速', desc: '起点三江 17 本 & 番茄在读周榜 Top 20', canAddExtra: true },
      'book-compare': { title: '作品成长对比', desc: '多书同轴曲线（日期/字数 · 收藏/涨幅%/名次）', canAddExtra: true },
      keywords: { title: '题材关键词生态', desc: '单连通枢纽衍生树 + 四站细分词云', canAddExtra: false },
    }

    const DEFAULT_OV_LAYOUT = {
      version: 2,
      cards: [
        { id: 'watch', type: 'watch', span: 'full', visible: true },
        { id: 'plat-qidian', type: 'plat-qidian', span: 'half', visible: true },
        { id: 'plat-fanqie', type: 'plat-fanqie', span: 'half', visible: true },
        { id: 'plat-ciweimao', type: 'plat-ciweimao', span: 'half', visible: true },
        { id: 'plat-sfacg', type: 'plat-sfacg', span: 'half', visible: true },
        { id: 'weekly-race', type: 'weekly-race', span: 'full', visible: true, config: { source: 'sanjiang', mode: 'daily' } },
        { id: 'book-compare', type: 'book-compare', span: 'full', visible: true, config: { xAxis: 'date', yAxis: 'value', days: 30, compareKeys: [] } },
        { id: 'keywords', type: 'keywords', span: 'full', visible: true, config: { days: 30 } },
      ],
    }

    function cloneOvCard(c) {
      return c.config ? Object.assign({}, c, { config: Object.assign({}, c.config) }) : Object.assign({}, c)
    }

    function normalizeOvLayout(raw) {
      const src = raw && typeof raw === 'object' && Array.isArray(raw.cards) ? raw.cards : null
      if (!src || !src.length) {
        return { version: 2, cards: DEFAULT_OV_LAYOUT.cards.map(cloneOvCard) }
      }
      const defMap = {}
      DEFAULT_OV_LAYOUT.cards.forEach(function (c) { defMap[c.id] = c })
      const seen = {}
      const out = []
      for (let i = 0; i < src.length; i++) {
        const it = src[i]
        if (!it || typeof it !== 'object') continue
        const id = typeof it.id === 'string' ? it.id.trim() : ''
        const type = typeof it.type === 'string' ? it.type.trim() : ''
        if (type === 'platforms') {
          const vis = it.visible !== false
          OV_PLAT_CARD_TYPES.forEach(function (pt) {
            if (seen[pt]) return
            seen[pt] = true
            out.push({ id: pt, type: pt, span: 'half', visible: vis })
          })
          continue
        }
        if (!id || seen[id] || !OV_CARD_META[type]) continue
        seen[id] = true
        const defSpan = (defMap[id] && defMap[id].span) || 'full'
        const rec = {
          id: id,
          type: type,
          span: it.span === 'half' ? 'half' : (it.span === 'full' ? 'full' : defSpan),
          visible: it.visible !== false,
        }
        if (it.config && typeof it.config === 'object' && !Array.isArray(it.config)) {
          rec.config = Object.assign({}, it.config)
        }
        out.push(rec)
        if (out.length >= 20) break
      }
      DEFAULT_OV_LAYOUT.cards.forEach(function (def) {
        if (!seen[def.id]) {
          seen[def.id] = true
          out.push(cloneOvCard(def))
        } else if (def.config) {
          const hit = out.filter(function (x) { return x.id === def.id })[0]
          if (hit) hit.config = Object.assign({}, def.config, hit.config || {})
        }
      })
      return { version: 2, cards: out }
    }

    function reorderOvCards(cards, fromId, toId) {
      if (!Array.isArray(cards) || !fromId || !toId || fromId === toId) return cards
      const fromIdx = cards.findIndex(function (c) { return c.id === fromId })
      const toIdx = cards.findIndex(function (c) { return c.id === toId })
      if (fromIdx < 0 || toIdx < 0) return cards
      const next = cards.slice()
      const moved = next.splice(fromIdx, 1)[0]
      next.splice(toIdx, 0, moved)
      return next
    }

    function isCoreOvCardId(id) {
      return DEFAULT_OV_LAYOUT.cards.some(function (c) { return c.id === id })
    }

    /** 画布布局变更纯函数 */
    function applyOvLayoutOp(prev, op, arg1, arg2) {
      const cards = (prev && Array.isArray(prev.cards)) ? prev.cards : DEFAULT_OV_LAYOUT.cards
      if (op === 'reset') return normalizeOvLayout(null)
      if (op === 'toggle') {
        const hit = cards.filter(function (c) { return c.id === arg1 })[0]
        if (!hit) return prev
        if (!isCoreOvCardId(arg1) && hit.visible !== false) {
          return normalizeOvLayout({ version: 2, cards: cards.filter(function (c) { return c.id !== arg1 }) })
        }
        return normalizeOvLayout({ version: 2, cards: cards.map(function (c) { return c.id === arg1 ? Object.assign({}, c, { visible: c.visible === false }) : c }) })
      }
      if (op === 'hide') {
        if (!isCoreOvCardId(arg1)) return normalizeOvLayout({ version: 2, cards: cards.filter(function (c) { return c.id !== arg1 }) })
        return normalizeOvLayout({ version: 2, cards: cards.map(function (c) { return c.id === arg1 ? Object.assign({}, c, { visible: false }) : c }) })
      }
      if (op === 'span') {
        return normalizeOvLayout({ version: 2, cards: cards.map(function (c) { return c.id === arg1 ? Object.assign({}, c, { span: c.span === 'half' ? 'full' : 'half' }) : c }) })
      }
      if (op === 'config') {
        return normalizeOvLayout({ version: 2, cards: cards.map(function (c) { return c.id === arg1 ? Object.assign({}, c, { config: Object.assign({}, c.config || {}, arg2) }) : c }) })
      }
      if (op === 'add') {
        const nid = arg1 + '-' + Date.now().toString(36).slice(-5)
        const cfg = arg1 === 'weekly-race'
          ? { source: 'fanqie', mode: 'daily' }
          : { xAxis: 'date', yAxis: 'value', days: 30, compareKeys: [] }
        return normalizeOvLayout({ version: 2, cards: cards.concat([{ id: nid, type: arg1, span: 'full', visible: true, config: cfg }]) })
      }
      if (op === 'reorder') {
        return normalizeOvLayout({ version: 2, cards: reorderOvCards(cards, arg1, arg2) })
      }
      return normalizeOvLayout(prev)
    }

    /** 基于指针事件的卡片拖拽引擎（抓手即拖 + 顶栏长按 260ms 拖，彻底绕开 Electron HTML5 draggable 失灵问题） */
    function useOvPointerDrag(onCommitReorder) {
      const [rawDrag, setRawDrag] = React.useState(function () { return { _tag: 'ovd', active: null } })
      const drag = (rawDrag && rawDrag._tag === 'ovd') ? rawDrag.active : null
      const commitRef = React.useRef(onCommitReorder)
      commitRef.current = onCommitReorder
      const cleanRef = React.useRef(null)
      const suppressedClickUntilRef = React.useRef(0)

      React.useEffect(function () {
        return function () { if (cleanRef.current) cleanRef.current() }
      }, [])

      const hitCardAt = function (cx, cy, selfId) {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
        const els = document.querySelectorAll('[data-ov-card-id]')
        for (let i = 0; i < els.length; i++) {
          const el = els[i]
          const cid = el.getAttribute && el.getAttribute('data-ov-card-id')
          if (!cid || cid === selfId) continue
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null
          if (!rect) continue
          if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) return cid
        }
        return null
      }

      const startDrag = function (cardId, title, ev, immediate) {
        if (!ev || (ev.button !== undefined && ev.button !== 0)) return
        if (typeof window === 'undefined' || !window.addEventListener) return
        if (cleanRef.current) cleanRef.current()
        if (immediate && ev.preventDefault) ev.preventDefault()

        const sx = ev.clientX || 0
        const sy = ev.clientY || 0
        let active = false
        let overId = null
        let curX = sx
        let curY = sy
        let timer = null

        const activate = function () {
          if (active) return
          active = true
          if (timer) { clearTimeout(timer); timer = null }
          suppressedClickUntilRef.current = Date.now() + 800
          overId = hitCardAt(curX, curY, cardId)
          setRawDrag({ _tag: 'ovd', active: { id: cardId, title: title || cardId, x: curX, y: curY, overId: overId } })
        }

        const onMove = function (me) {
          curX = me.clientX || 0
          curY = me.clientY || 0
          const dist = Math.hypot(curX - sx, curY - sy)
          if (!active) {
            if (immediate) {
              if (dist >= 4) activate()
            } else if (dist > 8) {
              cleanup(false)
            }
            return
          }
          if (me.preventDefault) me.preventDefault()
          overId = hitCardAt(curX, curY, cardId)
          setRawDrag({ _tag: 'ovd', active: { id: cardId, title: title || cardId, x: curX, y: curY, overId: overId } })
        }

        const cleanup = function (doCommit) {
          if (timer) { clearTimeout(timer); timer = null }
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          window.removeEventListener('pointercancel', onCancel, true)
          window.removeEventListener('blur', onCancel)
          cleanRef.current = null
          if (active) {
            suppressedClickUntilRef.current = Date.now() + 300
            const dropTarget = overId
            setRawDrag({ _tag: 'ovd', active: null })
            if (doCommit && dropTarget && dropTarget !== cardId && commitRef.current) {
              commitRef.current(cardId, dropTarget)
            }
          }
        }
        const onUp = function () { cleanup(true) }
        const onCancel = function () { cleanup(false) }

        cleanRef.current = function () { cleanup(false) }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
        window.addEventListener('pointercancel', onCancel, true)
        window.addEventListener('blur', onCancel)
        if (!immediate) {
          timer = setTimeout(activate, 260)
        }
      }

      const wasRecentDrag = function () { return Date.now() < suppressedClickUntilRef.current }
      return { drag: drag, startDrag: startDrag, wasRecentDrag: wasRecentDrag }
    }

    /** 拖拽中跟随光标的极简浮标（不遮挡视野，明确提示当前正在移动哪张卡） */
    function OverviewDragGhost(props) {
      const d = props.drag
      if (!d) return null
      return h('div', {
        style: {
          position: 'fixed', left: (d.x + 12) + 'px', top: (d.y + 12) + 'px', zIndex: 999,
          pointerEvents: 'none', padding: '4px 10px', borderRadius: '6px',
          background: T.surface, color: T.fg, border: '1px solid ' + T.accent,
          boxShadow: T.shadowMenu, fontSize: T.fs.xs, fontWeight: 600, whiteSpace: 'nowrap',
        },
      }, '移动：' + d.title + (d.overId ? ' → 交换位置' : ''))
    }

    /** 可拖拽、可切换半宽/通栏、可隐藏的通用概览卡片壳（抓手即拖 + 顶栏长按 260ms 拖） */
    function OverviewCardShell(props) {
      const card = props.card
      const meta = OV_CARD_META[card.type] || { title: card.id }
      const titleText = props.title || meta.title
      const narrow = !!props.narrow
      const isDragging = !!(props.drag && props.drag.id === card.id)
      const isDrop = !!(props.drag && props.drag.overId === card.id && props.drag.id !== card.id)
      const spanStyle = (!narrow && card.span === 'half') ? {} : { gridColumn: '1 / -1' }

      return h('div', {
        'data-ov-card-id': card.id,
        className: 'rs-ov-shell' + (isDragging ? ' is-dragging' : '') + (isDrop ? ' is-drop' : ''),
        style: spanStyle,
      },
        h('div', {
          className: 'rs-ov-shell-hd',
          style: props.onHeaderClick ? { cursor: 'pointer' } : undefined,
          title: props.headerTitle || undefined,
          onPointerDown: function (ev) {
            if (ev && ev.target && ev.target.closest && ev.target.closest('button,input,select,a,[data-ov-grip]')) return
            if (props.onStartDrag) props.onStartDrag(card.id, titleText, ev, false)
          },
          onClick: function (ev) {
            if (!props.onHeaderClick) return
            if (ev && ev.target && ev.target.closest && ev.target.closest('button,input,select,a,[data-ov-grip]')) return
            if (props.wasRecentDrag && props.wasRecentDrag()) return
            props.onHeaderClick(ev)
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: '1 1 auto' } },
            h('span', {
              'data-ov-grip': '1',
              className: 'rs-ov-grip',
              title: '按住拖拽排序（也可长按卡片标题栏拖动）',
              onPointerDown: function (ev) {
                if (ev && ev.stopPropagation) ev.stopPropagation()
                if (props.onStartDrag) props.onStartDrag(card.id, titleText, ev, true)
              },
            }, '⋮⋮'),
            h('span', { style: { fontWeight: 600, fontSize: T.fs.s, color: T.fg, whiteSpace: 'nowrap' } }, titleText),
            props.subtitle ? h('span', { style: { fontSize: T.fs.xs, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' } }, props.subtitle) : null),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', flex: '0 0 auto' } },
            props.headerExtra || null,
            props.canMoveUp ? h('button', { type: 'button', className: 'rs-ov-iconbtn', title: '前移卡片', onClick: function () { props.onMove && props.onMove(card.id, -1) } }, '↑') : null,
            props.canMoveDown ? h('button', { type: 'button', className: 'rs-ov-iconbtn', title: '后移卡片', onClick: function () { props.onMove && props.onMove(card.id, 1) } }, '↓') : null,
            !narrow ? h('button', {
              type: 'button', className: 'rs-ov-iconbtn',
              title: card.span === 'half' ? '切换为通栏' : '切换为半宽（双列并排）',
              onClick: function () { props.onToggleSpan && props.onToggleSpan(card.id) },
            }, card.span === 'half' ? '通栏' : '半宽') : null,
            h('button', {
              type: 'button', className: 'rs-ov-iconbtn',
              title: isCoreOvCardId(card.id) ? '隐藏卡片（可在右上角「卡片」重新开启）' : '移除此副本卡片',
              onClick: function () { props.onHide && props.onHide(card.id) },
            }, '×'))),
        props.children)
    }

    /** 概览右上角卡片管理弹层（开关任意单站/分析卡片、一键重置默认顺序，支持点外部/Esc 关闭） */
    function OverviewCanvasPicker(props) {
      const [pkSt, patchPk] = useOvState('pk', function () { return { open: false } })
      const open = !!pkSt.open
      const setOpen = function (v) { patchPk(function (prev) { return { open: typeof v === 'function' ? v(!!prev.open) : !!v } }) }
      const pickerRef = React.useRef(null)
      useOvPopoverClose(open, function () { setOpen(false) }, pickerRef)
      const cards = (props.layout && Array.isArray(props.layout.cards)) ? props.layout.cards : DEFAULT_OV_LAYOUT.cards
      const visibleCount = cards.filter(function (c) { return c.visible !== false }).length

      return h('div', { ref: pickerRef, style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          className: 'rs-btn is-ghost' + (open ? ' is-on' : ''),
          style: { height: '28px', padding: '0 8px', fontSize: T.fs.s },
          title: '管理概览画布卡片（显示/隐藏四站与分析卡、恢复默认布局）',
          onClick: function () { setOpen(function (v) { return !v }) },
        }, '卡片 ' + visibleCount),
        open ? h('div', { className: 'rs-ov-popover' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '5px', borderBottom: '1px solid ' + wash(T.border, 55), fontSize: T.fs.xs } },
            h('span', { style: { fontWeight: 600, color: T.fg } }, '自定义概览卡片'),
            h('button', { type: 'button', className: 'rs-ov-iconbtn', onClick: function () { setOpen(false) } }, '关闭')),
          h('div', { style: { maxHeight: 'min(420px, 65vh)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' } },
            cards.map(function (c) {
              const m = OV_CARD_META[c.type] || { title: c.id, desc: '' }
              const on = c.visible !== false
              const extraTag = !isCoreOvCardId(c.id) ? '（副本）' : ''
              return h('div', {
                key: 'pk-' + c.id, className: 'rs-ov-dir-row',
                style: { justifyContent: 'space-between', padding: '4px 6px' },
                onClick: function () { props.onToggleCard && props.onToggleCard(c.id) },
              },
                h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('span', { style: { color: on ? T.fg : T.muted, fontWeight: on ? 500 : 400 } }, m.title + extraTag),
                  m.desc ? h('span', { style: { fontSize: '10px', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.desc) : null),
                h('span', { style: { color: on ? T.accent : T.muted, fontWeight: 600, flex: '0 0 auto' } }, on ? '✓' : '＋'))
            })),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', paddingTop: '6px', borderTop: '1px solid ' + wash(T.border, 55), fontSize: T.fs.xs, color: T.muted } },
            h('span', null, '已显示 ' + visibleCount + ' / ' + cards.length + ' 张'),
            h('button', { type: 'button', className: 'rs-ov-iconbtn', onClick: function () { props.onReset && props.onReset(); setOpen(false) } }, '恢复默认'))) : null)
    }
