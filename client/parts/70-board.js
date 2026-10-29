/**
 * 70-board.js：榜单页：BoardTab（选择器、详情、操作条、本榜设置、日期回看）。依赖 20/55。不要放 Panel。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    /**
     * 第六步（0.5.2）：榜单表头的排序 / 行键盘用的纯函数。
     * 只消费宿主已经给出的 columns / sortOptions，不做客户端排序，也不新增排序方式。
     */
    const sortableCols = function (cols, sortOptions, defKey, defDir) {
      const values = (sortOptions || []).map(function (o) { return o && o.value }).filter(function (v) { return !!v })
      return (cols || []).filter(function (c) {
        return c && (values.indexOf(c.key) >= 0 || (!!defKey && c.key === defKey))
      }).map(function (c) {
        return { key: c.key, dir: c.key === defKey ? (defDir || 'descending') : 'descending' }
      })
    }
    const nextSort = function (cur, key, defKey) {
      if (key === defKey) return ''
      return cur === key ? '' : key
    }
    const normalizeSortPref = function (v) { return v === 'rank' ? '' : (v || '') }
    /** 只给行号，详情行不参与；n 是数据行数量 */
    const nextRowIdx = function (i, key, n) {
      const last = Math.max(0, Number(n) - 1)
      if (key === 'ArrowDown') return Math.min(last, i + 1)
      if (key === 'ArrowUp') return Math.max(0, i - 1)
      if (key === 'Home') return 0
      if (key === 'End') return last
      return null
    }
    const isRowControl = function (t) {
      if (!t || !t.tagName) return false
      const tag = String(t.tagName).toLowerCase()
      if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (t.isContentEditable === true) return true
      return !!(t.closest && t.closest('a,button,input,textarea,select,[contenteditable="true"]'))
    }
    const copyLink = function (url) {
      const text = url || ''
      const fail = function () { toast('warn', '复制链接失败，请手动复制：' + (text || '—')) }
      if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        fail(); return
      }
      try {
        navigator.clipboard.writeText(text).then(function () { toast('success', '已复制链接') }).catch(fail)
      } catch (e) { fail() }
    }
    /**
     * 0.6 收尾：榜单行简介（起点榜单页 pageContext 里自带 desc，落盘在 extra.desc）。
     * 纯函数便于单测：去掉每行首尾空白（含全角空格 U+3000）与空行，段落之间保留单个换行。
     * 空值/只有空白 ⇒ 返回 '' ⇒ 调用方**什么都不渲染**（不显示「—」）。
     */
    const cleanDesc = function (raw) {
      if (raw == null) return ''
      const lines = String(raw).replace(/\u3000/g, ' ').split(/\r?\n/).map(function (x) { return x.trim() }).filter(function (x) { return !!x })
      return lines.join('\n')
    }
    /**
     * 简介块：默认 3 行（-webkit-line-clamp），**真的被截断时**才给「展开 / 收起」。没有简介就不渲染。
     * ★ 2026-10-29：换成「实测溢出」判断（scrollHeight > clientHeight），窗口尺寸变化时重新量 ——
     *   原来按字数猜（>60 字就给按钮），900 宽下简介只占两行、根本没截断也照样出按钮。
     */
    function BoardDesc(props) {
      const [open, setOpen] = React.useState(false)
      const [over, setOver] = React.useState(false)
      const textRef = React.useRef(null)
      const text = cleanDesc(props.text)
      React.useEffect(function () {
        if (!text) return undefined
        const measure = function () {
          const el = textRef.current
          if (!el) return
          // 收起态才量得出「被截断」；展开态下 scrollHeight == clientHeight
          setOver(el.scrollHeight - el.clientHeight > 1)
        }
        measure()
        // 字体/宽度变化都会改变行数：窗口 resize 与面板宽度变化都重量一次
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
        return function () {
          if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure)
        }
      }, [text, open])
      if (!text) return null
      return h('div', { style: { marginTop: '4px' } },
        h('div', {
          ref: textRef,
          style: open
            ? { ...C.muted, whiteSpace: 'pre-line', lineHeight: 1.5 }
            : { ...C.muted, whiteSpace: 'pre-line', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
        }, text),
        (over || open)
          ? h('button', { className: 'rs-btn is-ghost', style: { marginTop: '2px' }, onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); setOpen(!open) } }, open ? '收起简介' : '展开简介')
          : null)
    }

    // 离线测试缝：只暴露第六步的纯函数，不改变运行路径
    window.__rankScanBoardTableTest = { sortableCols: sortableCols, nextSort: nextSort, nextRowIdx: nextRowIdx, normalizeSortPref: normalizeSortPref }

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
      const sortPref = function (board) {
        const raw = sel.pref(board, 'sort')
        const v = normalizeSortPref(raw)
        if (v !== raw) sel.setPref(board, 'sort', v)
        return v
      }
      const [bt, setBt] = React.useState(function () { return sel.get().board })
      const [sd, setSd] = React.useState(function () { return sel.pref(sel.get().board, 'date') })
      const [ss, setSs] = React.useState(function () { return sortPref(sel.get().board) })
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [pick, setPick] = React.useState(null)
      const [depth, setDepth] = React.useState('')
      const [info, setInfo] = React.useState({ max: 100, can: true, hint: '' })
      const [busy, setBusy] = React.useState(false)
      const [scanning, setScanning] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [qDate, setQDate] = React.useState('')
      const [dayOpen, setDayOpen] = React.useState(false)
      /**
       * ★ Spec A/B（2026-10-24 审查）：
       *   · loadNonce —— 即使 sd/ss 本来就是空的，「回到最新」也必须真的重发一次 GET；
       *   · directQ   —— 直查视图是**站点历史**，不是本地快照：它有自己的元数据，
       *                  也不能被本地快照的修订号静默替换掉。
       */
      const [loadNonce, setLoadNonce] = React.useState(0)
      const [directQ, setDirectQ] = React.useState(null)
      const skipAutoKey = React.useRef('')
      // 读取序号：只有最后一次发起的请求允许写界面（防旧响应覆盖）
      const loadSeqRef = React.useRef(0)
      const catSeqRef = React.useRef(0)
      const listRef = React.useRef(null)
      const sortJumpRef = React.useRef(false)
      const pickIdxRef = React.useRef(null)
      const focusBackRef = React.useRef(null)
      const curSite = stSite || (sites[0] && sites[0].site)
      const curBoards = ((sites.filter(function (s) { return s.site === curSite })[0] || {}).boards) || []
      const curBoard = bt || (curBoards[0] && curBoards[0].boardId)
      const isDerived = String(curBoard || '').indexOf('fanqie.derived.') === 0
      const colKeys = ((data && data.columns) || []).map(function (c) { return c.key })
      const sortOpts = ((data && data.sortOptions) || [{ value: '', label: '默认' }, { value: 'rank', label: '名次' }])
        .filter(function (o) { return !o.value || o.value === 'rank' || colKeys.indexOf(o.value) >= 0 })
      // 日期下拉只用**这个榜自己**有快照的日期（/board 回的 data.dates）
      const allDates = (data && data.dates && data.dates.length ? data.dates : [])
      /**
       * ★ 2026-10-25（批次榜）：下拉换成「批」。
       *   刺猬猫首订一期跨 7 个数据日、内容雷同 ⇒ 按日期列会重复 7 次；
       *   起点图首订一天一批，标签写「上架日」比写数据日期准确。
       *   选项 value 仍是**代表快照日**，宿主按它取快照（协议不变）。
       */
      const periods = (data && data.periods) || []
      const batchShown = !!(data && data.batch)
      const dateOpts = batchShown
        ? [{ value: '', label: '最新一批' }].concat(periods.slice().reverse().map(function (p) {
            return { value: p.date, label: (p.label || p.date) + (p.untrusted ? '（不可信）' : '') }
          }))
        : [{ value: '', label: '最新' }].concat(allDates.slice().reverse().map(function (d) { return { value: d, label: d } }))
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
          setData(d); setDirectQ(null); setErr(null); if (!silent) setPick(null)
        })
          // 读失败**保留现有列表**，只在上方报错（不能清空界面伪装成「没有条目」）
          .catch(function (e) { if (my !== loadSeqRef.current) return; setErr(String(e)) })
      }, [curBoard, sd, ss, loadNonce])
      React.useEffect(function () {
        const key = [curBoard, sd, ss].join('|')
        const skip = skipAutoKey.current === key
        skipAutoKey.current = ''
        if (!skip) reloadBoard(false)
      }, [reloadBoard])
      // 同日重扫：修订号变了就静默重读一次（不动站/榜/日期/排序/详情）
      const revRef = React.useRef(null)
      React.useEffect(function () {
        const rev = props.rev || ''
        if (revRef.current === null) { revRef.current = rev; return }
        if (rev !== revRef.current) {
          revRef.current = rev
          // 正在看站点历史时，本地快照变了不能把它悄悄换成「最新」（否则横幅没了、行也换了）
          if (!directQ) reloadBoard(true)
        }
      }, [props.rev, reloadBoard, directQ])
      /**
       * B4：站 / 榜 / 日期 / 排序改成「小标签在上、控件在下」的网格单元。
       *   旧实现是 label + select 横排一行 ⇒ 480 宽时「排序」被挤到下一行，看着像掉了一格。
       *   span=2 给榜（榜名最长），其余各占一格；窄屏时自动变成一行两个。
       */
      const selXS = function (label, value, options, onChange, span) {
        return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, gridColumn: span ? 'span ' + span : undefined } },
          h('span', { style: C.sectionLabel }, label),
          h('select', { value: value, onChange: function (e) { onChange(e.target.value) }, style: { ...C.input, width: '100%' } },
            options.map(function (o) { return h('option', { key: o.value, value: o.value }, o.label) })))
      }
      const pickBoard = function (v) { sel.set({ board: v }); setBt(v); setSd(sel.pref(v, 'date')); setSs(sortPref(v)); setPick(null); setDayOpen(false) }
      const pickSite = function (v) { sel.set({ site: v, board: null }); setStSite(v); setBt(null); setSd(''); setSs(''); setPick(null); setDayOpen(false) }
      const pickDate = function (v) { setSd(v); sel.setPref(curBoard, 'date', v) }
      /** 「按上架日回看…」是动作项，不是日期值：不改当前选择，只在下面展开输入行 */
      const pickDateSel = function (v) {
        if (v === '__day') { setDayOpen(true); return }
        setDayOpen(false)
        pickDate(v)
      }
      const pickSort = function (v) {
        if (v === ss) return
        setSs(v)
        sel.setPref(curBoard, 'sort', v)
        setPick(null)          // 换排序 ⇒ 收起详情，避免详情还停在旧行
        pickIdxRef.current = null
        sortJumpRef.current = true
      }
      const closeDetail = function () {
        const idx = pickIdxRef.current
        setPick(null)
        if (idx != null) focusBackRef.current = idx
      }
      const toggleRow = function (r, i) {
        const opening = !(pick && pick.key === r.key)
        pickIdxRef.current = i
        if (!opening) focusBackRef.current = null
        setPick(opening ? r : null)
      }
      const onRowsKeyDown = function (e) {
        if (!e) return
        if (isRowControl(e.target)) return
        const row = e.target && e.target.closest ? e.target.closest('[data-row-idx]') : null
        if (!row || !e.currentTarget || !e.currentTarget.querySelectorAll) return
        const rows = e.currentTarget.querySelectorAll('[data-row-idx]')
        const i = Number(row.getAttribute('data-row-idx'))
        const next = nextRowIdx(i, e.key, rows.length)
        if (next == null) return
        e.preventDefault()
        const el = rows[next]
        if (!el) return
        try { el.focus({ preventScroll: true }) } catch (err) { try { el.focus() } catch (e2) {} }
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
      }
      React.useEffect(function () {
        if (!sortJumpRef.current) return
        sortJumpRef.current = false
        const el = listRef.current
        if (el && el.scrollIntoView) {
          try { el.scrollIntoView({ block: 'start' }) } catch (e) {}
        }
      }, [ss])
      React.useEffect(function () {
        if (pick || focusBackRef.current == null) return
        const idx = focusBackRef.current
        focusBackRef.current = null
        const el = listRef.current && listRef.current.querySelector('[data-row-idx="' + idx + '"]')
        if (!el) return
        try { el.focus({ preventScroll: true }) } catch (e) { try { el.focus() } catch (e2) {} }
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
      }, [pick])
      /** 只保存条数（**不采集**）；另有一个明确的「保存并扫描本榜」 */
      const saveDepth = function (alsoScan) {
        const n = Math.max(1, Math.min(info.max || 100, Number(depth) || 10))
        setBusy(true)
        setNote('正在保存每榜取数 ' + n + ' 条…')
        jpost('/depth', { boardId: curBoard, depth: n })
          .then(function (r) {
            setNote(null)
            toast('success', (r && r.note) || ('已保存：每榜取 ' + n + ' 条'))
            if (!alsoScan) return null
            setScanning(true)
            if (props.onScanStart) props.onScanStart()
            setNote('已保存 ' + n + ' 条，正在扫描本榜…')
            return jpost('/scan', { boards: curBoard }).then(function (rr) {
              const got = ((rr && rr.boards) || []).map(function (x) { return x.boardId + ' ' + x.rows + ' 条' }).join('')
              setNote(null)
              toast('success', '已保存并扫描：' + (got || '完成'))
              reloadBoard(true)
              if (props.onScanned) props.onScanned()
            }).catch(function (e2) {
              // ★ 保存成功、采集失败要**分开说**，否则用户会以为设置没存住、反复点
              setNote(null)
              if (isScanBusyError(e2)) toast('warn', '已有扫描在进行，请等它跑完')
              else toast('error', '条数已保存，但扫描失败：' + e2 + '（可稍后重试扫描）')
            }).then(function () { if (props.onScanEnd) props.onScanEnd() })
          })
          .catch(function (e) { setNote(null); toast('error', '保存失败：' + e) })
          .then(function () { setScanning(false); setBusy(false) })
      }
      /** 409 = 已有扫描（host 互斥）：不是错误，用 warn 提醒等一下 */
      const isScanBusyError = function (e) {
        return !!(e && (e.status === 409 || e.code === 'scan_in_flight' || /409|已有扫描/.test(String(e))))
      }
      const toastScanError = function (e) {
        setNote(null)
        if (isScanBusyError(e)) { toast('warn', '已有扫描在进行，请等它跑完'); return }
        toast('error', '扫描失败：' + e)
      }
      const scanBoard = function () {
        if (props.scanBusy || busy) return
        if (props.onScanStart) props.onScanStart()
        setBusy(true)
        setScanning(true)
        setNote('正在扫描本榜…')
        jpost('/scan', { boards: curBoard })
          .then(function (rr) {
            const b0 = ((rr && rr.boards) || [])[0]
            setNote(null)
            toast('success', b0 ? '已扫描：' + b0.boardId + ' ' + b0.rows + ' 条' : '已扫描')
            reloadBoard(true)
            if (props.onScanned) props.onScanned()
          })
          .catch(function (e) { toastScanError(e) })
          .then(function () { if (props.onScanEnd) props.onScanEnd(); setScanning(false); setBusy(false) })
      }
      const doEnrich = function () {
        setBusy(true)
        setNote('补全中（逐本请求 + ' + fmtIntervalText() + '，可能要几十秒）…')
        jpost('/enrich?boardId=' + encodeURIComponent(curBoard)).then(function (r) {
          setNote(null)
          toast('success', r && r.note ? r.note : '补全完成')
          return reloadBoard(true)
        }).catch(function (e) { setNote(null); toast('error', '补全失败：' + e) }).then(function () { setBusy(false) })
      }
      /**
       * 按日期回看：只在**支持核对的榜**出现（能力驱动）。
       * 首订榜的站点口径是 n-1（上架 24 小时后才结算），所以「上架日」与「数据日期」不是一回事，
       * 这里把两者分开写，不让用户以为选的是同一个日子。
       */
      const queryDay = function (save) {
        if (!qDate) { toast('warn', '先选上架日'); return }
        // ★ 上架日 X ⇒ 数据日期 X+1（首订按 n-1 锚；适配器 contentDateFor(数据日) = 数据日-1）
        const dDate = addDaysStr(qDate, 1)
        if (!dDate) { toast('warn', '日期格式不对：应为 YYYY-MM-DD'); return }
        const my = ++loadSeqRef.current
        setBusy(true)
        setNote((save ? '抓取' : '查看') + '上架日 ' + qDate + '（数据日期 ' + dDate + '）…')
        jpost('/day', { boardId: curBoard, date: dDate, save: !!save }).then(function (r) {
          if (my !== loadSeqRef.current) return null
          if (r && (r.ok === false || r.code)) {
            setNote(null)
            toast('warn', '已拒绝：' + (r.error || '站点给不出这一天可核对的数据'))
            return null
          }
          const shown = (r && r.date) || dDate
          setNote(null)
          toast('success', r && r.note ? r.note : (save ? '已抓取：上架日 ' + qDate + ' 存为数据日期 ' + dDate + ' 的快照' : '已查看（未落盘）'))
          if (save) { setDirectQ(null); setSd(shown); sel.setPref(curBoard, 'date', shown); setLoadNonce(function (n) { return n + 1 }); return null }
          /**
           * ★ Spec B（2026-10-24）：直查视图是一份**独立**数据。
           *   旧实现用 { ...prev } 合并 ⇒ 沿用上一视图的 baselineDate / counts / enrich / fallbackFrom，
           *   于是出现「数据日期 10-19 · 对比 10-21」（基准晚于数据日）却变化列全「—」。
           *   现在显式给全自己的元数据，没基准就明说「无可比基准」。
           */
          const prev = data || {}
          const ds = (prev.dates || []).slice()
          if (ds.indexOf(shown) < 0) ds.push(shown)
          ds.sort()
          // Skip only the local read caused by clearing this query's sort.
          if (ss) skipAutoKey.current = [curBoard, sd, ''].join('|')
          setSs('')
          setPick(null)
          setData({
            boardId: curBoard,
            columns: prev.columns || [],
            sortOptions: prev.sortOptions || [],
            defaultSortKey: (r && r.defaultSortKey) || null,
            rows: (r.rowsAll || []).map(function (x) { return { ...x, delta: null, days: null } }),
            dates: ds,
            dataDate: shown,
            baselineDate: null,
            counts: null,
            crossPeriod: false,
            enrich: null,
            fallbackFrom: null,
            requestedDate: null,
            source: '站点直查（未落盘）',
            note: '直查站点 ' + shown + (r.contentDate && r.contentDate !== shown ? '（站点内容日期 ' + r.contentDate + '）' : ''),
            _queryDate: shown,
            _contentDate: (r && r.contentDate) || null,
          })
          setDirectQ({ date: shown })
        }).catch(function (e) { setNote(null); toast('error', '直查失败：' + e) }).then(function () { setBusy(false) })
      }
      // Esc：先关详情卡（面板本身由 Panel 那层关）
      useEscLayer(pick ? function () { closeDetail(); return true } : null)
      /** 状态带：一行说清「你在看哪份数据、跟哪天比」 */
      const band = (function () {
        if (!data) return null
        const bits = []
        /**
         * ★ 2026-10-25（批次榜）：这一屏是「第 479 期 / 上架日 2026-10-24」，
         *   不是「10-25 的榜 · 对比 10-23」——批次榜不比较变化，写日期只会误导。
         */
        if (data.batch) {
          const bt = data.batch
          bits.push(bt.label || (bt.key ? String(bt.key) : '批次未知'))
          if (bt.kind === 'issue' && bt.saleStart) bits.push('上架 ' + bt.saleStart + (bt.saleEnd && bt.saleEnd !== bt.saleStart ? ' ~ ' + bt.saleEnd : ''))
          bits.push('共 ' + (bt.count == null ? '—' : bt.count) + ' 本')
          if (bt.snapshotDate) bits.push('快照 ' + bt.snapshotDate)
          bits.push('批次榜：整批换新，不比较变化')
          return bits.join(' · ')
        }
        const src = data._contentDate || (data.rows && data.rows[0] && data.rows[0].extra && data.rows[0].extra.showDate) || null
        bits.push('数据日期 ' + (data.dataDate || '—'))
        // 首订是 n-1 口径：直查时「内容日期（上架日）」与「数据日期」必须分开写清楚
        if (src && src !== data.dataDate) bits.push((data._queryDate ? '内容日期 ' : '源数据 ') + src)
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
      const canDay = canDayQuery(curBoard)
      const dateOptsShown = canDay ? dateOpts.concat([{ value: '__day', label: '按上架日回看…' }]) : dateOpts
      // 减掉正文左右 padding（20）、纵向滚动条与一点余量 ⇒ 表格不会溢出成横向滚动
      const cols = fitColumns(data && data.columns, avail - 48)
      const defaultSort = (data && data.defaultSortKey && data.defaultSortKey.key)
        ? data.defaultSortKey
        : { key: 'rank', dir: 'ascending' }
      const sortable = sortableCols(cols, sortOpts, defaultSort.key, defaultSort.dir)
      const sortableMap = {}
      sortable.forEach(function (c) { sortableMap[c.key] = c.dir })
      const viewDate = (data && (data._queryDate || sd)) || ''
      /* 0.4.2：本榜操作不再进「更多」——扫描/补全在操作条，条数在「本榜设置」，回看在日期行。 */
      /**
       * ★ 2026-10-23（窄面板「作品只显示书名前面的信息，后面一大片空白」）：
       *   以前窄的时候是把次级列**整列删掉**、再让表格 width:100% 铺满 ⇒ 每行只剩名次 + 书名，
       *   右半张桌子全空，被删掉的指标也没有别处可看。窄的时候改成**卡片行**：
       *   第一行 名次 · 书名 · 作者 · 星标；第二行把这一榜要看的指标做成 chip（放不下自动换行）。
       */
      const CHIP_SKIP = { title: 1, rank: 1, author: 1, cat: 1, subCat: 1, days: 1 }
      /**
       * 0.6 收尾：卡片第二行的中点串除了「按列序前 6 个」，还要**保证新补的四列在**里
       *   （它们在列序里靠后，光靠 slice(0,6) 会被切掉）；空值仍由渲染处跳过。
       */
      const CHIP_ALWAYS = { shouding: 1, firstDay: 1, firstV: 1 }
      const chipCols = (function () {
        const all = ((data && data.columns) || []).filter(function (c) { return !CHIP_SKIP[c.key] })
        const head = all.slice(0, 6)
        const extra = all.filter(function (c) { return CHIP_ALWAYS[c.key] && head.indexOf(c) < 0 })
        return head.concat(extra)
      })()
      /** 该行是否正展开详情 */
      /**
       * ★ Spec C（2026-10-24 审查）：窄窗/装列时被收起的列必须**显式可展开**。
       *   旧实现把列从表格里丢掉就没有任何入口（起点的分类/子分类、在榜天数、三江第 7 列起的逐日
       *   增量只能靠拉宽面板看）。这里算出「当前视图没显示的列」，在行详情里用**同一套 cell 渲染器**
       *   补全 —— 不截断真实字段，也不改现有列宽/收起策略。
       */
      const SUMMARY_COLS = { title: 1, rank: 1, author: 1, words: 1 }
      const shownColKeys = (function () {
        const m = {}
        if (cards) {
          m.title = 1; m.rank = 1; m.author = 1
          chipCols.forEach(function (c) { m[c.key] = 1 })
        } else {
          cols.forEach(function (c) { m[c.key] = 1 })
        }
        return m
      })()
      const detailCols = ((data && data.columns) || []).filter(function (c) {
        return !shownColKeys[c.key] && !SUMMARY_COLS[c.key]
      })
      /**
       * 0.6 收尾（修假设置）：起点移动端榜单是**站点单页固定 20 条**，depth 对它不生效
       *   （适配器写死 BOARD_PAGE_ROWS = 20，而 catalog 仍报 canDepth:true）。
       *   这里按 boardId **客户端置灰**并写清原因；config 里的旧值保留不动（只是不再允许修改）。
       *   宿主的 catalog 校验留待 0.7（见交接）。
       */
      const qidianFixed = /^qidian\./.test(String(curBoard || ''))
      /**
       * ★ 0.6.2：条数只对**适配器真读 depth** 的榜开放（宿主 catalog 的 canDepth 已经按口径算好）。
       *   派生榜再单独标一次：它连「扫本榜」都没意义（本地按快照算、0 请求）。
       */
      const derivedBoard = isDerived
      const fixedDepth = qidianFixed ? 20 : null
      const depthLocked = qidianFixed || derivedBoard || info.can === false
      const depthNote = qidianFixed
        ? '站点固定 20 条（移动端单页 20 条，站点分页接口在反爬后）'
        : (info.hint || '该榜条数由站点/口径决定，不可调')
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
          // ★ 0.6.1（使用者 2026-10-29「统一去掉」）：详情卡也不再显示「更新 …」——
          //   它和榜单列的「更新时间」是同一个字段（番茄 `lastChapterUpdateTime`），留着就还是不一致。
          // 简介：只有真有 desc 的行才渲染（没有就整块不出现，不显示「—」）
          h(BoardDesc, { text: ex.desc }),
          // 被当前宽度收起的列：在这里逐条列出（label + 与表格完全相同的渲染）
          detailCols.length ? h('div', { style: { marginTop: '3px' } }, detailCols.map(function (c) {
            return h('div', { key: 'dx-' + c.key, style: C.muted }, c.label + '：', cell(rowCellProps(r, c), r))
          })) : null,
          /**
           * 0.6.0 修：星标原来与备注表单挤在同一个 C.row 里，会「悬」在表单盒子外面左侧；
           *   现在星标与表单进同一列（星标贴左、表单占满其余宽度），表单本身也不再自套底色盒子。
           */
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '4px' } },
            h(BookmarkStar, { bookKey: bookKeyOf(curBoard, r.key), row: r, boardId: curBoard, dataDate: data && data.dataDate }),
            h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
              h(DetailBookmarkEditor, { bookKey: bookKeyOf(curBoard, r.key) }),
              h('div', { style: { ...C.row, marginTop: '2px' } },
                h('button', { className: 'rs-btn', onClick: function (e) { e.stopPropagation(); if (props.openLink) props.openLink(r.url); else window.open(r.url, '_blank', 'noopener,noreferrer') } }, '在 DSH 侧栏浏览器打开'),
                h('button', { className: 'rs-btn', onClick: function (e) { e.stopPropagation(); copyLink(r.url) } }, '复制链接'),
                h('a', { href: r.url || '#', target: '_blank', rel: 'noreferrer', className: 'rs-link-action', style: { color: 'inherit', padding: '3px 8px' }, onClick: function (e) { e.stopPropagation() } }, '新标签打开'),
                h('button', { className: 'rs-btn is-ghost', style: { marginLeft: 'auto' }, onClick: function (e) { e.stopPropagation(); closeDetail() } }, '关闭')))),
          ex.qidiantuUrl || ex.sourceUrl
            ? h('div', { style: C.row },
                (ex.qidiantuUrl ? h('button', { className: 'rs-btn', onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(ex.qidiantuUrl) } }, '看起点图原始页') : null),
                (ex.sourceUrl ? h('button', { className: 'rs-btn', onClick: function (e) { e.stopPropagation(); (props.openLink || window.open)(ex.sourceUrl) } }, '看原数据来源页') : null),
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
        /**
         * B7：卡片第二行不再是一堆带底色的 chip，改成「终点串 + 中点分隔」的元信息；
         *   涨跌仍由 cell 自己带色（C.up / C.down），所以颜色语义没丢。
         */
        const chips = chipCols.map(function (c) {
          const v = cell(rowCellProps(r, c), r)
          if (v === '—' || v === null || v === undefined || v === '') return null
          return h('span', { key: 'c' + c.key, style: { whiteSpace: 'nowrap' }, title: c.note || c.label },
            h('span', null, c.label + ' '), v)
        }).filter(Boolean)
        const metaLine = []
        chips.forEach(function (b, k) {
          if (k) metaLine.push(metaDot('sep' + k))
          metaLine.push(b)
        })
        return h('div', {
          key: r.key || ('row' + i),
          tabIndex: 0,
          'data-row-idx': i,
          'aria-expanded': open ? 'true' : 'false',
          /**
           * ★ 0.6.0 修（暗色「亮白粗边框」的真因）：以前写的是
           *     borderColor: open ? T.border : undefined
           *   React 会把 undefined 落成 style.borderColor = ''，这一下会把 C.card 的
           *   border 长写整条清空，边框退回 currentColor —— 暗色下就是近白色的一圈亮边
           *   （看着像焦点环，其实不是）。现在只在需要时整体替换 style，绝不把颜色设成空串。
           */
          style: open
            ? { ...C.card, padding: '5px 8px', margin: '5px 0', cursor: 'pointer', background: T.subtle, boxShadow: 'inset 3px 0 0 ' + T.accent }
            : { ...C.card, padding: '5px 8px', margin: '5px 0', cursor: 'pointer' },
          onClick: function () { toggleRow(r, i) },
          onKeyDown: function (e) {
            if (!e || isRowControl(e.target)) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(r, i) }
          },
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
          chips.length ? h('div', { style: { ...C.meta, display: 'flex', flexWrap: 'nowrap', overflow: 'hidden', marginTop: '2px' } }, metaLine) : null)
      }
      return h('div', null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', alignItems: 'end', margin: '4px 0' } },
          selXS('站', curSite || '', sites.map(function (s) { return { value: s.site, label: s.siteName } }), pickSite, 1),
          selXS('榜', curBoard || '', curBoards.map(function (b) { return { value: b.boardId, label: b.name } }), pickBoard, 2),
          isDerived ? null : selXS('日期', sd, dateOptsShown, pickDateSel, 1),
          selXS('排序', ss, sortOpts, pickSort, 1)),
        dayOpen && canDay ? h('div', { style: { ...C.row, marginTop: '2px', flexWrap: 'wrap' } },
          h('span', { style: C.muted }, '上架日'),
          h('input', { type: 'date', value: qDate, onChange: function (e) { setQDate(e.target.value) }, style: { ...C.input, width: 'auto' } }),
          h('button', { className: 'rs-btn', disabled: busy || !qDate, onClick: function () { queryDay(false) }, title: '直查站点这一上架日的数据（联网，不落盘）' }, '查看'),
          h('button', { className: 'rs-btn', disabled: busy || !qDate, onClick: function () { queryDay(true) }, title: '抓取该上架日并存为本地快照（联网）' }, '存入本地'),
          h('button', { className: 'rs-btn is-ghost', onClick: function () { setDayOpen(false) } }, '收起'),
          h('div', { style: { ...C.muted, flex: '1 1 100%' } }, '首订按 n-1 锚：选上架日 X ⇒ 请求数据日期 X+1（页面内容日期就是 X）；保存后快照记在 X+1 名下。站点给的日期对不上会被拒绝，不写任何文件。')) : null,
        h('div', { style: { ...C.row, marginTop: '4px', flexWrap: 'wrap' } },
          // ★ 0.6.2：派生榜不发请求（本地按快照算），「扫描本榜」对它点了只会得到一条警告 ⇒ 直接不出现
          isDerived ? null : h('button', {
            className: 'rs-btn',
            disabled: props.scanBusy || busy,
            onClick: scanBoard,
            title: props.scanBusy ? '全局扫描进行中；请到概览点「停止本次」后再扫本榜' : '只抓当前这一榜，不动其它榜（联网）',
          }, scanning ? '扫描本榜中…' : (props.scanBusy ? '全局扫描进行中…' : '扫描本榜（联网）')),
          enrichMissing ? h('button', { className: 'rs-btn', disabled: busy || props.scanBusy, onClick: doEnrich, title: '补全当前榜缺失字段（联网：逐本进书页取，可能走缓存）' }, '补全缺失 ' + enrichMissing + ' 条') : null,
          // 派生榜连扫描按钮都没有 ⇒ 这行说明也别留着（否则在讲一个不存在的按钮）
          isDerived ? null : h('span', { style: { ...C.meta, flex: '1 1 auto' } }, '只抓当前这一榜；全局扫描/停止在概览')),
        enrichMissing ? h(Banner, { tone: 'warn', live: false },
          h('span', null, '补全未完成：还缺 ' + enrichMissing + ' 条字段'),
          h('span', { style: C.muted }, '（榜页没给收藏/字数，要进书页取；点上面的「补全缺失」重试，或等定时续跑）')) : null,
        h(Section, { title: '本榜设置', defaultOpen: false, summary: derivedBoard
          ? '全部 ' + ((data && data.rows) ? data.rows.length : 0) + ' 条（本地派生榜不设条数）'
          : fixedDepth != null
            ? '每榜 ' + fixedDepth + ' 条（站点固定）'
            : depthLocked
              ? depthNote
              : '每榜 ' + (depth || info.max || '—') + ' 条（上限 ' + (info.max || '—') + '）' },
          h('div', { style: { ...C.row, flexWrap: 'wrap' } },
            h('span', { style: C.muted }, '每榜取多少条'),
            h('input', {
              type: 'number', min: 1, max: info.max,
              value: derivedBoard ? '' : (fixedDepth != null ? String(fixedDepth) : depth),
              placeholder: derivedBoard ? '全部' : String(fixedDepth != null ? fixedDepth : info.max),
              disabled: depthLocked || busy,
              title: depthNote, onChange: function (e) { setDepth(e.target.value) },
              style: { ...C.input, width: '58px' },
            }),
            h('span', { style: C.muted }, depthLocked ? '条 · ' + depthNote : '条（上限 ' + info.max + '）'),
            // ★ 0.6.2：条数不可调时两个按钮都不给 —— 改了也不生效，而扫描入口本来就在上面的操作条
            //   （「扫描本榜（联网）」对所有榜都在，派生榜也不例外；派生榜实际不发请求，由宿主给说明）。
            depthLocked ? null : h('button', { className: 'rs-btn', disabled: busy, onClick: function () { saveDepth(false) }, title: '只保存，下次扫描生效' }, '保存'),
            depthLocked ? null : h('button', { className: 'rs-btn', disabled: busy || props.scanBusy, onClick: function () { saveDepth(true) }, title: '保存后立刻抓一次这一榜（联网）' }, '保存并扫描本榜')),
          !depthLocked && info.hint ? h('div', { style: C.muted }, info.hint) : null),
        band ? h('div', { style: { ...C.sectionLabel, whiteSpace: 'normal', marginTop: '8px', marginBottom: '8px' } }, band) : null,
        viewDate ? h(Banner, { tone: 'warn' },
          h('span', { style: { fontWeight: 600 } }, '正在查看历史：' + viewDate),
          h('span', { style: C.muted }, data && data._queryDate ? '（直查站点，未落盘）' : '（本地快照）'),
          /**
           * ★ Spec A（2026-10-24）：旧实现只清 sd/ss 并 setData(null)。
           *   sd/ss 本来就是空的时候依赖没变化 ⇒ 一次 GET 都不发，列表永久停在「加载中…」。
           *   现在显式清直查视图 + 清本地日期偏好 + 递增 nonce ⇒ **一定**重发一次无 date 的 GET。
           */
          h('button', {
            className: 'rs-btn',
            onClick: function () {
              setSs('')
              setSd('')
              sel.setPref(curBoard, 'date', '')
              setDirectQ(null)
              setPick(null)
              setLoadNonce(function (n) { return n + 1 })
            },
          }, '回到最新')) : null,
        data && data.fallbackFrom ? h('div', { style: C.muted }, '当天（' + data.requestedDate + '）没有快照 ⇒ 回落到 ' + data.fallbackFrom) : null,
        data && data.source ? h('div', { style: C.muted }, '来源：' + data.source) : null,
        err ? h('div', { style: { ...C.row, color: T.bad } },
          h('span', null, '⚠ 读取失败：' + String(err).slice(0, 120)),
          h('button', { className: 'rs-btn', onClick: function () { reloadBoard(false) } }, '重试')) : null,
        note ? h('div', { style: C.muted }, note) : null,
        data && data.rows && data.rows.length
          ? (cards
              ? h('div', { ref: listRef, onKeyDown: onRowsKeyDown }, data.rows.map(function (r, i) {
                  // 卡片行 + 展开时紧跟其后的详情卡（详情别再挂到列表末尾）
                  return h('div', { key: 'w' + (r.key || i) }, narrowRow(r, i), isOpen(r) ? detailCard(r) : null)
                }))
              : h('table', { ref: listRef, style: C.table },
              h('thead', null, h('tr', null, cols.map(function (c) {
                const dir = sortableMap[c.key]
                const active = (ss || defaultSort.key) === c.key
                const shownDir = active ? (ss ? dir : defaultSort.dir) : dir
                const numCol = isNumCol(c.key)
                const arrow = h('span', { className: 'rs-sort-arrow' + (active ? ' is-on' : ''), 'aria-hidden': 'true' }, shownDir === 'ascending' ? '↑' : '↓')
                return h('th', {
                  key: c.key, style: numCol ? { ...C.th, textAlign: 'right' } : C.th, title: c.note || '',
                  'aria-sort': active ? shownDir : undefined,
                }, dir
                  ? h('button', {
                      className: 'rs-th-sort' + (numCol ? ' is-num' : ''),
                      title: active && !ss ? '当前为默认排序' : active ? '取消按 ' + c.label + ' 排序' : '按 ' + c.label + ' 排序',
                      onClick: function (e) { e.stopPropagation(); pickSort(nextSort(ss, c.key, defaultSort.key)) },
                    }, numCol ? [arrow, c.label] : [c.label, arrow])
                  : c.label)
              }))),
              h('tbody', { onKeyDown: onRowsKeyDown }, data.rows.flatMap(function (r, i) {
                const open = isOpen(r)
                const tr = h('tr', {
                  key: r.key || i,
                  tabIndex: 0,
                  'data-row-idx': i,
                  'aria-expanded': open ? 'true' : 'false',
                  style: open ? { cursor: 'pointer', background: T.subtle } : { cursor: 'pointer' },
                  onClick: function () { toggleRow(r, i) },
                  onKeyDown: function (e) {
                    if (!e || isRowControl(e.target)) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(r, i) }
                  },
                }, cols.map(function (c, ci) {
                  const baseStyle = isNumCol(c.key) ? { ...C.td, ...C.num, textAlign: 'right' } : C.td
                  const style = open && ci === 0 ? { ...baseStyle, boxShadow: 'inset 3px 0 0 ' + T.accent } : baseStyle
                  return h('td', { key: c.key, style }, cell(rowCellProps(r, c), r))
                }))
                // 详情卡作为紧跟那一行的一行（colSpan 占满），点哪一行就在哪一行下面展开
                return open
                  ? [tr, h('tr', { key: 'd' + (r.key || i) }, h('td', { colSpan: Math.max(1, cols.length), style: { padding: '0 0 4px' } }, detailCard(r)))]
                  : [tr]
              }))))
          : h('div', { style: C.muted }, data ? dash(data.note || '没有条目') : '加载中…'),
        h('details', { style: { ...C.muted, marginTop: '6px' } },
          h('summary', { style: { cursor: 'pointer' } }, '列说明'),
          h('div', { style: { marginTop: '3px' } }, '列随榜变化：该站没有的字段整列不出现；有字段但这条没抓到显示「—」（批次榜不出「变化」列）。面板变窄时列会按宽度自动收起（先收作者/分类/字数这类次级列，名次/书名与该榜主指标一直在），再窄就换成卡片行；点行看详情。')))
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
