/**
 * 38-overview-keywords.js：概览关键词生态视图组件 KeywordAnalysisCard（枢纽衍生树 + 四站超密细分词云）。依赖 00/10/20/35/37。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    /** 概览关键词分析卡：枢纽衍生树（无站点框、纯站点着色气泡 + 60fps 防碰撞）& 四站超密细分词云 */
    function KeywordAnalysisCard(props) {
      const cfg = props.config || {}
      const narrow = !!props.narrow
      const [st, patch] = useOvState('kw', function () {
        return {
          days: typeof cfg.days === 'number' ? cfg.days : 30,
          mode: 'tree',
          data: null,
          loading: false,
          error: null,
          retryTick: 0,
          rootName: '',
          selectedId: -1,
          hoveredTreeId: -1,
          siteFilter: -1,
          searchVal: '',
          cloudFilter: 'all',
          cHover: null,
          cLock: null,
        }
      })

      const svgRef = React.useRef(null)
      const stateRef = React.useRef({ selectedId: -1, siteFilter: -1, rootId: -1 })
      const syncRef = React.useRef(null)
      const listId = 'rs-kw-datalist-' + (props.cardId || 'main')

      React.useEffect(function () {
        let alive = true
        patch({ loading: true, error: null })
        jget('/keywords?days=' + st.days).then(function (r) {
          if (!alive) return
          patch({ loading: false, error: null, data: (r && r.ok && r.nodes) ? r : null })
        }).catch(function (e) { if (alive) patch({ loading: false, data: null, error: formatOvApiError(e) }) })
        return function () { alive = false }
      }, [st.days, props.rev, props.reloadTick, st.retryTick])

      const model = React.useMemo(function () {
        return st.data && st.data.nodes ? prepareKwModel(st.data.nodes) : null
      }, [st.data])

      const rootId = React.useMemo(function () {
        if (!model || !model.terms.length) return -1
        if (st.rootName && model.byName[st.rootName] != null) return model.byName[st.rootName]
        return model.defaultRootId
      }, [model, st.rootName])

      const treeData = React.useMemo(function () {
        if (!model || rootId < 0) return null
        return buildKwBackboneTree(model, rootId)
      }, [model, rootId])

      stateRef.current.selectedId = st.selectedId
      stateRef.current.siteFilter = st.siteFilter
      stateRef.current.rootId = rootId

      React.useEffect(function () {
        if (st.mode !== 'tree' || !treeData || !treeData.gNodes.length) return undefined
        const mounted = mountKwBackboneSvg(svgRef.current, treeData, stateRef, {
          onHover: function (id) { patch({ hoveredTreeId: id }) },
          onSelect: function (id) { patch({ selectedId: id }) },
          onReroot: function (k) { patch({ rootName: k, selectedId: -1, hoveredTreeId: -1 }) },
        })
        if (!mounted) return undefined
        syncRef.current = mounted.sync
        return function () { syncRef.current = null; mounted.destroy() }
      }, [st.mode, treeData])

      React.useEffect(function () {
        if (syncRef.current) syncRef.current()
      }, [st.selectedId, st.siteFilter])

      const activeSiteIdx = st.mode === 'tree' ? -1 : Number(st.mode)
      const cloudPack = React.useMemo(function () {
        if (activeSiteIdx < 0 || !st.data || !st.data.clouds) return null
        return packKwWordCloud(st.data.clouds[KW_SITES[activeSiteIdx].id] || [], st.cloudFilter)
      }, [activeSiteIdx, st.data, st.cloudFilter])

      const applySearch = function (val) {
        if (!model || !val) return
        const q = String(val).trim()
        if (!q) return
        const hitName = model.byName[q] != null
          ? q
          : ((model.terms.filter(function (t) { return t.k.indexOf(q) >= 0 })[0] || {}).k || null)
        if (hitName) patch({ rootName: hitName, selectedId: -1, mode: 'tree', searchVal: '' })
      }

      const switchDays = function (d) {
        patch({ days: d, selectedId: -1, hoveredTreeId: -1, cLock: null, cHover: null })
        if (props.onConfigChange) props.onConfigChange({ days: d })
      }

      const cloudsObj = (st.data && st.data.clouds) || {}
      const rootTerm = model && rootId >= 0 ? model.terms[rootId] : null
      const activeTreeId = st.hoveredTreeId >= 0 ? st.hoveredTreeId : st.selectedId
      const activeTreeTerm = model && activeTreeId >= 0 ? model.terms[activeTreeId] : null

      const treeFootNode = (function () {
        if (!rootTerm || !treeData) return null
        if (activeTreeTerm) {
          const sStr = KW_SITES.map(function (s, i) { return activeTreeTerm.sc[i] ? s.name + activeTreeTerm.sc[i] + '本' : '' }).filter(Boolean).join('·')
          const isMono = activeTreeTerm.top1 >= 48 || activeTreeTerm.n <= 2
          const chain = []
          let c = activeTreeId
          while (treeData.inTree[c]) {
            chain.unshift(model.terms[c].k)
            c = treeData.inTree[c].parentId
            if (c < 0) break
          }
          return h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: T.fs.xs, color: T.muted, ...C.num } },
            h('span', { style: { color: T.fg, fontWeight: 500 } },
              '「' + activeTreeTerm.k + '」热 ' + activeTreeTerm.heat + ' · ' + activeTreeTerm.n + ' 本（' + sStr + '） · ',
              h('span', { style: { color: isMono ? T.warn : T.ok } }, isMono ? '少书拉高(' + activeTreeTerm.top1 + '%)' : '多书共荣(头书' + activeTreeTerm.top1 + '%)')),
            h('span', { style: { color: T.muted } }, chain.length > 1 ? '路径：' + chain.join(' → ') : '当前中心枢纽'))
        }
        const rStr = KW_SITES.map(function (s, i) { return rootTerm.sc[i] ? s.name + rootTerm.sc[i] : '' }).filter(Boolean).join('·')
        return h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: T.fs.xs, color: T.muted, ...C.num } },
          h('span', { style: { color: T.fg, fontWeight: 500 } },
            '中心「' + rootTerm.k + '」（' + rStr + '）· ' + treeData.gNodes.length + ' 词单连通骨架'),
          h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '8px' } },
            h('span', null, '双环=桥梁枢纽'),
            h('span', null, '实线=主骨架 · 虚线=跨枝共现'),
            h('span', { style: { color: T.warn } }, '虚边=少书拉高')))
      })()

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px 10px' } },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
          h('div', { className: 'rs-ov-seg' },
            h('button', {
              type: 'button',
              className: 'rs-ov-seg-btn' + (st.mode === 'tree' ? ' is-on' : ''),
              onClick: function () { patch({ mode: 'tree', cLock: null, cHover: null }) },
            }, '枢纽衍生树'),
            KW_SITES.map(function (s, si) {
              const cnt = Array.isArray(cloudsObj[s.id]) ? cloudsObj[s.id].length : 0
              return h('button', {
                key: 'kwt-' + s.id, type: 'button',
                className: 'rs-ov-seg-btn' + (st.mode === String(si) ? ' is-on' : ''),
                style: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
                onClick: function () { patch({ mode: String(si), cLock: null, cHover: null }) },
              },
                h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: s.color } }),
                h('span', null, s.name),
                cnt > 0 ? h('span', { style: { opacity: 0.65, fontSize: T.fs.xs } }, String(cnt)) : null)
            })),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' } },
            h('div', { className: 'rs-ov-seg' },
              [{ d: 7, l: '7天' }, { d: 14, l: '14天' }, { d: 30, l: '30天' }, { d: 0, l: '全库' }].map(function (o) {
                return h('button', {
                  key: 'kwd-' + o.d, type: 'button',
                  className: 'rs-ov-seg-btn' + (st.days === o.d ? ' is-on' : ''),
                  onClick: function () { switchDays(o.d) },
                }, o.l)
              })),
            st.mode === 'tree' ? h('input', {
              className: 'rs-input', list: listId,
              style: { ...C.input, height: '24px', width: '112px', fontSize: T.fs.xs, padding: '0 6px' },
              placeholder: '搜细词设中心…',
              value: st.searchVal,
              onChange: function (ev) { patch({ searchVal: ev.target.value }) },
              onKeyDown: function (ev) { if (ev.key === 'Enter') applySearch(st.searchVal) },
              onBlur: function () { if (st.searchVal && model && model.byName[st.searchVal.trim()] != null) applySearch(st.searchVal) },
            }) : null,
            st.mode === 'tree' && st.selectedId >= 0 && st.selectedId !== rootId && model && model.terms[st.selectedId]
              ? h('button', {
                  type: 'button', className: 'rs-ov-chip is-on',
                  onClick: function () { patch({ rootName: model.terms[st.selectedId].k, selectedId: -1 }) },
                }, '以「' + model.terms[st.selectedId].k + '」重排树')
              : null,
            st.mode === 'tree'
              ? h('button', {
                  type: 'button',
                  className: 'rs-ov-chip' + (model && rootId === model.defaultRootId && st.selectedId < 0 && st.siteFilter < 0 ? ' is-on' : ''),
                  onClick: function () { patch({ rootName: '', selectedId: -1, siteFilter: -1 }) },
                }, '全盘骨架')
              : h('div', { className: 'rs-ov-seg' },
                  [{ k: 'all', l: '全部细词' }, { k: 'multi', l: '多书真风口' }, { k: 'mono', l: '单/少书拉高' }].map(function (o) {
                    return h('button', {
                      key: 'cf-' + o.k, type: 'button',
                      className: 'rs-ov-seg-btn' + (st.cloudFilter === o.k ? ' is-on' : ''),
                      onClick: function () { patch({ cloudFilter: o.k, cLock: null, cHover: null }) },
                    }, o.l)
                  })))),

        model ? h('datalist', { id: listId }, model.terms.map(function (t) { return h('option', { key: 'opt-' + t.k, value: t.k }) })) : null,

        st.mode === 'tree'
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' } },
                h('span', { style: { fontSize: T.fs.xs, color: T.muted } }, '中心枢纽：'),
                (model && model.quickRoots ? model.quickRoots : []).map(function (k) {
                  const ti = model.byName[k]
                  const t = ti != null ? model.terms[ti] : null
                  return h('button', {
                    key: 'qr-' + k, type: 'button',
                    className: 'rs-ov-chip' + (rootTerm && rootTerm.k === k ? ' is-on' : ''),
                    title: t ? ('热 ' + t.heat + ' · ' + t.n + ' 本 · 桥梁分 ' + t.bridge.toFixed(1)) : k,
                    onClick: function () { patch({ rootName: k, selectedId: -1 }) },
                  }, k)
                })),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px' } },
                KW_SITES.map(function (s, si) {
                  return h('button', {
                    key: 'sf-' + s.id, type: 'button',
                    className: 'rs-ov-sdot' + (st.siteFilter === si ? ' is-on' : ''),
                    style: { color: st.siteFilter === si ? s.color : T.muted },
                    onClick: function () { patch(function (prev) { return { siteFilter: prev.siteFilter === si ? -1 : si } }) },
                  },
                    h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: s.color } }),
                    h('span', null, s.name))
                })))
          : (cloudPack ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: T.fs.xs, color: T.muted } },
              h('span', null,
                h('strong', { style: { color: T.fg } }, KW_SITES[activeSiteIdx].name),
                ' ' + (st.days ? '近 ' + st.days + ' 天' : '全库') + '细分词云 · 实排 ',
                h('strong', { style: { color: T.fg } }, String(cloudPack.placed.length)),
                ' / ' + cloudPack.total + ' 词 · ',
                h('span', { style: { color: KW_SITES[activeSiteIdx].color } }, '主色'), '=头部 · ',
                h('span', { style: { color: T.warn } }, '暖琥珀'), '=少书拉高')) : null),

        st.error
          ? ovCardNotice({ error: st.error, onRetry: function () { patch(function (prev) { return { retryTick: (prev.retryTick || 0) + 1 } }) } })
          : st.loading && !st.data
          ? ovCardNotice({ pad: '36px 0', text: '正在提取细分关键词与衍生关系…' })
          : !model || !model.terms.length
            ? ovCardNotice({ pad: '32px 0', text: '当前时间窗口暂无足够的本地作品数据' })
            : st.mode === 'tree'
              ? h('div', {
                  key: 'kw-stage-tree',
                  style: {
                    width: '100%', overflow: 'hidden', borderRadius: '6px',
                    border: '1px solid ' + wash(T.border, 65), background: wash(T.fg, 2),
                  },
                },
                  h('svg', {
                    key: 'kw-svg-tree',
                    ref: svgRef, viewBox: '0 0 ' + KW_TREE_VW + ' ' + KW_TREE_VH,
                    style: { width: '100%', height: narrow ? '310px' : '406px', display: 'block', cursor: 'grab' },
                  }))
              : (function () {
                  const sm = KW_SITES[activeSiteIdx]
                  const pk = cloudPack
                  if (!pk) return null
                  if (!pk.placed.length) return ovCardNotice({ pad: '32px 0', text: sm.name + ' 当前勾选频道暂无匹配的细分词样本' })
                  const actTermName = st.cHover != null ? st.cHover : st.cLock
                  const actW = actTermName != null ? pk.list.filter(function (x) { return x.k === actTermName })[0] || null : null
                  const multiTop = pk.list.filter(function (x) { return !x.isMono }).slice(0, 7)
                  const monoTop = pk.list.filter(function (x) { return x.isMono }).slice(0, 4)
                  const termInfo = actW && model.byName[actW.k] != null ? model.terms[model.byName[actW.k]] : null
                  return h('div', {
                    key: 'kw-stage-cloud-' + activeSiteIdx,
                    style: {
                      display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 2.15fr) minmax(190px, 0.78fr)',
                      border: '1px solid ' + wash(T.border, 65), borderRadius: '6px', overflow: 'hidden',
                    },
                  },
                    h('svg', {
                      key: 'kw-svg-cloud-' + activeSiteIdx,
                      viewBox: '0 0 ' + pk.W + ' ' + pk.H,
                      style: { width: '100%', height: narrow ? '290px' : '392px', display: 'block' },
                      onClick: function () { if (st.cLock != null) patch({ cLock: null, cHover: null }) },
                    },
                      pk.placed.map(function (p) {
                        const w = p.w
                        const col = w.isMono ? T.warn : (p.idx < 10 ? sm.color : (p.idx < 42 ? T.fg : T.muted))
                        const fw = p.idx < 4 ? 700 : p.idx < 15 ? 600 : p.idx < 42 ? 500 : 400
                        const baseOp = w.isMono ? 0.88 : (p.idx < 10 ? 0.96 : (p.idx < 42 ? 0.82 : 0.68))
                        const op = actTermName != null ? (w.k === actTermName ? 1 : 0.15) : baseOp
                        return h('text', {
                          key: 'wc-' + w.k, className: 'rs-kw-word',
                          x: p.x.toFixed(1), y: (p.y + p.fs * 0.35).toFixed(1),
                          transform: p.vert ? 'rotate(-90 ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')' : undefined,
                          textAnchor: 'middle', fill: col, fontSize: p.fs, fontWeight: fw, opacity: op,
                          onMouseEnter: function () { patch({ cHover: w.k }) },
                          onMouseLeave: function () { patch({ cHover: null }) },
                          onClick: function (ev) {
                            ev.stopPropagation()
                            if (st.cLock === w.k) patch({ rootName: w.k, selectedId: -1, cLock: null, cHover: null, mode: 'tree' })
                            else patch({ cLock: w.k, cHover: null })
                          },
                        }, w.k)
                      })),
                    h('div', {
                      style: {
                        padding: '8px 10px',
                        borderLeft: narrow ? 'none' : ('1px solid ' + wash(T.border, 65)),
                        borderTop: narrow ? ('1px solid ' + wash(T.border, 65)) : 'none',
                        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px', fontSize: T.fs.xs,
                      },
                    },
                      actW
                        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                            h('div', { style: { paddingBottom: '6px', borderBottom: '1px solid ' + wash(T.border, 55), display: 'flex', flexDirection: 'column', gap: '3px' } },
                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
                                h('span', { style: { fontSize: T.fs.m, fontWeight: 600, color: T.fg } }, actW.k),
                                st.cLock != null ? h('button', { type: 'button', className: 'rs-ov-chip', onClick: function () { patch({ cLock: null, cHover: null }) } }, '← 总览') : null),
                              h('div', { style: { color: T.muted, ...C.num } },
                                '热度 ', h('strong', { style: { color: T.fg } }, actW.v + '%'),
                                ' · ' + actW.n + ' 本' + (termInfo && termInfo.p >= 0 ? ' · 属「' + model.terms[termInfo.p].k + '」' : ' · 核心母题')),
                              h('div', { style: { color: actW.isMono ? T.warn : T.ok } },
                                actW.isMono ? '○ 少书/单书带飞（头书 ' + actW.top1 + '%）' : '● 多书共荣（头书 ' + actW.top1 + '%）')),
                            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                              h('div', { style: { color: T.muted } }, '本站头书（' + (activeSiteIdx === 0 ? '在读' : '收藏') + '）'),
                              h('div', { style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + wash(T.border, 65) } },
                                h('div', { style: { fontWeight: 500, color: T.fg, lineHeight: 1.35 } }, '《' + actW.sb + '》'),
                                h('div', { style: { color: T.muted, marginTop: '2px', ...C.num } }, ovFmtBrief(actW.tv)))),
                            termInfo && termInfo.rels.length
                              ? h('div', { style: { color: T.muted } }, '强关联：' + termInfo.rels.slice(0, 3).map(function (r) { return model.terms[r.i].k }).join(' · '))
                              : null)
                        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                            h('div', { style: { fontWeight: 600, color: T.fg, paddingBottom: '4px', borderBottom: '1px solid ' + wash(T.border, 55) } }, sm.name + ' · 细分透视'),
                            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                              h('div', { style: { color: T.ok, fontWeight: 500 } }, '● 多书真风口 Top 7'),
                              multiTop.map(function (w) {
                                return h('div', { key: 'mt-' + w.k, className: 'rs-ov-dir-row', onClick: function () { patch({ cLock: w.k, cHover: null }) } },
                                  h('span', { style: { color: T.fg, flex: '1 1 auto' } }, w.k),
                                  h('span', { style: { color: T.muted, ...C.num } }, w.v + '%·' + w.n + '本'))
                              })),
                            monoTop.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '5px', borderTop: '1px solid ' + wash(T.border, 55) } },
                              h('div', { style: { color: T.warn, fontWeight: 500 } }, '○ 单/少书带飞预警'),
                              monoTop.map(function (w) {
                                return h('div', { key: 'mn-' + w.k, className: 'rs-ov-dir-row', onClick: function () { patch({ cLock: w.k, cHover: null }) } },
                                  h('span', { style: { color: T.fg, flex: '1 1 auto' } }, w.k),
                                  h('span', { style: { color: T.muted, ...C.num } }, w.n + '本·' + w.top1 + '%'))
                              })) : null),
                      actW ? h('button', {
                        type: 'button', className: 'rs-btn', style: { width: '100%', height: '26px', fontSize: T.fs.xs },
                        onClick: function () { patch({ rootName: actW.k, selectedId: -1, cLock: null, cHover: null, mode: 'tree' }) },
                      }, '以「' + actW.k + '」为枢纽展开树 ›') : null))
                })(),

        st.mode === 'tree' ? treeFootNode : (cloudPack ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: T.fs.xs, color: T.muted, ...C.num } },
          h('span', null,
            (st.data && st.data.meta && st.data.meta.dateRange ? st.data.meta.dateRange + ' · ' : '')
            + '样本 ' + ((st.data && st.data.meta && st.data.meta.totalBooks) || 0) + ' 本 · '
            + KW_SITES[activeSiteIdx].name + '命中 ' + cloudPack.total + ' 细词')) : null))
    }
