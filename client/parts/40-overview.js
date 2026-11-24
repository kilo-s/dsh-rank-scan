/**
 * 40-overview.js：概览首页主体组件 Overview（态势顶栏、按需盯盘、单书本地走势、四大平台 2×2 活卡片与单站聚焦钻取）。依赖 10/20/25/35。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    function Overview(props) {
      const ov = props.ov
      const avail = Math.max(320, Number(props.width) || (props.narrow ? 420 : 900))
      const chgNarrow = avail < 620
      const bm = bmStore.use()
      const [enrichStatus, setEnrichStatus] = React.useState(null)
      const [chg, setChg] = React.useState(null)
      const [watchData, setWatchData] = React.useState(null)
      const [trendState, setTrendState] = React.useState(null)
      const [layout, setLayout] = React.useState(function () { return normalizeOvLayout(null) })
      // 收拢 UI 交互状态到一个复合对象，减少无谓重渲染与状态槽位占用
      const [ui, setUi] = React.useState(function () {
        return {
          watchOpen: true, watchShowQuiet: false, watchShowAll: false, watchTick: 0, watchBusy: false,
          lens: 'pick', focusPid: null, focusTab: 'changes', focusGroup: '', focusLimit: 30,
          issuesOpen: true, trendPick: null, trendDays: 7, reloadTick: 0,
        }
      })
      const patchUi = function (patch) { setUi(function (prev) { return Object.assign({}, prev, patch) }) }
      const issuesRef = React.useRef(null)
      const trendRef = React.useRef(null)
      const layoutWarnedRef = React.useRef(false)
      const rev = props.rev || revOf(ov)

      React.useEffect(function () {
        if (!ov || !ov.dataDate) return undefined
        let alive = true
        jget('/changes').then(function (r) { if (alive) setChg(r) }).catch(function () { if (alive) setChg(null) })
        return function () { alive = false }
      }, [rev, ui.reloadTick])

      React.useEffect(function () {
        if (!ov) return undefined
        let alive = true
        jget('/watch-summary').then(function (r) { if (alive && r && r.ok) setWatchData(r) }).catch(function () {})
        return function () { alive = false }
      }, [rev, bm.total, ui.watchTick, ui.reloadTick])

      React.useEffect(function () {
        let alive = true
        jget('/layout').then(function (r) {
          if (alive && r && r.ok && r.layout) setLayout(normalizeOvLayout(r.layout))
        }).catch(function () {})
        return function () { alive = false }
      }, [ui.reloadTick])

      const commitLayout = function (op, a, b) {
        setLayout(function (prev) {
          const next = applyOvLayoutOp(prev, op, a, b)
          jpost('/layout', { layout: next }).catch(function (e) {
            if (!layoutWarnedRef.current) {
              layoutWarnedRef.current = true
              toast('warn', '画布布局暂未落盘（' + formatOvApiError(e) + '）')
            }
          })
          return next
        })
      }
      const ptrDrag = useOvPointerDrag(function (fromId, toId) { commitLayout('reorder', fromId, toId) })

      React.useEffect(function () {
        const tp = ui.trendPick
        if (!tp || !tp.bookKey) { setTrendState(null); return undefined }
        const ck = [tp.bookKey, tp.boardId || '', ui.trendDays, rev].join('|')
        if (BOOK_TREND_CACHE[ck]) {
          setTrendState({ key: ck, loading: false, data: BOOK_TREND_CACHE[ck] })
          return undefined
        }
        let alive = true
        setTrendState({ key: ck, loading: true, data: null })
        const q = '/book-trend?bookKey=' + encodeURIComponent(tp.bookKey)
          + (tp.boardId ? '&boardId=' + encodeURIComponent(tp.boardId) : '')
          + '&days=' + ui.trendDays
        jget(q).then(function (r) {
          if (!alive) return
          if (r && r.ok) {
            BOOK_TREND_CACHE[ck] = r
            setTrendState({ key: ck, loading: false, data: r })
          } else {
            setTrendState({ key: ck, loading: false, data: null })
          }
        }).catch(function () { if (alive) setTrendState({ key: ck, loading: false, data: null }) })
        return function () { alive = false }
      }, [ui.trendPick && ui.trendPick.bookKey, ui.trendPick && ui.trendPick.boardId, ui.trendDays, rev])

      React.useEffect(function () {
        let alive = true
        let id = null
        let wasActive = false
        const tick = function () {
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
          }).catch(function () {})
        }
        tick()
        id = setInterval(tick, 5000)
        return function () { alive = false; if (id) clearInterval(id) }
      }, [])

      const c = (ov && ov.counts) || {}
      const total = (c.ok || 0) + (c.missing || 0) + (c.stale || 0) + (c.login_required || 0) + (c.truncated || 0)
      const rows = ((ov && ov.sites) || []).flatMap(function (s) {
        return (s.boards || []).map(function (b) { return { ...b, site: b.site || s.site, siteName: s.siteName } })
      })
      rememberBoardNames(rows)

      const scan = (ov && ov.scan) || null
      const plan = (ov && ov.services && ov.services.schedule) || null
      const staleIds = plan && plan.staleFlag
        ? Object.keys(plan.staleFlag).filter(function (k) { return plan.staleFlag[k] && plan.staleFlag[k].date === (ov && ov.dataDate) })
        : []
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
        const times = (plan && plan.siteTimes) || (ov && ov.defaults && ov.defaults.siteTimes) || {}
        return times[siteOfBoardId(b.boardId)] || ''
      }
      const waitingRows = rows.filter(function (b) { return scheduleStateOf(b) === 'waiting' })
      const dueRows = rows.filter(function (b) { return scheduleStateOf(b) === 'due' })
      const badRows = rows.filter(function (b) { return b.status !== 'ok' && !scheduleStateOf(b) })
      const enrichPending = enrichStatus && typeof enrichStatus.pending === 'number' ? enrichStatus.pending : 0

      const issues = []
      badRows.forEach(function (b) {
        const why = b.status === 'missing' ? '这次没抓到'
          : b.status === 'login_required' ? '起点 cookie 失效'
          : b.status === 'truncated' ? '没抓完'
          : b.status === 'stale' ? '数据待核对' : '状态异常'
        issues.push({
          key: 'b-' + b.boardId,
          name: platformNameOf(platformIdOf(b.site), b.siteName) + ' · ' + b.name,
          why: why,
          detail: b.note || '',
          status: b.status,
          boardId: b.boardId,
          at: (b.attempt && b.attempt.at) || b.lastCapture || null,
        })
      })
      staleIds.forEach(function (id) {
        if (badRows.some(function (b) { return b.boardId === id })) return
        const b = rows.filter(function (x) { return x.boardId === id })[0] || { name: id, siteName: '', site: siteOfBoardId(id) }
        issues.push({
          key: 's-' + id,
          name: platformNameOf(platformIdOf(b.site), b.siteName) + ' · ' + b.name,
          why: '与上一日整榜一致（数据待核对）',
          detail: '',
          status: 'stale',
          boardId: id,
          at: b.lastCapture || null,
        })
      })
      if (enrichPending > 0) {
        issues.push({ key: 'enrich', name: '字段补全', why: enrichPending + ' 个榜缺字段', detail: '', status: 'enrich', boardId: null, at: null })
      }

      // 聚合变化条目并按平台归并（起点 + 起点图 → 起点）
      const chgEntries = []
      const chgTotals = {}
      let chgSum = 0
      if (chg && chg.sites) {
        chg.sites.forEach(function (s) {
          const pid = platformIdOf(s.site)
          ;(s.groups || []).forEach(function (g) {
            const items = g.items || []
            const n = typeof g.count === 'number' ? g.count : items.length
            chgTotals[g.group] = (chgTotals[g.group] || 0) + n
            chgSum += n
            items.forEach(function (it) {
              chgEntries.push({ site: s.site, pid: pid, siteName: s.siteName, group: g.group, it: it })
            })
          })
        })
      }
      const chgRealTotal = typeof (chg && chg.count) === 'number' && chg.count > chgSum ? chg.count : chgSum

      const platMap = {}
      const ensurePlat = function (pid, fallbackName) {
        if (!platMap[pid]) platMap[pid] = { id: pid, name: platformNameOf(pid, fallbackName), boards: [], items: [], counts: {} }
        return platMap[pid]
      }
      rows.forEach(function (b) { ensurePlat(platformIdOf(b.site), b.siteName).boards.push(b) })
      chgEntries.forEach(function (e) {
        const p = ensurePlat(e.pid, e.siteName)
        p.items.push(e)
        p.counts[e.group] = (p.counts[e.group] || 0) + 1
      })
      const extraPids = Object.keys(platMap).filter(function (k) { return PLATFORM_ORDER.indexOf(k) < 0 })
      const platforms = PLATFORM_ORDER.concat(extraPids).filter(function (k) { return !!platMap[k] }).map(function (k) {
        const p = platMap[k]
        const okN = p.boards.filter(function (b) { return b.status === 'ok' }).length
        const badN = p.boards.filter(function (b) { return b.status !== 'ok' && !scheduleStateOf(b) }).length
        const dueN = p.boards.filter(function (b) { return scheduleStateOf(b) === 'due' }).length
        const waits = p.boards.filter(function (b) { return scheduleStateOf(b) === 'waiting' })
        const waitTimes = waits.map(plannedTimeOf).filter(Boolean).sort()
        const capTimes = p.boards.map(function (b) { return b.lastCapture ? fmtLocalHM(b.lastCapture) : '' }).filter(Boolean).sort()
        const metaTime = waitTimes.length ? waitTimes[0] : (capTimes.length ? capTimes[capTimes.length - 1] : '')
        const dotTone = badN > 0 ? 'bad' : dueN > 0 ? 'warn' : (okN === p.boards.length && p.boards.length > 0 ? 'ok' : 'muted')
        const tipBits = ['已采集 ' + okN + '/' + p.boards.length]
        if (waits.length) tipBits.push('计划 ' + waitTimes[0] + '（' + waits.length + ' 榜）')
        else if (capTimes.length) tipBits.push('抓取 ' + capTimes[capTimes.length - 1])
        if (badN > 0) tipBits.push(badN + ' 榜异常')
        const batchBoard = p.boards.filter(function (b) { return b.batch && Array.isArray(b.batch.items) && b.batch.items.length })[0] || null
        const batchShort = batchBoard ? shortBoardName(batchBoard.boardId, batchBoard.name, batchBoard.batch) : ''
        const batchItems = batchBoard
          ? batchBoard.batch.items.map(function (it) {
              return {
                isBatch: true,
                boardId: batchBoard.boardId,
                boardName: batchBoard.name,
                batchShort: batchShort,
                fromPrevDay: !!batchBoard.batch.fromPrevDay,
                it: it,
              }
            })
          : []
        const boardDepths = {}
        p.boards.forEach(function (b) {
          if (typeof b.rowCount === 'number' && b.rowCount > 0) boardDepths[b.boardId] = b.rowCount
        })
        return {
          ...p, okN: okN, badN: badN, dueN: dueN, waitN: waits.length, metaTime: metaTime, dotTone: dotTone, statusTip: tipBits.join(' · '),
          batchBoard: batchBoard, batchShort: batchShort, batchItems: batchItems, boardDepths: boardDepths,
        }
      })

      const scanProg = (scan && scan.progress) || {}
      const scanTotal = typeof scanProg.total === 'number' ? scanProg.total : 0
      const scanDoneN = typeof scanProg.done === 'number' ? scanProg.done : 0
      const scanRunning = !!(scan && scan.outcome === 'running' && scan.inFlight !== false)
      const scanHasProg = scanRunning && scanTotal > 0
      const scanBusy = scanRunning || !!props.busy
      const scanBtnText = scanHasProg
        ? '扫描中 ' + Math.min(scanDoneN, scanTotal) + '/' + scanTotal
        : scanRunning || props.scanStarting ? '扫描中…' : props.busy ? '处理中…' : '扫描已选榜'

      const nextPlan = nextPlanOf(plan, ov, scan, total)
      const noData = !!(ov && (c.ok || 0) === 0 && chgRealTotal === 0)
      const noChanges = !!(ov && (c.ok || 0) > 0 && chg && chgRealTotal === 0)
      const topDotColor = badRows.length ? T.bad : dueRows.length ? T.warn : (ov && (c.ok || 0) > 0 ? T.ok : T.muted)
      const topCollectTip = [
        '已采集 ' + (ov ? (c.ok || 0) + '/' + total : '—'),
        waitingRows.length ? '未到计划 ' + waitingRows.length : '',
        dueRows.length ? '待补跑 ' + dueRows.length : '',
        badRows.length ? '失败 ' + badRows.length : '',
      ].filter(Boolean).join(' · ')
      const topDateTip = [
        '数据日期 ' + dash(ov && ov.dataDate),
        scanRunning ? '' : '上次 ' + scanLabel(scan),
        ov && ov.hiddenCount ? '未显示 ' + ov.hiddenCount + ' 个榜' : '',
      ].filter(Boolean).join(' · ')

      const openBookTrend = function (info) {
        if (!info || !info.bookKey) {
          if (info && info.boardId && props.onOpenBoard) props.onOpenBoard(info.boardId)
          return
        }
        setUi(function (prev) {
          const same = prev.trendPick && prev.trendPick.bookKey === info.bookKey && prev.trendPick.boardId === (info.boardId || null)
          if (!same && typeof setTimeout === 'function') {
            setTimeout(function () {
              const el = trendRef.current
              if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }, 30)
          }
          return Object.assign({}, prev, {
            trendPick: same ? null : { bookKey: info.bookKey, boardId: info.boardId || null, title: info.title || '', boardName: info.boardName || '', url: info.url || null },
          })
        })
      }

      const toggleWatchBook = function (info, want) {
        if (!info || !info.bookKey || ui.watchBusy) return
        patchUi({ watchBusy: true })
        bmStore.act({
          action: 'watch',
          bookKey: info.bookKey,
          watched: want,
          boardId: info.boardId || undefined,
          title: info.title || undefined,
        }).then(function () {
          // 同步刷新本地走势缓存里的 watched 标记，避免取消盯盘后抽屉按钮仍读旧缓存
          Object.keys(BOOK_TREND_CACHE).forEach(function (k) {
            if (k.indexOf(info.bookKey + '|') === 0 && BOOK_TREND_CACHE[k]) BOOK_TREND_CACHE[k].watched = want
          })
          setUi(function (prev) { return Object.assign({}, prev, { watchBusy: false, watchTick: prev.watchTick + 1 }) })
          if (bm.list) bm.refreshList()
          toast('success', want ? '已加入首页盯盘' : '已移出首页盯盘')
        }).catch(function (e) {
          patchUi({ watchBusy: false })
          toast('error', '切换盯盘失败：' + e)
        })
      }

      const openPlatformFocus = function (pid, tab) {
        const nextTab = tab || (ui.lens === 'batch' ? 'batch' : 'changes')
        patchUi({ focusPid: pid, focusTab: nextTab, focusGroup: (ui.lens === 'pick' || ui.lens === 'batch') ? '' : ui.lens, focusLimit: 30 })
      }

      const openUrl = function (u, ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation() }
        if (!u) return
        if (props.openLink) props.openLink(u)
        else { try { window.open(u, '_blank', 'noopener,noreferrer') } catch (e) {} }
      }

      const renderBatchItem = function (bItem, idx, opts) {
        const it = bItem.it || {}
        const inFocus = !!(opts && opts.inFocus)
        const bk = bookKeyOf(bItem.boardId, it.key || it.title)
        const subTag = inFocus ? (it.cat || bItem.batchShort) : bItem.batchShort
        const onPick = function () {
          openBookTrend({ bookKey: it.key ? bookKeyOf(bItem.boardId, it.key) : '', boardId: bItem.boardId, title: it.title, boardName: bItem.batchShort, url: it.url || null })
        }
        return h('div', {
          key: (inFocus ? 'bf-' : 'bp-') + idx + '-' + (it.key || it.title),
          className: 'rs-ov-row',
          tabIndex: 0,
          style: {
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: inFocus ? '5px 6px' : '3px 5px',
            fontSize: T.fs.s, minWidth: 0,
            borderBottom: inFocus ? ('1px solid ' + wash(T.border, 40)) : 'none',
          },
          onClick: onPick,
          onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onPick() } },
        },
          ovRankBadge(it.rank, false, null),
          h('span', {
            style: { fontWeight: 500, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.fg },
            title: it.title + (it.author ? ' · ' + it.author : '') + (bItem.fromPrevDay ? '（昨日首订快照）' : ''),
          }, it.title),
          h('span', { style: { flex: '0 0 auto' }, onClick: function (ev) { ev.stopPropagation() } },
            h(BookmarkStar, { bookKey: bk, boardId: bItem.boardId, row: null, title: it.title })),
          h('span', {
            style: { fontSize: T.fs.xs, color: T.muted, flex: '0 0 auto', maxWidth: inFocus ? '100px' : '68px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' },
            title: '进榜：' + bItem.boardName + (bItem.fromPrevDay ? '（本地昨日快照）' : ''),
            onClick: function (ev) { ev.stopPropagation(); props.onOpenBoard && props.onOpenBoard(bItem.boardId) },
          }, subTag),
          h('div', { style: { flex: '0 0 auto', minWidth: inFocus ? '54px' : '42px', display: 'flex', justifyContent: 'flex-end' } },
            batchValueNode(it)))
      }

      const renderChangeItem = function (e, idx, opts) {
        const it = e.it || {}
        const inFocus = !!(opts && opts.inFocus)
        const bk = bookKeyOf(it.boardId, it.key || it.title)
        const isOut = e.group === '退榜'
        const bShort = shortBoardName(it.boardId, it.boardName)
        const onPick = function () {
          openBookTrend({ bookKey: it.key ? bookKeyOf(it.boardId, it.key) : '', boardId: it.boardId, title: it.title, boardName: bShort, url: it.url || null })
        }
        if (inFocus && chgNarrow) {
          return h('div', {
            key: 'cf-' + idx + '-' + (it.key || it.title),
            className: 'rs-ov-row',
            tabIndex: 0,
            style: { padding: '5px 6px', borderBottom: '1px solid ' + wash(T.border, 40) },
            onClick: onPick,
            onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onPick() } },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
              ovRankBadge(it.rank, isOut, it.prevRank),
              h('span', { style: { fontWeight: 500, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: it.title }, it.title),
              h('span', { style: { flex: '0 0 auto' }, onClick: function (ev) { ev.stopPropagation() } },
                h(BookmarkStar, { bookKey: bk, boardId: it.boardId, row: null, title: it.title })),
              compactDeltaNode(e.group, it)),
            h('div', { style: { ...C.muted, marginTop: '2px', paddingLeft: '25px', fontSize: T.fs.xs } },
              h('span', {
                style: { cursor: 'pointer' },
                title: '打开榜单：' + (it.boardName || bShort),
                onClick: function (ev) { ev.stopPropagation(); props.onOpenBoard && props.onOpenBoard(it.boardId) },
              }, bShort)))
        }
        return h('div', {
          key: (inFocus ? 'f-' : 'p-') + idx + '-' + (it.key || it.title),
          className: 'rs-ov-row',
          tabIndex: 0,
          style: {
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: inFocus ? '5px 6px' : '3px 5px',
            fontSize: T.fs.s, minWidth: 0,
            borderBottom: inFocus ? ('1px solid ' + wash(T.border, 40)) : 'none',
          },
          onClick: onPick,
          onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onPick() } },
        },
          ovRankBadge(it.rank, isOut, it.prevRank),
          h('span', {
            style: { fontWeight: 500, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.fg },
            title: it.title + (it.author ? ' · ' + it.author : ''),
          }, it.title),
          h('span', { style: { flex: '0 0 auto' }, onClick: function (ev) { ev.stopPropagation() } },
            h(BookmarkStar, { bookKey: bk, boardId: it.boardId, row: null, title: it.title })),
          h('span', {
            style: { fontSize: T.fs.xs, color: T.muted, flex: '0 0 auto', maxWidth: inFocus ? '120px' : '64px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' },
            title: '进榜：' + (it.boardName || bShort),
            onClick: function (ev) { ev.stopPropagation(); props.onOpenBoard && props.onOpenBoard(it.boardId) },
          }, bShort),
          h('div', { style: { flex: '0 0 auto', minWidth: inFocus ? '54px' : '42px', display: 'flex', justifyContent: 'flex-end' } },
            compactDeltaNode(e.group, it)))
      }

      // 第 3 层：按需盯盘条（0 本盯盘时完全不渲染；标题栏统一由 OverviewCardShell 承载，消除双标题栏）
      const watchSpec = (function () {
        const items = (watchData && Array.isArray(watchData.items)) ? watchData.items : []
        if (!items.length) return null
        const active = items.filter(function (x) { return !x.quiet })
        const quiet = items.filter(function (x) { return !!x.quiet })
        const pool = ui.watchShowQuiet ? active.concat(quiet) : active
        const shown = ui.watchShowAll ? pool : pool.slice(0, 5)
        const moreN = pool.length - shown.length
        return {
          subtitle: active.length ? active.length + ' 活跃' : '今日无变动',
          headerExtra: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '2px' } },
            quiet.length ? h('button', {
              type: 'button', className: 'rs-ov-iconbtn',
              onClick: function () { patchUi({ watchShowQuiet: !ui.watchShowQuiet, watchOpen: true }) },
            }, ui.watchShowQuiet ? '收起静默' : '+' + quiet.length + ' 静默') : null,
            h('button', {
              type: 'button', className: 'rs-ov-iconbtn',
              title: ui.watchOpen ? '折叠盯盘列表' : '展开盯盘列表',
              onClick: function () { patchUi({ watchOpen: !ui.watchOpen }) },
            }, ui.watchOpen ? '▾' : '▸')),
          body: ui.watchOpen && shown.length ? h('div', { style: { padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: '2px' } },
            shown.map(function (w) {
              const dtCls = w.deltaType === 'up' ? 'rs-ov-delta is-up'
                : w.deltaType === 'down' ? 'rs-ov-delta is-down'
                : w.deltaType === 'out' ? 'rs-ov-delta is-out'
                : w.deltaType === 'new' ? 'rs-ov-delta is-new' : 'rs-ov-delta is-muted'
              const sparkStroke = w.deltaType === 'out' || w.deltaType === 'down' ? T.bad : (w.deltaType === 'up' ? T.up : T.accent)
              const bShort = shortBoardName(w.boardId, w.boardName)
              return h('div', {
                key: 'w-' + w.bookKey, className: 'rs-ov-row', tabIndex: 0,
                style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px', fontSize: T.fs.s, minWidth: 0 },
                onClick: function () { openBookTrend({ bookKey: w.bookKey, boardId: w.boardId, title: w.title, boardName: bShort, url: w.url }) },
                onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openBookTrend({ bookKey: w.bookKey, boardId: w.boardId, title: w.title, boardName: bShort, url: w.url }) } },
              },
                ovRankBadge(w.rank, w.deltaType === 'out', w.prevRank),
                h('span', { style: { fontWeight: 500, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: w.title }, w.title),
                !chgNarrow && bShort ? h('span', { style: { fontSize: T.fs.xs, color: T.muted, flex: '0 0 auto' } }, w.siteName + '·' + bShort) : null,
                w.statText ? h('span', { style: { fontSize: T.fs.xs, color: T.muted, ...C.num, flex: '0 0 auto' } }, w.statText) : null,
                !chgNarrow ? sparklineNode(w.trend, sparkStroke, w.invert, 44, 14) : null,
                h('span', { className: dtCls, style: { minWidth: '46px', justifyContent: 'flex-end' } }, w.deltaText))
            }),
            pool.length > 5 ? h('div', { style: { textAlign: 'center', paddingTop: '2px' } },
              h('button', { type: 'button', className: 'rs-btn is-ghost', style: { height: '22px', fontSize: T.fs.xs, color: T.muted }, onClick: function () { patchUi({ watchShowAll: !ui.watchShowAll }) } },
                ui.watchShowAll ? '收起至 5 本' : '展开其余 ' + moreN + ' 本')) : null) : null,
        }
      })()

      // 单书本地走势原地抽屉
      const trendDrawer = (function () {
        const tp = ui.trendPick
        if (!tp) return null
        const ck = [tp.bookKey, tp.boardId || '', ui.trendDays, rev].join('|')
        const data = trendState && trendState.key === ck ? trendState.data : BOOK_TREND_CACHE[ck]
        const loading = !!(trendState && trendState.key === ck && trendState.loading)
        const isWatched = bm.done ? bm.watched(tp.bookKey) : !!(data && data.watched)
        const title = (data && data.title) || tp.title || tp.bookKey
        const url = (data && data.url) || tp.url
        const bId = (data && data.boardId) || tp.boardId
        const bShort = bId ? shortBoardName(bId, (data && data.boardName) || tp.boardName) : (tp.boardName || '')
        const unit = (data && data.unit) || '名次'
        const invert = data ? !!data.invert : true
        const dates = (data && data.dates) || []
        const vals = (data && data.values) || []
        const validPts = vals.filter(function (v) { return typeof v === 'number' && Number.isFinite(v) })
        const showDates = dates
        const showVals = vals
        const gridCols = Math.min(7, Math.max(1, showDates.length))
        return h('div', { ref: trendRef, style: { ...C.detail, marginTop: '10px', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: '1 1 180px' } },
              url
                ? h('a', { href: url, style: { fontWeight: 600, fontSize: T.fs.m, color: T.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: '在侧栏浏览器打开原页', onClick: function (ev) { openUrl(url, ev) } }, title)
                : h('span', { style: { fontWeight: 600, fontSize: T.fs.m, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
              bShort ? h('span', { style: { fontSize: T.fs.xs, color: T.muted, whiteSpace: 'nowrap' } }, bShort + ' · ' + unit) : null),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: '0 0 auto' } },
              h('div', { className: 'rs-ov-seg' },
                [7, 14].map(function (d) {
                  return h('button', {
                    key: 'td-' + d, type: 'button',
                    className: 'rs-ov-seg-btn' + (ui.trendDays === d ? ' is-on' : ''),
                    style: { padding: '1px 6px', fontSize: T.fs.xs },
                    onClick: function () { patchUi({ trendDays: d }) },
                  }, d + '天')
                })),
              h('button', {
                type: 'button', className: 'rs-btn', style: { height: '24px', padding: '0 8px', fontSize: T.fs.xs },
                disabled: ui.watchBusy,
                onClick: function () { toggleWatchBook({ bookKey: tp.bookKey, boardId: bId, title: title }, !isWatched) },
              }, isWatched ? '取消盯盘' : '＋ 盯盘'),
              bId && props.onOpenBoard ? h('button', { type: 'button', className: 'rs-btn is-ghost', style: { height: '24px', padding: '0 6px', fontSize: T.fs.xs }, onClick: function () { props.onOpenBoard(bId) } }, '进榜 ›') : null,
              h('button', { type: 'button', className: 'rs-btn is-ghost', style: { height: '24px', padding: '0 6px', fontSize: T.fs.xs, color: T.muted }, onClick: function () { patchUi({ trendPick: null }) } }, '收起'))),
          loading ? h('div', { style: C.muted }, '正在读取本地走势…')
            : !data || !dates.length ? h('div', { style: C.muted }, '暂无本地多日记录')
            : h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' } },
                validPts.length >= 2
                  ? h('div', { style: { flex: '0 0 auto', padding: '4px 6px', borderRadius: '6px', background: wash(T.fg, 4) } },
                      sparklineNode(vals, T.accent, invert, chgNarrow ? 180 : 210, 44))
                  : null,
                h('div', { style: { flex: '1 1 220px', display: 'grid', gridTemplateColumns: 'repeat(' + gridCols + ', minmax(0, 1fr))', gap: '4px', textAlign: 'center', ...C.num } },
                  showDates.map(function (d, i) {
                    const v = showVals[i]
                    const cellText = v == null ? '—' : (invert ? '#' + v : ovFmtBrief(v))
                    return h('div', { key: 'pt-' + d, style: { padding: '4px 2px', borderRadius: '5px', background: wash(T.fg, 4) } },
                      h('div', { style: { fontSize: T.fs.xs, color: T.muted } }, mdOf(d)),
                      h('div', { style: { fontSize: T.fs.xs, fontWeight: 600, color: v == null ? T.muted : T.fg, marginTop: '1px' } }, cellText))
                  }))))
      })()

      // 第 4 层：自由组合可拖拽画布（盯盘、四站独立活卡片、周榜竞速、作品成长对比、关键词生态） / 单站聚焦钻取
      const lensGroups = ['新入榜', '上升', '下降', '退榜', '回榜'].filter(function (g) { return (chgTotals[g] || 0) > 0 })
      const hasAnyBatch = platforms.some(function (p) { return p.batchItems && p.batchItems.length > 0 })
      const activeLens = (ui.lens === 'pick' || (ui.lens === 'batch' && hasAnyBatch) || lensGroups.indexOf(ui.lens) >= 0) ? ui.lens : 'pick'
      const cardLimit = chgNarrow ? 5 : 6
      const focusPlat = ui.focusPid ? platforms.filter(function (p) { return p.id === ui.focusPid })[0] || null : null
      const platById = {}
      platforms.forEach(function (p) { platById[p.id] = p })

      const buildPlatformCardSpec = function (p, isNarrowCard) {
        let renderedRows = []
        if (activeLens === 'batch') {
          renderedRows = (p.batchItems || []).slice(0, cardLimit).map(function (bi, idx) { return renderBatchItem(bi, idx, { inFocus: false }) })
        } else if (activeLens === 'pick') {
          const picked = pickHighlights(p.items, cardLimit, {
            platformId: p.id,
            batch: p.batchBoard ? p.batchBoard.batch : null,
            batchItems: p.batchItems,
            boardDepths: p.boardDepths,
          })
          renderedRows = picked.map(function (x, idx) {
            return x && x.isBatch ? renderBatchItem(x, idx, { inFocus: false }) : renderChangeItem(x, idx, { inFocus: false })
          })
        } else {
          renderedRows = sortGroupChanges(p.items.filter(function (e) { return e.group === activeLens }), activeLens)
            .slice(0, cardLimit)
            .map(function (e, idx) { return renderChangeItem(e, idx, { inFocus: false }) })
        }
        const cnt = activeLens === 'batch' ? ((p.batchBoard && p.batchBoard.batch && p.batchBoard.batch.count) || 0)
          : activeLens === 'pick' ? p.items.length : (p.counts[activeLens] || 0)
        const maxChips = isNarrowCard ? 3 : 4
        const shownBoards = p.boards.slice(0, maxChips)
        const moreBoards = p.boards.length - shownBoards.length
        const dotColor = p.dotTone === 'bad' ? T.bad : p.dotTone === 'warn' ? T.warn : p.dotTone === 'ok' ? T.ok : T.muted
        const goFocus = function () {
          openPlatformFocus(p.id, activeLens === 'batch' && p.batchBoard ? 'batch' : (p.items.length ? 'changes' : (p.batchBoard ? 'batch' : 'boards')))
        }
        return {
          title: p.name,
          headerTitle: p.statusTip + ' · 点击查看全站变化与各榜，长按可拖动卡片',
          onHeaderClick: goFocus,
          subtitle: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', ...C.num } },
            h('span', { style: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: dotColor } }),
            p.okN + '/' + p.boards.length + (p.metaTime ? ' · ' + p.metaTime : '')),
          headerExtra: h('button', {
            type: 'button', className: 'rs-ov-iconbtn',
            style: { ...C.num, marginRight: '2px' },
            title: '查看全站变化与各榜',
            onClick: goFocus,
          }, activeLens === 'batch'
            ? (p.batchBoard ? cnt + ' 本 ›' : p.boards.length + ' 榜 ›')
            : (p.items.length ? cnt + ' ›' : p.boards.length + ' 榜 ›')),
          body: h('div', { style: { padding: '5px 10px 8px', display: 'flex', flexDirection: 'column', flex: '1 1 auto' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', paddingBottom: '5px' } },
              renderedRows.length
                ? renderedRows
                : h('div', { style: { padding: '16px 4px', textAlign: 'center', fontSize: T.fs.xs, color: T.muted } },
                    activeLens === 'batch' ? '该站无首订榜'
                      : (p.okN === 0 && p.waitN > 0 ? '计划 ' + (p.metaTime || '') + ' 采集' : (chg ? '无此项变动' : '读取中…')))),
            h('div', { style: { paddingTop: '6px', borderTop: '1px solid ' + wash(T.border, 55), display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' } },
              shownBoards.map(function (b) {
                const stS = scheduleStateOf(b)
                const pt = plannedTimeOf(b)
                const bShort = shortBoardName(b.boardId, b.name, b.batch)
                const isBad = b.status !== 'ok' && !stS
                const hasPrevBatch = !!(stS === 'waiting' && b.batch && b.batch.fromPrevDay)
                const tip = b.name + (hasPrevBatch
                  ? ' · 本地最新：' + (b.batch.label || b.batch.dataDate) + '（今日 ' + pt + ' 采新，点此直看）'
                  : (stS === 'waiting' ? ' · 计划 ' + pt : stS === 'due' ? ' · 待补跑' : isBad ? ' · ' + statusText(b.status) : ''))
                return h('button', {
                  key: 'bc-' + b.boardId, type: 'button', className: 'rs-ov-bchip', title: tip,
                  onClick: function () { props.onOpenBoard && props.onOpenBoard(b.boardId) },
                },
                  isBad ? h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: T.bad } })
                    : (stS === 'waiting' && !hasPrevBatch) ? h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: T.muted, opacity: 0.6 } })
                    : null,
                  h('span', null, bShort),
                  stS === 'waiting' && !hasPrevBatch && pt ? h('span', { style: { ...C.num, opacity: 0.78 } }, pt) : null)
              }),
              moreBoards > 0 ? h('button', {
                type: 'button', className: 'rs-ov-bchip',
                onClick: function () { openPlatformFocus(p.id, 'boards') },
              }, '+' + moreBoards + ' ›') : null)),
        }
      }

      const watchSeeds = (watchData && Array.isArray(watchData.items))
        ? watchData.items.slice(0, 3).map(function (w) { return w.bookKey })
        : []
      const visibleCanvasCards = (layout.cards || []).filter(function (card) {
        if (card.visible === false) return false
        if (card.type === 'watch' && !watchSpec) return false
        const pid = OV_PLAT_PID_OF_TYPE[card.type]
        if (pid && !platById[pid]) return false
        return true
      })
      const moveVisibleCard = function (id, dir) {
        const pos = visibleCanvasCards.findIndex(function (c) { return c.id === id })
        const target = visibleCanvasCards[pos + dir]
        if (target) commitLayout('reorder', id, target.id)
      }

      const platformGridView = h('div', { style: { marginTop: '10px' } },
        (chgEntries.length || hasAnyBatch) ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '8px' } },
          h('div', { className: 'rs-ov-seg' },
            [{ value: 'pick', label: '精选' }].concat(lensGroups.map(function (g) {
              return { value: g, label: g + ' ' + (chgTotals[g] || 0) }
            })).concat(hasAnyBatch ? [{ value: 'batch', label: '首订' }] : []).map(function (o) {
              return h('button', {
                key: 'lg-' + o.value, type: 'button',
                className: 'rs-ov-seg-btn' + (activeLens === o.value ? ' is-on' : ''),
                onClick: function () { patchUi({ lens: o.value }) },
              }, o.label)
            })),
          chg && (chg.note || chgRealTotal > chgEntries.length)
            ? h('span', { style: { fontSize: T.fs.xs, color: T.muted }, title: chg.note || '' },
                chgRealTotal > chgEntries.length
                  ? '共 ' + chgRealTotal + ' 条（每类预览 20 条）'
                  : '共 ' + chgRealTotal + ' 条变动')
            : h('span', { style: { fontSize: T.fs.xs, color: T.muted } }, '共 ' + chgRealTotal + ' 条')) : null,
        h('div', {
          style: { display: 'grid', gridTemplateColumns: chgNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '8px', alignItems: 'start' },
        }, visibleCanvasCards.map(function (card, vIdx) {
          const cardNarrow = chgNarrow || card.span === 'half'
          const pid = OV_PLAT_PID_OF_TYPE[card.type]
          let shellExtra = {}
          let body = null
          if (card.type === 'watch' && watchSpec) {
            shellExtra = { subtitle: watchSpec.subtitle, headerExtra: watchSpec.headerExtra }
            body = watchSpec.body
          } else if (pid && platById[pid]) {
            const spec = buildPlatformCardSpec(platById[pid], cardNarrow)
            shellExtra = { title: spec.title, subtitle: spec.subtitle, headerExtra: spec.headerExtra, headerTitle: spec.headerTitle, onHeaderClick: spec.onHeaderClick }
            body = spec.body
          } else if (card.type === 'weekly-race') {
            body = h(WeeklyRaceCard, {
              cardId: card.id, config: card.config, narrow: cardNarrow, rev: rev, reloadTick: ui.reloadTick,
              onConfigChange: function (p) { commitLayout('config', card.id, p) },
              onOpenTrend: openBookTrend,
            })
          } else if (card.type === 'book-compare') {
            body = h(BookCompareCard, {
              cardId: card.id, config: card.config, narrow: cardNarrow, rev: rev, reloadTick: ui.reloadTick,
              seedBooks: watchSeeds, watchReady: watchData !== null,
              onConfigChange: function (p) { commitLayout('config', card.id, p) },
            })
          } else if (card.type === 'keywords') {
            body = h(KeywordAnalysisCard, {
              cardId: card.id, config: card.config, narrow: cardNarrow, rev: rev, reloadTick: ui.reloadTick,
              onConfigChange: function (p) { commitLayout('config', card.id, p) },
            })
          }
          return h(OverviewCardShell, Object.assign({
            key: card.id, card: card, narrow: chgNarrow,
            drag: ptrDrag.drag,
            onStartDrag: ptrDrag.startDrag,
            wasRecentDrag: ptrDrag.wasRecentDrag,
            canMoveUp: vIdx > 0, canMoveDown: vIdx < visibleCanvasCards.length - 1,
            onMove: moveVisibleCard,
            onToggleSpan: function (id) { commitLayout('span', id) },
            onHide: function (id) { commitLayout('hide', id) },
          }, shellExtra), body)
        })))

      const platformFocusView = focusPlat ? (function () {
        const grpNames = ['新入榜', '上升', '下降', '退榜', '回榜'].filter(function (g) { return (focusPlat.counts[g] || 0) > 0 })
        const filtered = ui.focusGroup
          ? sortGroupChanges(focusPlat.items.filter(function (e) { return e.group === ui.focusGroup }), ui.focusGroup)
          : sortGroupChanges(focusPlat.items, null)
        const shown = filtered.slice(0, ui.focusLimit)
        const rest = filtered.length - shown.length
        const activeTab = (ui.focusTab === 'batch' && !focusPlat.batchBoard) ? 'changes' : ui.focusTab
        return h('div', { className: 'rs-ov-card', style: { marginTop: '10px', padding: '10px' } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', paddingBottom: '8px', borderBottom: '1px solid ' + wash(T.border, 55) } },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' } },
              h('button', { type: 'button', className: 'rs-btn is-ghost', style: { height: '24px', padding: '0 6px' }, onClick: function () { patchUi({ focusPid: null }) } }, '← 四站'),
              h('div', { className: 'rs-ov-seg' },
                platforms.map(function (p) {
                  return h('button', {
                    key: 'sw-' + p.id, type: 'button',
                    className: 'rs-ov-seg-btn' + (p.id === focusPlat.id ? ' is-on' : ''),
                    onClick: function () { patchUi({ focusPid: p.id, focusGroup: '', focusLimit: 30, focusTab: ui.focusTab === 'batch' && !p.batchBoard ? 'changes' : ui.focusTab }) },
                  }, p.name)
                }))),
            h('div', { className: 'rs-ov-seg' },
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (activeTab === 'changes' ? ' is-on' : ''), onClick: function () { patchUi({ focusTab: 'changes' }) } }, '变化 ' + focusPlat.items.length),
              focusPlat.batchBoard ? h('button', { type: 'button', className: 'rs-ov-seg-btn' + (activeTab === 'batch' ? ' is-on' : ''), onClick: function () { patchUi({ focusTab: 'batch' }) } }, focusPlat.batchShort) : null,
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (activeTab === 'boards' ? ' is-on' : ''), onClick: function () { patchUi({ focusTab: 'boards' }) } }, '各榜 ' + focusPlat.boards.length))),
          activeTab === 'changes'
            ? h('div', { style: { marginTop: '6px' } },
                grpNames.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' } },
                  [{ v: '', label: '全部 ' + focusPlat.items.length }].concat(grpNames.map(function (g) {
                    return { v: g, label: g + ' ' + (focusPlat.counts[g] || 0) }
                  })).map(function (o) {
                    return h('button', {
                      key: 'fg-' + (o.v || 'all'), type: 'button',
                      className: ui.focusGroup === o.v ? 'rs-btn is-on' : 'rs-btn is-ghost',
                      style: { height: '24px', padding: '0 8px', fontSize: T.fs.xs },
                      onClick: function () { patchUi({ focusGroup: o.v, focusLimit: 30 }) },
                    }, o.label)
                  })) : null,
                shown.length
                  ? h('div', null,
                      shown.map(function (e, idx) { return renderChangeItem(e, idx, { inFocus: true }) }),
                      rest > 0 ? h('div', { style: { textAlign: 'center', marginTop: '8px' } },
                        h('button', { type: 'button', className: 'rs-btn', onClick: function () { patchUi({ focusLimit: ui.focusLimit + 30 }) } }, '再显示 ' + Math.min(30, rest) + ' 条（余 ' + rest + '）')) : null)
                  : h('div', { style: { ...C.muted, padding: '16px 0', textAlign: 'center' } }, '该分组暂无变动'))
            : activeTab === 'batch' && focusPlat.batchBoard
              ? h('div', { style: { marginTop: '6px' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', fontSize: T.fs.xs, color: T.muted } },
                    h('span', null, (focusPlat.batchBoard.batch.label || focusPlat.batchShort) + ' · 共 ' + focusPlat.batchBoard.batch.count + ' 本' + (focusPlat.batchBoard.batch.fromPrevDay ? '（昨日快照 · ' + (plannedTimeOf(focusPlat.batchBoard) || '21:30') + ' 采新）' : '')),
                    h('button', { type: 'button', className: 'rs-btn is-ghost', style: { height: '22px', padding: '0 6px', fontSize: T.fs.xs }, onClick: function () { props.onOpenBoard && props.onOpenBoard(focusPlat.batchBoard.boardId) } }, '进首订榜看全部 ›')),
                  focusPlat.batchItems.map(function (bi, idx) { return renderBatchItem(bi, idx, { inFocus: true }) }))
            : h('div', { style: { marginTop: '4px' } },
                focusPlat.boards.map(function (b) {
                  const stS = scheduleStateOf(b)
                  const pt = plannedTimeOf(b)
                  const isBad = b.status !== 'ok' && !stS
                  const dotColor = isBad ? T.bad : stS === 'due' ? T.warn : b.status === 'ok' ? T.ok : T.muted
                  const batchText = b.batch ? ((b.batch.label || ('第 ' + (b.batch.key || '—') + ' 期')) + (b.batch.count != null ? ' · ' + b.batch.count + ' 本' : '')) : null
                  const capHM = b.lastCapture ? fmtLocalHM(b.lastCapture) : ''
                  const openThis = function () { props.onOpenBoard && props.onOpenBoard(b.boardId) }
                  return h('div', {
                    key: 'fb-' + b.boardId, className: 'rs-ov-row', tabIndex: 0,
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px', fontSize: T.fs.s, borderBottom: '1px solid ' + wash(T.border, 40) },
                    title: '点击在「榜单」页查看：' + b.name,
                    onClick: openThis,
                    onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openThis() } },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: '1 1 auto' } },
                      h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flex: '0 0 auto' } }),
                      h('span', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.name),
                      b.site === 'qidiantu' ? h('span', { style: { fontSize: T.fs.xs, color: T.muted, flex: '0 0 auto' } }, '起点图') : null),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 auto', ...C.num, fontSize: T.fs.xs } },
                      stS === 'waiting'
                        ? h('span', { style: { color: T.muted } }, (batchText ? batchText + ' · ' : '') + '计划 ' + (pt || '—'))
                        : stS === 'due'
                          ? h('span', { style: { color: T.warn } }, '待补跑')
                          : isBad
                            ? h('span', { style: { color: T.bad } }, statusText(b.status))
                            : batchText
                              ? h('span', { style: { color: T.muted } }, batchText)
                              : b.derived
                                ? h('span', { style: { color: T.muted } }, '本地派生')
                                : (b.up != null || b.newCount != null || b.out != null)
                                  ? h('span', null,
                                      h('span', { style: { color: b.up > 0 ? T.up : T.muted } }, '↑' + dash(b.up)),
                                      h('span', { style: { color: T.muted } }, ' · '),
                                      h('span', { style: { fontWeight: b.newCount > 0 ? 600 : 400, color: b.newCount > 0 ? T.fg : T.muted } }, '+' + dash(b.newCount)),
                                      h('span', { style: { color: T.muted } }, ' · '),
                                      h('span', { style: { color: b.out > 0 ? T.down : T.muted } }, '-' + dash(b.out)))
                                  : h('span', { style: { color: T.muted } }, '已采集'),
                      !chgNarrow && b.status === 'ok' && capHM ? h('span', { style: { color: T.muted } }, capHM) : null,
                      h('span', { style: { color: T.muted } }, '›')))
                })))
      })() : null

      return h('div', null,
        /* ① 极简态势顶栏与主动作 */
        h('div', {
          style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            gap: '8px', paddingBottom: '8px', borderBottom: '1px solid ' + wash(T.border, 65),
          },
        },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: T.fs.s, ...C.num } },
            h('span', { style: { fontWeight: 600, color: T.fg }, title: topDateTip }, ov && ov.dataDate ? mdOf(ov.dataDate) : '—'),
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', color: T.muted }, title: topCollectTip },
              h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: topDotColor } }),
              h('span', null, h('strong', { style: { color: T.fg, fontWeight: 600 } }, ov ? String(c.ok || 0) : '—'), '/' + (ov ? total : '—')),
              waitingRows.length ? h('span', null, '· 未到计划 ' + waitingRows.length) : null,
              dueRows.length ? h('span', { style: { color: T.warn } }, '· 待补跑 ' + dueRows.length) : null),
            scan && scan.outcome === 'running' && scan.inFlight === false
              ? h('span', { style: { fontSize: T.fs.xs, color: T.warn }, title: scanLabel(scan) }, '上次未完成')
              : null,
            plan && plan.enabled === false
              ? h('button', {
                  type: 'button', className: 'rs-btn is-ghost',
                  style: { height: '22px', padding: '0 6px', fontSize: T.fs.xs, color: T.warn },
                  title: '定时扫描已关闭，点击去设置', onClick: props.onOpenSettings,
                }, '定时已关')
              : (nextPlan.value && nextPlan.value !== '—'
                  ? h('span', { style: { color: T.muted }, title: nextPlan.label + '：' + nextPlan.sub + ' ' + nextPlan.value },
                      '下轮 ', h('strong', { style: { color: T.fg, fontWeight: 500 } }, nextPlan.value))
                  : null),
            issues.length
              ? h('button', {
                  type: 'button', className: 'rs-btn is-ghost',
                  style: {
                    height: '22px', padding: '0 7px', fontSize: T.fs.xs, fontWeight: 600,
                    color: badRows.length ? T.bad : T.warn,
                    background: wash(badRows.length ? T.bad : T.warn, 12),
                  },
                  onClick: function () { patchUi({ issuesOpen: !ui.issuesOpen }) },
                }, '● ' + issues.length + ' 项待处理')
              : null),
          /* ③ 主动作 */
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' } },
            badRows.length ? h('button', { className: 'rs-btn', disabled: scanBusy, onClick: function () { props.act('/retry') }, title: '只重试失败的榜（联网）' }, '重试失败 ' + badRows.length + ' 个榜') : null,
            scanBusy ? h('button', { className: 'rs-btn is-danger', onClick: function () { props.act('/cancel') } }, '停止本次（保留已完成）') : null,
            h(OverviewCanvasPicker, {
              layout: layout,
              onToggleCard: function (id) { commitLayout('toggle', id) },
              onReset: function () { commitLayout('reset') },
            }),
            h('button', {
              className: 'rs-btn is-ghost',
              onClick: function () { patchUi({ reloadTick: (ui.reloadTick || 0) + 1 }); props.reload && props.reload() },
              title: '重新读取本地概览与全部卡片数据：不联网、不采集',
            }, '重新载入'),
            h('button', {
              className: 'rs-btn is-primary',
              disabled: scanBusy || !ov || total === 0,
              title: total === 0 ? '还没有勾选要扫的榜，先去「设置 → 抓取范围」勾选' : '按「设置 → 抓取范围」里勾选的榜逐个扫描（联网）',
              onClick: function () { props.act('/scan') },
            }, scanBtnText))),
        /* ④ 需要处理（无问题不渲染） */
        issues.length && ui.issuesOpen ? h('div', { ref: issuesRef },
          h(Banner, { tone: badRows.length ? 'error' : 'warn', title: '需要处理' },
            h('div', { className: 'rs-banner-body', style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, issues.map(function (it) {
              return h('div', { key: it.key, style: { ...C.row, alignItems: 'baseline', margin: '1px 0' } },
                h('span', { style: C.dot(it.status === 'stale' || it.status === 'enrich' ? 'warn' : 'bad') }),
                h('span', { style: { fontWeight: 600 } }, it.name),
                it.at ? h('span', { style: C.muted }, fmtLocalHM(it.at)) : null,
                h('span', null, it.why),
                it.detail ? h('span', { style: C.muted }, '（' + String(it.detail).slice(0, 80) + '）') : null,
                it.boardId ? h('button', { className: 'rs-btn', style: { height: '24px', padding: '0 8px' }, disabled: props.busy, onClick: function () { props.onOpenBoard && props.onOpenBoard(it.boardId) } }, '查看本榜') : null,
                it.boardId ? h('button', { className: 'rs-btn', style: { height: '24px', padding: '0 8px' }, disabled: props.busy, onClick: function () { props.onRescanBoard && props.onRescanBoard(it.boardId) } }, '重扫本榜') : null)
            })))) : null,
        /* ⑤ 补全进度（仅进行中或未完成时渲染） */
        (function () {
          if (!enrichStatus) return null
          const run = enrichStatus.enrichRun
          const active = !!(run && run.active === true)
          const left = typeof enrichStatus.pending === 'number' ? enrichStatus.pending : 0
          if (!active && !left) return null
          const retryable = typeof enrichStatus.retryable === 'number' ? enrichStatus.retryable : null
          const label = active
            ? '补全中 ' + ((run && run.done) || 0) + '/' + ((run && run.total) || 0) + ' 个榜（可以先浏览，不用等）'
            : retryable === 0
              ? '补全已尽力：还缺 ' + left + ' 个榜（当日已试满，明天自动续跑）'
              : '补全未完成：还缺 ' + left + ' 个榜（后台会继续补，也可进榜点「补全缺失字段」）'
          return h(Banner, { tone: active ? 'info' : 'warn', live: false }, label)
        })(),
        /* 空态引导 */
        total === 0 && ov ? h('div', { style: { ...C.row, marginTop: '12px', alignItems: 'center' } },
          h('span', { style: C.muted }, '还没有勾选要扫的榜'),
          props.onOpenSettings ? h('button', { className: 'rs-btn is-ghost', onClick: props.onOpenSettings }, '去设置勾选') : null) : null,
        total > 0 && noData ? h('div', { style: { ...C.muted, marginTop: '10px' } }, '今天还没有采集结果，到计划时刻会自动跑，也可以点「扫描已选榜」') : null,
        noChanges ? h('div', { style: { ...C.muted, marginTop: '8px' } }, '今天没有榜单变化') : null,
        /* 单书本地走势抽屉（点击任意作品原地展开） */
        trendDrawer,
        /* 自由组合可拖拽概览画布 / 单站聚焦钻取 */
        total > 0 ? (focusPlat ? platformFocusView : platformGridView) : null,
        h(OverviewDragGhost, { drag: ptrDrag.drag }))
    }
