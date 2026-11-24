/**
 * 36-overview-charts.js：概览可视化卡片（周榜竞速 WeeklyRaceCard、多书成长对比 BookCompareCard）。依赖 00/10/20/35。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    /** 生成简洁的 4~5 档坐标刻度 */
    function chartNiceTicks(minV, maxV, count) {
      const n = count || 4
      if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [0, 1]
      if (minV === maxV) {
        const pad = minV === 0 ? 1 : Math.abs(minV) * 0.2
        return [minV - pad, minV, minV + pad]
      }
      const span = maxV - minV
      const rawStep = span / Math.max(1, n - 1)
      const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)))
      const norm = rawStep / mag
      const step = (norm <= 1.2 ? 1 : norm <= 2.5 ? 2 : norm <= 6 ? 5 : 10) * mag
      const lo = Math.floor(minV / step) * step
      const hi = Math.ceil(maxV / step) * step
      const out = []
      for (let v = lo; v <= hi + step * 0.25 && out.length < 8; v += step) {
        out.push(Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(4)))
      }
      return out.length >= 2 ? out : [minV, maxV]
    }

    function fmtSignedBrief(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      if (n === 0) return '0'
      return (n > 0 ? '+' : '-') + ovFmtBrief(Math.abs(n))
    }

    function fmtWordsShort(w) {
      if (typeof w !== 'number' || !Number.isFinite(w)) return '—'
      if (w >= 10000) return (w / 10000).toFixed(1).replace(/\.0$/, '') + '万字'
      return fmtRead(Math.round(w)) + '字'
    }

    /** 周榜竞速卡（起点·三江 17 本 / 番茄·在读周榜 Top 20）：默认逐日，悬停不隐藏其余曲线 */
    function WeeklyRaceCard(props) {
      const cfg = props.config || {}
      const narrow = !!props.narrow
      const [st, patch] = useOvState('wr', function () {
        return {
          source: cfg.source === 'fanqie' ? 'fanqie' : 'sanjiang',
          mode: cfg.mode === 'cumulative' ? 'cumulative' : 'daily',
          period: cfg.period || '',
          cat: cfg.cat || '',
          data: null,
          loading: false,
          error: null,
          retryTick: 0,
          pinned: null,
          compareAll: false,
          hoverKey: null,
          hoverDay: -1,
        }
      })

      React.useEffect(function () {
        let alive = true
        patch({ loading: true, error: null })
        const qs = '/weekly-race?source=' + encodeURIComponent(st.source)
          + (st.period ? '&period=' + encodeURIComponent(st.period) : '')
          + (st.cat ? '&cat=' + encodeURIComponent(st.cat) : '')
        jget(qs).then(function (r) {
          if (!alive) return
          if (r && r.ok && Array.isArray(r.books)) {
            patch({ loading: false, error: null, data: r, pinned: r.books.slice(0, 3).map(function (b) { return b.bookKey }), compareAll: false })
          } else {
            patch({ loading: false, error: null, data: null })
          }
        }).catch(function (e) { if (alive) patch({ loading: false, data: null, error: formatOvApiError(e) }) })
        return function () { alive = false }
      }, [st.source, st.period, st.cat, props.rev, props.reloadTick, st.retryTick])

      const switchSource = function (nextSrc) {
        if (nextSrc === st.source) return
        patch({ source: nextSrc, period: '', cat: '', hoverKey: null, hoverDay: -1 })
        if (props.onConfigChange) props.onConfigChange({ source: nextSrc, mode: st.mode })
      }
      const switchMode = function (nextMode) {
        patch({ mode: nextMode })
        if (props.onConfigChange) props.onConfigChange({ source: st.source, mode: nextMode })
      }

      const data = st.data
      const books = (data && Array.isArray(data.books)) ? data.books : []
      const dates = (data && Array.isArray(data.dates)) ? data.dates : []
      const periods = (data && Array.isArray(data.periods)) ? data.periods : []
      const categories = (data && Array.isArray(data.categories)) ? data.categories : []
      const activePins = Array.isArray(st.pinned) ? st.pinned : books.slice(0, 3).map(function (b) { return b.bookKey })

      const pinColorMap = {}
      activePins.forEach(function (bk, i) { pinColorMap[bk] = OV_CHART_COLORS[i % OV_CHART_COLORS.length] })

      const togglePin = function (bk) {
        patch(function (prev) {
          const cur = Array.isArray(prev.pinned) ? prev.pinned.slice() : books.slice(0, 3).map(function (b) { return b.bookKey })
          const idx = cur.indexOf(bk)
          if (idx >= 0) {
            if (cur.length <= 1) return { compareAll: false }
            cur.splice(idx, 1)
            return { compareAll: false, pinned: cur }
          }
          if (cur.length >= 6) cur.shift()
          cur.push(bk)
          return { compareAll: false, pinned: cur }
        })
      }

      const resetTop3 = function () {
        patch({ compareAll: false, pinned: books.slice(0, 3).map(function (b) { return b.bookKey }) })
      }

      const seriesOf = function (b) { return st.mode === 'cumulative' ? (b.cumulative || []) : (b.daily || []) }

      const VW = 760
      const VH = narrow ? 188 : 208
      const padL = 52
      const padR = 16
      const padT = 14
      const padB = 26
      const plotW = VW - padL - padR
      const plotH = VH - padT - padB

      const allVals = []
      books.forEach(function (b) {
        seriesOf(b).forEach(function (v) {
          if (typeof v === 'number' && Number.isFinite(v)) allVals.push(v)
        })
      })
      const minRaw = allVals.length ? Math.min.apply(null, allVals.concat([0])) : 0
      const maxRaw = allVals.length ? Math.max.apply(null, allVals.concat([10])) : 10
      const yTicks = chartNiceTicks(minRaw, maxRaw, 4)
      const yMin = yTicks[0]
      const yMax = yTicks[yTicks.length - 1]
      const ySpan = Math.max(1e-6, yMax - yMin)
      const xCount = Math.max(2, dates.length || 7)
      const xAt = function (i) { return padL + (i / Math.max(1, xCount - 1)) * plotW }
      const yAt = function (v) { return padT + plotH - ((v - yMin) / ySpan) * plotH }

      const latestDayIdx = (function () {
        for (let i = (dates.length || 7) - 1; i >= 0; i--) {
          if (books.some(function (b) { const v = seriesOf(b)[i]; return typeof v === 'number' && Number.isFinite(v) })) return i
        }
        return 0
      })()
      const readoutDay = st.hoverDay >= 0 && st.hoverDay < dates.length ? st.hoverDay : latestDayIdx
      const hoverBook = st.hoverKey ? books.filter(function (b) { return b.bookKey === st.hoverKey })[0] || null : null

      const drawOrder = books.slice().sort(function (a, b) {
        const sc = function (bk) { return bk === st.hoverKey ? 3 : (pinColorMap[bk] ? 2 : 1) }
        return sc(a.bookKey) - sc(b.bookKey)
      })
      const cols = narrow ? 2 : 4

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px 10px' } },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' } },
            h('div', { className: 'rs-ov-seg' },
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.source === 'sanjiang' ? ' is-on' : ''), onClick: function () { switchSource('sanjiang') } }, '起点·三江'),
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.source === 'fanqie' ? ' is-on' : ''), onClick: function () { switchSource('fanqie') } }, '番茄·在读周榜')),
            periods.length > 0 ? h('select', {
              className: 'rs-input',
              style: { ...C.input, height: '24px', fontSize: T.fs.xs, padding: '0 6px', maxWidth: '175px' },
              value: (data && data.period && data.period.key) || st.period,
              onChange: function (ev) { patch({ period: ev.target.value }) },
              title: '切换历史期次',
            }, periods.map(function (p) { return h('option', { key: p.key, value: p.key }, p.label) })) : null,
            categories.length > 1 ? h('select', {
              className: 'rs-input',
              style: { ...C.input, height: '24px', fontSize: T.fs.xs, padding: '0 6px', maxWidth: '112px' },
              value: st.cat,
              onChange: function (ev) { patch({ cat: ev.target.value }) },
              title: '按分类筛选',
            }, [h('option', { key: 'all', value: '' }, '全部分类')].concat(categories.map(function (c) {
              return h('option', { key: c.name, value: c.name }, c.name + ' (' + c.count + ')')
            }))) : null),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' } },
            h('div', { className: 'rs-ov-seg' },
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.mode === 'daily' ? ' is-on' : ''), onClick: function () { switchMode('daily') } }, '逐日'),
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.mode === 'cumulative' ? ' is-on' : ''), onClick: function () { switchMode('cumulative') } }, '累计')),
            h('button', {
              type: 'button',
              className: 'rs-ov-chip' + (st.compareAll ? ' is-on' : ''),
              onClick: function () { patch(function (prev) { return { compareAll: !prev.compareAll } }) },
            }, '全盘对比'),
            h('button', { type: 'button', className: 'rs-ov-chip', onClick: resetTop3 }, '恢复 Top3'))),

        st.error
          ? ovCardNotice({ error: st.error, onRetry: function () { patch(function (prev) { return { retryTick: (prev.retryTick || 0) + 1 } }) } })
          : st.loading && !books.length
          ? ovCardNotice({ text: '正在读取周榜数据…' })
          : !books.length
            ? ovCardNotice({ text: (data && data.note) || '暂无该期周榜快照' })
            : h('div', { style: { position: 'relative' } },
                h('svg', {
                  viewBox: '0 0 ' + VW + ' ' + VH,
                  style: { width: '100%', height: narrow ? '176px' : '198px', display: 'block', overflow: 'visible' },
                  onMouseLeave: function () { patch({ hoverDay: -1, hoverKey: null }) },
                },
                  yTicks.map(function (tv, idx) {
                    const yy = yAt(tv)
                    const isZero = tv === 0
                    return h('g', { key: 'yt-' + idx },
                      h('line', {
                        x1: padL, y1: yy, x2: VW - padR, y2: yy,
                        stroke: isZero ? T.muted : T.border, strokeOpacity: 0.45,
                        strokeWidth: isZero ? 1 : 0.75, strokeDasharray: isZero ? undefined : '2 3',
                      }),
                      h('text', { x: padL - 6, y: yy + 3.5, textAnchor: 'end', fontSize: 10, fill: T.muted, style: { fontVariantNumeric: 'tabular-nums' } }, ovFmtBrief(tv)))
                  }),
                  dates.map(function (d, i) {
                    const xx = xAt(i)
                    const isHoverD = st.hoverDay === i
                    const colW = plotW / Math.max(1, dates.length)
                    return h('g', { key: 'xd-' + d },
                      isHoverD ? h('line', { x1: xx, y1: padT, x2: xx, y2: padT + plotH, stroke: T.accent, strokeOpacity: 0.35, strokeWidth: 1, strokeDasharray: '2 2' }) : null,
                      h('text', { x: xx, y: VH - 7, textAnchor: 'middle', fontSize: 10, fill: isHoverD ? T.fg : T.muted, fontWeight: isHoverD ? 600 : 400 }, mdOf(d)),
                      h('rect', { x: Math.max(padL, xx - colW / 2), y: padT, width: colW, height: plotH, fill: 'transparent', onMouseEnter: function () { patch({ hoverDay: i }) } }))
                  }),
                  drawOrder.map(function (b, bIdx) {
                    const vals = seriesOf(b)
                    const isHover = st.hoverKey === b.bookKey
                    const isPin = !!pinColorMap[b.bookKey]
                    const col = pinColorMap[b.bookKey] || (st.compareAll ? OV_CHART_COLORS[bIdx % OV_CHART_COLORS.length] : T.muted)
                    let op = 0.16
                    let sw = 1.1
                    if (st.hoverKey) {
                      if (isHover) { op = 1; sw = 2.6 }
                      else if (isPin) { op = 0.32; sw = 1.4 }
                      else { op = st.compareAll ? 0.16 : 0.08; sw = 1 }
                    } else if (st.compareAll) {
                      op = isPin ? 0.95 : 0.48
                      sw = isPin ? 2.1 : 1.3
                    } else if (isPin) {
                      op = 0.95
                      sw = 2.1
                    }
                    const segs = []
                    let curSeg = []
                    const pts = []
                    for (let i = 0; i < vals.length; i++) {
                      const v = vals[i]
                      if (typeof v === 'number' && Number.isFinite(v)) {
                        const pt = { x: xAt(i), y: yAt(v), i: i, v: v }
                        curSeg.push(pt)
                        pts.push(pt)
                      } else if (curSeg.length) { segs.push(curSeg); curSeg = [] }
                    }
                    if (curSeg.length) segs.push(curSeg)
                    if (!pts.length) return null
                    const strokeCol = isHover && !isPin ? T.accent : col
                    return h('g', {
                      key: 'wr-' + b.bookKey, style: { cursor: 'pointer' },
                      onMouseEnter: function () { patch({ hoverKey: b.bookKey }) },
                      onClick: function () { togglePin(b.bookKey) },
                    },
                      segs.map(function (seg, si) {
                        if (seg.length < 2) return null
                        const dAttr = seg.map(function (p, pi) { return (pi === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1) }).join(' ')
                        return h('path', { key: 'sg-' + si, d: dAttr, fill: 'none', stroke: strokeCol, strokeWidth: sw, strokeOpacity: op, strokeLinecap: 'round', strokeLinejoin: 'round' })
                      }),
                      pts.map(function (p) {
                        const showDot = isHover || isPin || pts.length === 1 || st.hoverDay === p.i
                        if (!showDot) return null
                        const r = isHover ? 3.4 : (st.hoverDay === p.i && isPin ? 3.2 : (pts.length === 1 ? 3 : 2.1))
                        return h('circle', { key: 'pt-' + p.i, cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: r, fill: strokeCol, fillOpacity: Math.min(1, op + 0.1) })
                      }))
                  })),
                h('div', {
                  style: {
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    padding: '4px 6px', borderRadius: '6px', background: wash(T.fg, 3), fontSize: T.fs.xs, color: T.muted, ...C.num,
                  },
                },
                  hoverBook
                    ? h('span', { style: { color: T.fg, fontWeight: 500 } },
                        '#' + hoverBook.rank + ' ' + hoverBook.title
                        + (dates[readoutDay] ? ' · ' + mdOf(dates[readoutDay]) + ' ' + (st.mode === 'daily' ? '日增 ' : '累计 ') + fmtSignedBrief(seriesOf(hoverBook)[readoutDay]) : '')
                        + ' · 本期累计 ' + fmtSignedBrief(hoverBook.totalDelta)
                        + (hoverBook.shouding != null ? ' · 首订 ' + fmtRead(hoverBook.shouding) : ''))
                    : h('span', null,
                        (dates[readoutDay] ? mdOf(dates[readoutDay]) + ' · ' : '')
                        + (st.mode === 'daily' ? '逐日' : '累计') + (data && data.metricLabel ? data.metricLabel : '增量')
                        + ' · 已钉 ' + activePins.length + ' 本'),
                  h('span', { style: { color: T.muted } }, (data && data.note) ? String(data.note).slice(0, 60) : ''))),

        books.length ? h('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))',
            gap: '2px 8px', paddingTop: '4px', borderTop: '1px solid ' + wash(T.border, 50),
          },
        }, books.map(function (b) {
          const isPin = !!pinColorMap[b.bookKey]
          const isHover = st.hoverKey === b.bookKey
          const dotColor = pinColorMap[b.bookKey] || (isHover ? T.accent : 'transparent')
          const statV = st.mode === 'daily' ? b.latestDelta : b.totalDelta
          return h('div', {
            key: 'dir-' + b.bookKey,
            className: 'rs-ov-dir-row' + (isPin ? ' is-pin' : ''),
            title: b.title + (b.author ? ' · ' + b.author : '') + (b.cat ? ' · ' + b.cat : '') + ' · 累计 ' + fmtSignedBrief(b.totalDelta),
            onMouseEnter: function () { patch({ hoverKey: b.bookKey }) },
            onMouseLeave: function () { patch({ hoverKey: null }) },
            onClick: function () { togglePin(b.bookKey) },
          },
            h('span', {
              style: {
                width: '6px', height: '6px', borderRadius: '50%', flex: '0 0 auto',
                background: dotColor,
                border: (isPin || isHover) ? 'none' : ('1px solid ' + wash(T.muted, 45)),
                boxSizing: 'border-box',
              },
            }),
            h('span', { style: { color: T.muted, width: '16px', textAlign: 'right', flex: '0 0 auto', ...C.num } }, String(b.rank)),
            h('span', {
              style: {
                flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: (isPin || isHover) ? T.fg : T.muted, fontWeight: (isPin || isHover) ? 500 : 400,
              },
            }, b.title),
            h('span', { style: { flex: '0 0 auto', color: statV > 0 ? T.fg : T.muted, ...C.num } }, fmtSignedBrief(statV)),
            props.onOpenTrend ? h('button', {
              type: 'button', className: 'rs-ov-iconbtn',
              style: { height: '16px', padding: '0 2px', fontSize: '10px' },
              title: '查看单书走势',
              onClick: function (ev) {
                ev.stopPropagation()
                props.onOpenTrend({ bookKey: b.bookKey, boardId: st.source === 'sanjiang' ? 'qidiantu.sanjiang' : 'fanqie.derived.period', title: b.title, boardName: st.source === 'sanjiang' ? '三江' : '在读周榜', url: b.url })
              },
            }, '↗') : null)
        })) : null)
    }

    /** 多书成长曲线对比卡：共享坐标轴，X 轴日期/字数、Y 轴在读收藏/涨幅%/名次，带毕业首订标记 */
    function BookCompareCard(props) {
      const cfg = props.config || {}
      const narrow = !!props.narrow
      const initKeys = Array.isArray(cfg.compareKeys)
        ? cfg.compareKeys.slice(0, 8)
        : (Array.isArray(cfg.bookKeys) ? cfg.bookKeys.slice(0, 8) : [])
      const [st, patch] = useOvState('bc', function () {
        return {
          xAxis: cfg.xAxis === 'words' ? 'words' : 'date',
          yAxis: cfg.yAxis === 'pct' || cfg.yAxis === 'rank' ? cfg.yAxis : 'value',
          days: typeof cfg.days === 'number' ? cfg.days : 30,
          keys: initKeys,
          seriesData: null,
          loading: false,
          error: null,
          retryTick: 0,
          hoverKey: null,
          hoverXIdx: -1,
          searchOpen: false,
          searchQ: '',
          searchHits: [],
        }
      })
      const keys = Array.isArray(st.keys) ? st.keys : []
      const keysJoined = keys.join(',')
      const seededRef = React.useRef(false)
      const searchBoxRef = React.useRef(null)
      useOvPopoverClose(st.searchOpen, function () { patch({ searchOpen: false }) }, searchBoxRef)

      React.useEffect(function () {
        if (seededRef.current || keys.length > 0) return undefined
        const seeds = Array.isArray(props.seedBooks) ? props.seedBooks.filter(Boolean).slice(0, 3) : []
        if (seeds.length) {
          seededRef.current = true
          patch({ keys: seeds, error: null })
          return undefined
        }
        // 等盯盘列表返回后再决定是否兜底搜书，避免竞态与多余请求
        if (props.watchReady === false) return undefined
        let alive = true
        jget('/books-search?limit=5').then(function (r) {
          if (!alive || seededRef.current) return
          const items = (r && Array.isArray(r.items)) ? r.items : []
          if (items.length) {
            seededRef.current = true
            patch({ keys: items.slice(0, 3).map(function (x) { return x.bookKey }), error: null })
          }
        }).catch(function (e) { if (alive) patch({ error: formatOvApiError(e) }) })
        return function () { alive = false }
      }, [props.watchReady, props.seedBooks && props.seedBooks.length, props.reloadTick, st.retryTick])

      React.useEffect(function () {
        if (!keysJoined) { patch({ seriesData: null }); return undefined }
        let alive = true
        patch({ loading: true, error: null })
        const qs = '/books-series?bookKeys=' + encodeURIComponent(keysJoined) + '&days=' + st.days
        jget(qs).then(function (r) {
          if (!alive) return
          patch({ loading: false, error: null, seriesData: (r && r.ok && Array.isArray(r.books)) ? r : null })
        }).catch(function (e) { if (alive) patch({ loading: false, seriesData: null, error: formatOvApiError(e) }) })
        return function () { alive = false }
      }, [keysJoined, st.days, props.rev, props.reloadTick, st.retryTick])

      React.useEffect(function () {
        if (!st.searchOpen) return undefined
        let alive = true
        const t = setTimeout(function () {
          jget('/books-search?limit=12&q=' + encodeURIComponent(st.searchQ)).then(function (r) {
            if (alive && r && Array.isArray(r.items)) patch({ searchHits: r.items })
          }).catch(function () { if (alive) patch({ searchHits: [] }) })
        }, st.searchQ ? 160 : 0)
        return function () { alive = false; clearTimeout(t) }
      }, [st.searchOpen, st.searchQ])

      const persistCfg = function (next) {
        if (props.onConfigChange) props.onConfigChange(Object.assign({ xAxis: st.xAxis, yAxis: st.yAxis, days: st.days, compareKeys: keys }, next))
      }

      const addBook = function (bk) {
        if (!bk) return
        seededRef.current = true
        patch(function (prev) {
          const cur = Array.isArray(prev.keys) ? prev.keys : []
          if (cur.indexOf(bk) >= 0) return { searchOpen: false, searchQ: '' }
          const next = cur.concat([bk]).slice(0, 8)
          persistCfg({ compareKeys: next })
          return { keys: next, searchOpen: false, searchQ: '' }
        })
      }

      const removeBook = function (bk) {
        seededRef.current = true
        patch(function (prev) {
          const cur = Array.isArray(prev.keys) ? prev.keys : []
          const next = cur.filter(function (x) { return x !== bk })
          persistCfg({ compareKeys: next })
          return { keys: next }
        })
      }

      const seriesData = st.seriesData
      const books = (seriesData && Array.isArray(seriesData.books)) ? seriesData.books : []
      const dates = (seriesData && Array.isArray(seriesData.dates)) ? seriesData.dates : []
      const dateIndexMap = {}
      dates.forEach(function (d, i) { dateIndexMap[d] = i })

      const yField = st.yAxis === 'pct' ? 'pct' : (st.yAxis === 'rank' ? 'rank' : 'value')
      const invertY = st.yAxis === 'rank'

      const VW = 760
      const VH = narrow ? 190 : 212
      const padL = 54
      const padR = 18
      const padT = 16
      const padB = 26
      const plotW = VW - padL - padR
      const plotH = VH - padT - padB

      const yVals = []
      const wordVals = []
      let wordCurveCount = 0
      books.forEach(function (b) {
        let wPts = 0
        ;(b.points || []).forEach(function (p) {
          const yv = p[yField]
          if (typeof yv === 'number' && Number.isFinite(yv)) yVals.push(yv)
          if (typeof p.words === 'number' && Number.isFinite(p.words) && p.words > 0) {
            wordVals.push(p.words)
            if (typeof yv === 'number' && Number.isFinite(yv)) wPts += 1
          }
        })
        if (wPts >= 2) wordCurveCount += 1
      })

      const yTicks = yVals.length ? chartNiceTicks(Math.min.apply(null, yVals), Math.max.apply(null, yVals), 4) : [0, 100]
      const yMin = yTicks[0]
      const yMax = yTicks[yTicks.length - 1]
      const ySpan = Math.max(1e-6, yMax - yMin)
      const yAt = function (v) {
        const norm = (v - yMin) / ySpan
        return invertY ? (padT + norm * plotH) : (padT + plotH - norm * plotH)
      }

      const xTicksWords = wordVals.length ? chartNiceTicks(Math.min.apply(null, wordVals), Math.max.apply(null, wordVals), 5) : [0, 100000]
      const wMin = xTicksWords[0]
      const wMax = xTicksWords[xTicksWords.length - 1]
      const wSpan = Math.max(1, wMax - wMin)
      const xAtDate = function (d) {
        const idx = dateIndexMap[d]
        return idx == null ? padL : padL + (idx / Math.max(1, dates.length - 1)) * plotW
      }
      const xAtWords = function (w) { return padL + ((w - wMin) / wSpan) * plotW }
      const fmtY = function (v) {
        if (v == null || !Number.isFinite(v)) return '—'
        if (st.yAxis === 'pct') return (v > 0 ? '+' : '') + v.toFixed(0) + '%'
        if (st.yAxis === 'rank') return '#' + Math.round(v)
        return ovFmtBrief(v)
      }

      const dateTickIdxs = []
      if (dates.length <= 7) {
        for (let i = 0; i < dates.length; i++) dateTickIdxs.push(i)
      } else {
        const step = Math.ceil((dates.length - 1) / 6)
        for (let i = 0; i < dates.length; i += step) dateTickIdxs.push(i)
        if (dateTickIdxs[dateTickIdxs.length - 1] !== dates.length - 1) dateTickIdxs.push(dates.length - 1)
      }

      const activeDate = st.xAxis === 'date' && st.hoverXIdx >= 0 && st.hoverXIdx < dates.length
        ? dates[st.hoverXIdx]
        : (dates.length ? dates[dates.length - 1] : null)
      const searchHits = Array.isArray(st.searchHits) ? st.searchHits : []

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px 10px' } },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' } },
            h('div', { className: 'rs-ov-seg' },
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.xAxis === 'date' ? ' is-on' : ''), onClick: function () { patch({ xAxis: 'date' }); persistCfg({ xAxis: 'date' }) } }, 'X:日期'),
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.xAxis === 'words' ? ' is-on' : ''), onClick: function () { patch({ xAxis: 'words' }); persistCfg({ xAxis: 'words' }) } }, 'X:字数')),
            h('div', { className: 'rs-ov-seg' },
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.yAxis === 'value' ? ' is-on' : ''), onClick: function () { patch({ yAxis: 'value' }); persistCfg({ yAxis: 'value' }) } }, '在读/收藏'),
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.yAxis === 'pct' ? ' is-on' : ''), onClick: function () { patch({ yAxis: 'pct' }); persistCfg({ yAxis: 'pct' }) } }, '涨幅%'),
              h('button', { type: 'button', className: 'rs-ov-seg-btn' + (st.yAxis === 'rank' ? ' is-on' : ''), onClick: function () { patch({ yAxis: 'rank' }); persistCfg({ yAxis: 'rank' }) } }, '名次')),
            h('div', { className: 'rs-ov-seg' },
              [{ d: 14, l: '14天' }, { d: 30, l: '30天' }, { d: 0, l: '全库' }].map(function (o) {
                return h('button', {
                  key: 'cd-' + o.d, type: 'button',
                  className: 'rs-ov-seg-btn' + (st.days === o.d ? ' is-on' : ''),
                  onClick: function () { patch({ days: o.d }); persistCfg({ days: o.d }) },
                }, o.l)
              }))),
          h('div', { ref: searchBoxRef, style: { position: 'relative' } },
            h('button', {
              type: 'button', className: 'rs-ov-chip' + (st.searchOpen ? ' is-on' : ''),
              onClick: function () { patch(function (prev) { return { searchOpen: !prev.searchOpen } }) },
            }, '＋ 添加作品'),
            st.searchOpen ? h('div', { className: 'rs-ov-popover', style: { minWidth: '270px', maxWidth: '320px' } },
              h('input', {
                type: 'text', className: 'rs-input', autoFocus: true,
                style: { ...C.input, width: '100%', height: '26px' },
                placeholder: '搜书名/作者，或贴书页链接/site:id',
                value: st.searchQ,
                onChange: function (ev) { patch({ searchQ: ev.target.value }) },
                onKeyDown: function (ev) {
                  if (ev.key === 'Escape') patch({ searchOpen: false })
                  if (ev.key === 'Enter' && searchHits.length) addBook(searchHits[0].bookKey)
                },
              }),
              h('div', { style: { maxHeight: '200px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' } },
                searchHits.length
                  ? searchHits.map(function (hit) {
                      const already = keys.indexOf(hit.bookKey) >= 0
                      return h('div', {
                        key: 'sh-' + hit.bookKey, className: 'rs-ov-dir-row',
                        style: { opacity: already ? 0.45 : 1 },
                        onClick: function () { if (!already) addBook(hit.bookKey) },
                      },
                        h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: OV_SITE_COLORS[hit.site] || T.muted, flex: '0 0 auto' } }),
                        h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.fg } }, hit.title),
                        h('span', { style: { fontSize: '10px', color: T.muted, flex: '0 0 auto' } }, already ? '已选' : (hit.watched ? '盯盘' : hit.siteName)))
                    })
                  : h('div', { style: { fontSize: T.fs.xs, color: T.muted, padding: '8px 4px', textAlign: 'center' } }, '未找到匹配作品'))) : null)),

        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' } },
          books.map(function (b, idx) {
            const col = OV_CHART_COLORS[idx % OV_CHART_COLORS.length]
            const isHover = st.hoverKey === b.bookKey
            return h('span', {
              key: 'chip-' + b.bookKey, className: 'rs-ov-chip',
              style: { borderColor: isHover ? col : wash(col, 35), background: wash(col, isHover ? 14 : 6), color: T.fg },
              onMouseEnter: function () { patch({ hoverKey: b.bookKey }) },
              onMouseLeave: function () { patch({ hoverKey: null }) },
            },
              h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: col, flex: '0 0 auto' } }),
              h('span', { style: { maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.title),
              h('span', { style: { fontSize: '10px', color: T.muted } }, b.siteName),
              h('button', {
                type: 'button',
                style: { border: 'none', background: 'transparent', color: T.muted, cursor: 'pointer', padding: '0 0 0 2px', fontSize: '11px', lineHeight: 1 },
                title: '移除对比',
                onClick: function (ev) { ev.stopPropagation(); removeBook(b.bookKey) },
              }, '×'))
          }),
          !books.length && !st.loading ? h('span', { style: { fontSize: T.fs.xs, color: T.muted } }, '点右上角「＋ 添加作品」挑选 2~6 本书同轴对比走势') : null),

        st.error
          ? ovCardNotice({ error: st.error, onRetry: function () { patch(function (prev) { return { retryTick: (prev.retryTick || 0) + 1 } }) } })
          : st.loading && !books.length
          ? ovCardNotice({ text: '正在读取作品成长曲线…' })
          : !books.length || !yVals.length
            ? ovCardNotice({
                pad: '22px 0',
                text: books.length ? '所选作品在当前窗口暂无「' + (st.yAxis === 'rank' ? '名次' : '在读/收藏') + '」数据，可切换 Y 轴或扩大时间窗' : '暂未选择对比作品',
              })
            : h('div', null,
                h('svg', {
                  viewBox: '0 0 ' + VW + ' ' + VH,
                  style: { width: '100%', height: narrow ? '178px' : '198px', display: 'block', overflow: 'visible' },
                  onMouseLeave: function () { patch({ hoverXIdx: -1, hoverKey: null }) },
                },
                  yTicks.map(function (tv, i) {
                    const yy = yAt(tv)
                    return h('g', { key: 'cy-' + i },
                      h('line', { x1: padL, y1: yy, x2: VW - padR, y2: yy, stroke: T.border, strokeOpacity: 0.45, strokeWidth: 0.75, strokeDasharray: '2 3' }),
                      h('text', { x: padL - 6, y: yy + 3.5, textAnchor: 'end', fontSize: 10, fill: T.muted, style: { fontVariantNumeric: 'tabular-nums' } }, fmtY(tv)))
                  }),
                  st.xAxis === 'date'
                    ? dateTickIdxs.map(function (di) {
                        const d = dates[di]
                        return h('text', { key: 'cx-' + d, x: xAtDate(d), y: VH - 7, textAnchor: 'middle', fontSize: 10, fill: T.muted }, mdOf(d))
                      })
                    : xTicksWords.map(function (wv, wi) {
                        return h('text', { key: 'cw-' + wi, x: xAtWords(wv), y: VH - 7, textAnchor: 'middle', fontSize: 10, fill: T.muted }, fmtWordsShort(wv))
                      }),
                  st.xAxis === 'date' ? dates.map(function (d, di) {
                    const xx = xAtDate(d)
                    const colW = plotW / Math.max(1, dates.length)
                    return h('g', { key: 'ch-' + d },
                      st.hoverXIdx === di ? h('line', { x1: xx, y1: padT, x2: xx, y2: padT + plotH, stroke: T.accent, strokeOpacity: 0.35, strokeWidth: 1, strokeDasharray: '2 2' }) : null,
                      h('rect', { x: Math.max(padL, xx - colW / 2), y: padT, width: colW, height: plotH, fill: 'transparent', onMouseEnter: function () { patch({ hoverXIdx: di }) } }))
                  }) : null,
                  books.map(function (b, idx) {
                    const col = OV_CHART_COLORS[idx % OV_CHART_COLORS.length]
                    const isHover = st.hoverKey === b.bookKey
                    const op = st.hoverKey ? (isHover ? 1 : 0.25) : 0.92
                    const sw = isHover ? 2.6 : 1.9
                    const pts = []
                    ;(b.points || []).forEach(function (p) {
                      const yv = p[yField]
                      if (typeof yv !== 'number' || !Number.isFinite(yv)) return
                      if (st.xAxis === 'words') {
                        if (typeof p.words !== 'number' || !Number.isFinite(p.words) || p.words <= 0) return
                        pts.push({ x: xAtWords(p.words), y: yAt(yv), p: p })
                      } else {
                        pts.push({ x: xAtDate(p.date), y: yAt(yv), p: p })
                      }
                    })
                    if (st.xAxis === 'words') pts.sort(function (a, c) { return a.x - c.x })
                    if (!pts.length) return null
                    const dAttr = pts.map(function (pt, pi) { return (pi === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) }).join(' ')
                    let sdPt = null
                    if (b.shouding) {
                      if (st.xAxis === 'date' && dateIndexMap[b.shouding.date] != null) {
                        const matchP = pts.filter(function (pt) { return pt.p.date === b.shouding.date })[0]
                        sdPt = { x: xAtDate(b.shouding.date), y: matchP ? matchP.y : pts[pts.length - 1].y, label: b.shouding.label }
                      } else if (st.xAxis === 'words' && typeof b.shouding.words === 'number' && b.shouding.words > 0) {
                        sdPt = { x: xAtWords(b.shouding.words), y: pts[pts.length - 1].y, label: b.shouding.label }
                      }
                    }
                    return h('g', { key: 'bc-' + b.bookKey, onMouseEnter: function () { patch({ hoverKey: b.bookKey }) } },
                      pts.length >= 2 ? h('path', { d: dAttr, fill: 'none', stroke: col, strokeWidth: sw, strokeOpacity: op, strokeLinecap: 'round', strokeLinejoin: 'round' }) : null,
                      pts.map(function (pt, pi) {
                        const showDot = pts.length === 1 || pi === pts.length - 1 || (st.xAxis === 'date' && pt.p.date === activeDate)
                        if (!showDot) return null
                        return h('circle', { key: 'dp-' + pi, cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: isHover ? 3.5 : 2.5, fill: col, fillOpacity: op })
                      }),
                      sdPt ? h('g', { key: 'sd-' + b.bookKey },
                        h('line', { x1: sdPt.x, y1: padT, x2: sdPt.x, y2: padT + plotH, stroke: T.warn, strokeOpacity: 0.45, strokeWidth: 1, strokeDasharray: '2 2' }),
                        h('circle', { cx: sdPt.x, cy: sdPt.y, r: 4, fill: T.surface, stroke: T.warn, strokeWidth: 1.8 }),
                        h('text', { x: Math.min(VW - padR - 4, sdPt.x + 5), y: Math.max(padT + 10, sdPt.y - 6), fontSize: 9.5, fill: T.warn, fontWeight: 600 }, sdPt.label)) : null)
                  })),
                h('div', {
                  style: {
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px',
                    padding: '4px 6px', borderRadius: '6px', background: wash(T.fg, 3), fontSize: T.fs.xs, color: T.muted, ...C.num,
                  },
                },
                  activeDate && st.xAxis === 'date' ? h('span', { style: { fontWeight: 600, color: T.fg } }, mdOf(activeDate)) : null,
                  books.map(function (b, idx) {
                    const col = OV_CHART_COLORS[idx % OV_CHART_COLORS.length]
                    const pt = (st.xAxis === 'date' && activeDate)
                      ? ((b.points || []).filter(function (p) { return p.date === activeDate })[0] || null)
                      : ((b.points && b.points.length) ? b.points[b.points.length - 1] : null)
                    const vText = pt ? fmtY(pt[yField]) : '—'
                    const wText = pt && pt.words ? ' · ' + fmtWordsShort(pt.words) : ''
                    return h('span', { key: 'rd-' + b.bookKey, style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                      h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: col } }),
                      h('span', { style: { color: T.fg } }, b.title.slice(0, 10) + (b.title.length > 10 ? '…' : '')),
                      h('span', null, vText + wText))
                  }),
                  st.xAxis === 'words' && wordCurveCount < books.length
                    ? h('span', { style: { marginLeft: 'auto', color: T.warn } }, '部分作品缺少多日字数记录，切 X:日期 可看全量走势')
                    : null)))
    }
