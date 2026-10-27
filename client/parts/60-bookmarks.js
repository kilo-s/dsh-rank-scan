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
        store.act({ action: 'update', bookKey: bk, note: note, folders: String(folders || '').split(/[\s,，]+/).filter(Boolean) })
          .then(function () { setBusy(false); toast('success', '书签已保存'); return store.refreshList() })
          .catch(function (e) { setBusy(false); toast('error', '保存失败：' + e + '（草稿还在）') })
      }
      return h('div', { style: { ...C.detail, marginTop: '6px' } },
        h('div', { style: C.row },
          h('span', { style: C.muted }, '备注'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '160px' }, value: note, placeholder: '写点什么，可用 #标签', onChange: function (e) { setNote(e.target.value) } })),
        h('div', { style: C.row },
          h('span', { style: C.muted }, '书签夹'),
          h('input', { style: { ...C.input, flex: 1, minWidth: '120px' }, value: folders, placeholder: '空格分隔，可属于多个夹', onChange: function (e) { setFolders(e.target.value) } }),
          h('button', { className: 'rs-btn is-primary', disabled: busy || !loaded, onClick: save }, busy ? '保存中…' : '保存')))
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
      const editBaseRef = React.useRef(DRAFTS.bm && DRAFTS.bm.base ? DRAFTS.bm.base : null)
      const [editErr, setEditErr] = React.useState(null)
      const [editBusy, setEditBusy] = React.useState(false)
      const [discardAsk, setDiscardAsk] = React.useState(false)
      /**
       * ★ Spec D（2026-10-24 审查）：A 还有未保存草稿时点 B 的备注，
       *   旧实现直接覆盖 A 的草稿（连 sessionStorage 一起换掉）。
       *   现在先问：「继续编辑」保 A，「放弃并切换」才换 B。
       */
      const [switchAsk, setSwitchAsk] = React.useState(null)
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
      // Keep the edit baseline independent of filtered search results.
      const editingBook = function () {
        return editKey ? editBaseRef.current || list.filter(function (x) { return x.bookKey === editKey })[0] : null
      }
      const editDirty = function () {
        const b = editingBook()
        return b ? dirtyOf(b) : !!(editKey && DRAFTS.bm && DRAFTS.bm.dirty)
      }
      /** 草稿写回组件外 + 登记脏状态（面板切页/收起前据此拦一下） */
      React.useEffect(function () {
        if (!editKey) { DRAFTS.bm = null; dirtyGuard.set('bm', false); return }
        const b = editingBook()
        if (b && !editBaseRef.current) editBaseRef.current = b
        const dirty = editDirty()
        DRAFTS.bm = { bookKey: editKey, note: draft.note, folders: draft.folders, dirty: dirty, base: b || null }
        dirtyGuard.set('bm', dirty)
      }, [editKey, draft.note, draft.folders, store.total])
      /** 保存回调要知道「现在还在编辑哪一本」，否则会连另一本的草稿一起清掉 */
      const editKeyRef = React.useRef(editKey)
      React.useEffect(function () { editKeyRef.current = editKey }, [editKey])
      const applyEdit = function (b) {
        editBaseRef.current = { bookKey: b.bookKey, note: b.note, folders: (b.folders || []).slice() }
        setEditKey(b.bookKey)
        setDraft({ note: String(b.note || ''), folders: (b.folders || []).join(' ') })
        setEditErr(null)
        setDiscardAsk(false)
        setSwitchAsk(null)
      }
      const startEdit = function (b) {
        // 同一条重复点：保留正在写的草稿（不要用库里旧值把它清回去）
        if (editKey === b.bookKey) return
        if (editDirty()) { setDiscardAsk(false); setSwitchAsk(b); return }
        applyEdit(b)
      }
      const closeEdit = function () { setEditKey(null); setDraft({ note: '', folders: '' }); setEditErr(null); setDiscardAsk(false); setSwitchAsk(null) }
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
          .then(function () {
            setEditBusy(false)
            /**
             * ★ Spec D：保存期间用户可能已经切到另一本书签 —— 这时只能收掉**这一本**的编辑态；
             *   旧实现无条件 closeEdit()，会把刚打开的 B 连同它的草稿一起清掉。
             */
            if (editKeyRef.current === b.bookKey) closeEdit()
            bump()
          })
          .catch(function (e) {
            setEditBusy(false)
            if (editKeyRef.current === b.bookKey) setEditErr('保存失败：' + e + '　（草稿还在，可再试一次）')
            else { toast('error', '「' + (b.label || b.bookKey) + '」保存失败：' + e); bump() }
          })
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
          store.msg = null
          toast('success', (r && r.note) || '已更新')
          return store.refreshList()
        }).then(function () { bump() }).catch(function (e) { store.msg = null; toast('error', '更新失败：' + e); bump() })
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
          store.msg = null
          toast('success', (r && r.note) || '已添加')
          setManual('')
          return store.refreshList()
        }).then(function () { bump() }).catch(function (e) { store.msg = null; toast('error', '添加失败：' + e); bump() })
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
          h('button', { className: filtersOpen ? 'rs-btn is-on' : 'rs-btn', onClick: function () { setFiltersOpen(!filtersOpen) }, 'aria-expanded': filtersOpen ? 'true' : 'false' }, '筛选'),
          h(PopMenu, { label: '更多', items: moreItems, width: 200 })),
        filtersOpen ? h('div', { style: { ...C.row, padding: '4px 6px', border: '1px solid ' + T.border, borderRadius: '6px' } },
          h('span', { style: C.muted }, '标签'),
          h('input', { style: { ...C.input, width: '120px' }, placeholder: '#标签', value: f.tag || '', onChange: function (e) { setF({ tag: String(e.target.value).replace(/^#/, '') }) } }),
          (f.q || f.site || f.folder || f.tag) ? h('button', { className: 'rs-btn', onClick: function () { setF({ q: '', site: '', folder: '', tag: '' }) } }, '清除筛选') : null,
          h('span', { style: C.muted }, '备注里写的 #标签 会自动出现在这里')) : null,
        addOpen ? h('div', { style: { ...C.card, marginTop: '4px' } },
          h('div', { style: C.row },
            h('span', { style: C.muted }, '添加作品'),
            h('input', { style: { ...C.input, flex: 1, minWidth: '150px' }, placeholder: '贴书页 URL 或 qidian:<书号>（纯书号请选站）', value: manual, onChange: function (e) { setManual(e.target.value) } }),
            h('select', { style: C.input, value: manualSite, onChange: function (e) { setManualSite(e.target.value) } },
              h('option', { value: '' }, '（URL 可自动识别）'),
              h('option', { value: 'qidian' }, '起点'), h('option', { value: 'qidiantu' }, '起点图'), h('option', { value: 'ciweimao' }, '刺猬猫'), h('option', { value: 'sfacg' }, '菠萝包'), h('option', { value: 'fanqie' }, '番茄')),
            h('button', { className: 'rs-btn', disabled: !String(manual || '').trim(), onClick: addManual }, '加入书签'),
            h('button', { className: 'rs-btn', onClick: function () { setAddOpen(false) } }, '收起'))) : null,
        switchAsk ? h(Banner, { tone: 'warn' },
          h('div', { style: { fontWeight: 600, flex: '1 1 100%' } }, '「' + (switchAsk.label || switchAsk.bookKey) + '」还开着没保存的备注/夹'),
          h('div', { style: C.row },
            h('button', { className: 'rs-btn is-primary', onClick: function () { setSwitchAsk(null) } }, '继续编辑'),
            h('button', { className: 'rs-btn', onClick: function () { applyEdit(switchAsk) } }, '放弃并切换')),
          h('div', { style: C.muted }, '继续编辑：刚才写的内容还在。放弃并切换：只丢当前这条的未保存改动。')) : null,
        h('div', { style: C.muted }, (store.list === null ? '加载中…' : '共 ' + list.length + ' 条' + (store.total && store.total !== list.length ? '（全部 ' + store.total + ' 条，已按筛选）' : '') + '　·　不含回收站')),
        store.health && store.health.error ? h('div', { style: { ...C.muted, color: T.bad } }, '⚠ ' + store.health.error) : null,
        selectMode ? h('div', { style: { ...C.row, padding: '4px 6px', border: '1px solid ' + T.border, borderRadius: '6px', background: T.subtle } },
          h('span', null, '已选 ' + sel.length + ' 条'),
          h('button', { className: 'rs-btn', onClick: function () { setSel(list.map(function (b) { return b.bookKey })) } }, '全选当前筛选（' + list.length + '）'),
          h('button', { className: 'rs-btn', disabled: !sel.length, onClick: function () { setSel([]) } }, '取消选择'),
          h('button', { className: 'rs-btn', disabled: !sel.length, onClick: function () { setScope('selected'); setExportOpen(true) } }, '导出已选'),
          h('button', { className: 'rs-btn', onClick: function () { setSelectMode(false); setSel([]) } }, '退出批量选择')) : null,
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
            h('button', { className: 'rs-btn', disabled: exporting || scopeCount() === 0, title: scopeCount() === 0 ? '这个范围没有条目' : '', onClick: doExport }, exporting ? '导出中…' : '导出 ' + scopeCount() + ' 条'),
            h('button', { className: 'rs-btn', onClick: function () { jpost('/bookmark/open-folder', { path: String(dest || '').trim() || undefined }).then(function (r) { setExMsg('已打开 ' + ((r && r.opened) || '')) }).catch(function (e) { setExMsg('打不开：' + e) }) } }, '打开文件夹'),
            h('button', { className: 'rs-btn', onClick: function () { setExportOpen(false) } }, '收起')),
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
              b.ageDays != null && b.ageDays >= 7 ? h('span', { style: { ...C.chip, color: T.warn }, title: '超过 7 天没有变新：点「更新本书数据」试试；仍不变则这个来源可能取不到数了' }, '数据已 ' + b.ageDays + ' 天未更新') : null,
              b.valueFrom === 'manual' ? h('span', { style: C.chip }, '待补') : null),
            h('div', { style: C.row },
              h('button', {
                className: 'rs-btn', style: { borderStyle: 'dashed', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
                h('button', { className: switchAsk ? 'rs-btn' : 'rs-btn is-primary', disabled: editBusy, onClick: function () { saveEdit(b) } }, editBusy ? '保存中…' : '保存'),
                h('button', { className: 'rs-btn', disabled: editBusy, onClick: function () { cancelEdit(b) } }, '取消'),
                discardAsk
                  ? h('span', { style: { ...C.row, color: T.warn } },
                      h('span', null, '放弃这些改动？'),
                      h('button', { className: 'rs-btn', onClick: function () { closeEdit() } }, '放弃'),
                      h('button', { className: 'rs-btn', onClick: function () { setDiscardAsk(false) } }, '继续编辑'))
                  : null,
                editErr ? h('span', { style: { color: T.bad } }, editErr) : null)) : null,
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
        undo ? h(Banner, { tone: 'warn' },
          h('span', null, '已删除「' + undo.label + '」'),
          h('button', { className: 'rs-btn', onClick: doUndo }, '撤销'),
          h('span', { style: C.muted }, '（8 秒内；之后可在回收站找回）')) : null,
        showTrash ? h('div', { style: { marginTop: '8px', padding: '6px 8px', border: '1px solid ' + T.border, borderRadius: '8px' } },
          h('div', { style: C.row },
            h('span', { style: { fontWeight: 600 } }, '回收站（' + trash.length + '）'),
            trash.length
              ? (confirmPurge
                  ? h('span', { style: C.row },
                      h('span', { style: { color: T.bad } }, '清空后不可恢复，确定？'),
                      h('button', { className: 'rs-btn is-danger', onClick: function () { jpost('/bookmark', { action: 'purge', bookKeys: trash.map(function (b) { return b.bookKey }) }).then(function () { setConfirmPurge(false); load() }) } }, '确认清空'),
                      h('button', { className: 'rs-btn', onClick: function () { setConfirmPurge(false) } }, '取消'))
                  : h('button', { className: 'rs-btn', onClick: function () { setConfirmPurge(true) } }, '清空回收站'))
              : null),
          trash.length === 0 ? h('div', { style: C.muted }, '回收站是空的') : trash.map(function (b) {
            return h('div', { key: 'tr' + b.bookKey, style: { ...C.card, opacity: 0.8 } },
              h('div', { style: C.row },
                h('span', { style: C.cardTitle }, b.label),
                h('span', { style: C.muted }, '删除于 ' + String(b.deletedAt).slice(0, 10) + '　还可找回 ' + b.daysLeft + ' 天'),
                h('button', { className: 'rs-btn', onClick: function () { store.act({ action: 'restore', bookKey: b.bookKey }).then(function () { load() }).catch(function () {}) } }, '恢复')))
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
