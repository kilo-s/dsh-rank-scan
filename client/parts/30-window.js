/**
 * 30-window.js：浮窗拖拽/缩放：useWindowDrag、DragBar、ResizeHandle。依赖 10/20。不要放数据逻辑。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
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
        h('button', { className: 'rs-btn is-ghost', onClick: props.onCollapse, title: '收起面板（Esc 也可以）' }, '收起'))
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
          return h(Banner, { tone: 'error' },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', width: '100%' } },
              h('div', { style: { fontWeight: 600, flex: '1 1 100%' } }, '这个页签渲染出错了（面板其余部分仍可用）'),
              h('div', { style: { ...C.muted, wordBreak: 'break-all', flex: '1 1 320px' } }, String((this.state.err && this.state.err.message) || this.state.err)),
              h('button', { className: 'rs-btn', onClick: function () { this.setState({ err: null }) }.bind(this) }, '重试')))
        }
        return this.props.children
      }
    }

    /** 字节 → 人话（数据目录占用用；保留 1 位小数，够看趋势就行） */
