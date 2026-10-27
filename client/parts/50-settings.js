    const settingsDiff = function (saved, draft) {
      const out = []
      if (!saved || !draft) return out
      const a = Array.isArray(saved.captures) ? saved.captures.slice().sort() : []
      const b = Array.isArray(draft.captures) ? draft.captures.slice().sort() : []
      if (a.length !== b.length || a.some(function (x, i) { return x !== b[i] })) out.push('抓取范围')
      if (!!saved.autoEnrich !== !!draft.autoEnrich) out.push('自动补全')
      if (!!saved.qidianEnrich !== !!draft.qidianEnrich) out.push('起点收藏补全')
      if (Number(saved.requestIntervalMs) !== Number(draft.requestIntervalMs)) out.push('请求间隔')
      const st = saved.siteTimes || {}
      const dt = draft.siteTimes || {}
      const keys = Object.keys(Object.assign({}, st, dt))
      if (keys.some(function (k) { return String(st[k] || '') !== String(dt[k] || '') })) out.push('计划时刻')
      if (String(saved.fallbackTime || '') !== String(draft.fallbackTime || '')) out.push('兜底时刻')
      // 保留天数在 /overview 到达前是未知（null）：先不参与 diff，避免把「读取中」误判成改动
      if (saved.retentionDays != null && draft.retentionDays != null && String(saved.retentionDays) !== String(draft.retentionDays)) out.push('保留天数')
      return out
    }
    const daysOf = function (v) { return v === 'forever' ? Infinity : Number(v) }
    /** 只有两边都已知且草稿更短才算「会删数据」；未知时绝不弹删除确认 */
    const retentionShortensOf = function (saved, draft) {
      if (!saved || !draft) return false
      if (saved.retentionDays == null || draft.retentionDays == null) return false
      return daysOf(draft.retentionDays) < daysOf(saved.retentionDays)
    }
    /** 从 /catalog + overview 生成「已保存」快照 */
    const settingsSavedFrom = function (c, ov) {
      const t = (c && c.timer) || {}
      const rd = ov && ov.storage && (typeof ov.storage.retentionDays === 'number' || ov.storage.retentionDays === 'forever') ? ov.storage.retentionDays : null
      return {
        captures: ((c && c.captures) || []).slice(),
        autoEnrich: !(c && c.autoEnrich === false),
        qidianEnrich: !!(c && c.qidian && c.qidian.enrich),
        requestIntervalMs: c && typeof c.requestIntervalMs === 'number' ? c.requestIntervalMs : 1000,
        siteTimes: Object.assign({}, (t && t.siteTimes) || {}),
        fallbackTime: (t && t.fallbackTime) || '22:30',
        retentionDays: rd,
      }
    }
    /** 旧草稿（picked/times/fall）→ 新草稿形状；缺失字段回落到已保存快照 */
    const settingsDraftFrom = function (d, saved) {
      const sv = saved || {}
      return {
        captures: Array.isArray(d.captures) ? d.captures.slice() : (Array.isArray(d.picked) ? d.picked.slice() : (sv.captures || []).slice()),
        autoEnrich: typeof d.autoEnrich === 'boolean' ? d.autoEnrich : !!sv.autoEnrich,
        qidianEnrich: typeof d.qidianEnrich === 'boolean' ? d.qidianEnrich : !!sv.qidianEnrich,
        requestIntervalMs: typeof d.requestIntervalMs === 'number' ? d.requestIntervalMs : (typeof sv.requestIntervalMs === 'number' ? sv.requestIntervalMs : 1000),
        siteTimes: d.siteTimes && typeof d.siteTimes === 'object' ? Object.assign({}, d.siteTimes) : (d.times && typeof d.times === 'object' ? Object.assign({}, d.times) : Object.assign({}, sv.siteTimes || {})),
        fallbackTime: typeof d.fallbackTime === 'string' ? d.fallbackTime : (typeof d.fall === 'string' ? d.fall : (sv.fallbackTime || '22:30')),
        retentionDays: (typeof d.retentionDays === 'number' || d.retentionDays === 'forever') ? d.retentionDays : (sv.retentionDays == null ? null : sv.retentionDays),
      }
    }
    /**
     * 设置页保存语义（0.4.1）：
     *   · 即时生效：只有「定时扫描」开关（乐观置位 + 失败回滚，结果走 Toast）。
     *   · 草稿 + 底栏保存：抓取范围、自动补全、起点收藏补全、请求间隔、各站计划时刻、兜底时刻、保留天数。
     *   · 动作按钮（不是设置，点了就做）：补全起点收藏、清空书页缓存、补齐缺失（按站批量）、复制诊断、检查更新；
     *     保持原行为，结果走 Toast。
     */
    function SettingsTab(props) {
      const ov = props.ov
      const ovRef = React.useRef(ov)
      ovRef.current = ov
      const [cat, setCat] = React.useState(null)
      const [picked, setPicked] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [autoEnrich, setAutoEnrich] = React.useState(true)
      const [qdEnrich, setQdEnrich] = React.useState(false)
      const [qdCache, setQdCache] = React.useState(null)
      const [intervalMs, setIntervalMs] = React.useState(1000)
      const [tOn, setTOn] = React.useState(false)
      const [tTimes, setTTimes] = React.useState({})
      const [tFall, setTFall] = React.useState('22:30')
      const [tLast, setTLast] = React.useState(null)
      const [planLive, setPlanLive] = React.useState(null)
      const [retentionDays, setRetentionDays] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const savedRef = React.useRef(null)
      const [barNote, setBarNote] = React.useState('')
      const [retentionConfirm, setRetentionConfirm] = React.useState(false)
      const lastNote = useLastNote()
      /** 站分组默认展开（含已勾选榜的站更该展开）；只记「被收起」的，避免新站默认藏着 */
      const [closedGroups, setClosedGroups] = React.useState({})
      const load = React.useCallback(function () {
        jget('/catalog').then(function (c) {
          setCat(c)
          const sv = settingsSavedFrom(c, ovRef.current)
          savedRef.current = sv
          setSaved(sv)
          setPicked(sv.captures.slice())
          setAutoEnrich(sv.autoEnrich)
          setQdEnrich(sv.qidianEnrich)
          setQdCache(c.qidian || null)
          setIntervalMs(sv.requestIntervalMs)
          setRetentionDays(sv.retentionDays)
          noteRequestInterval(sv.requestIntervalMs)
          const t = c.timer || {}
          setTOn(t.enabled === true)
          setTTimes(Object.assign({}, sv.siteTimes))
          setTFall(sv.fallbackTime)
          setTLast(t)
          // ★ 组件被卸载过：草稿优先（不拿服务端值盖掉用户没保存的选择）
          const d = DRAFTS.settings
          if (d) {
            const dd = settingsDraftFrom(d, sv)
            setPicked(dd.captures.slice())
            setAutoEnrich(dd.autoEnrich)
            setQdEnrich(dd.qidianEnrich)
            setIntervalMs(dd.requestIntervalMs)
            setTTimes(Object.assign({}, dd.siteTimes))
            setTFall(dd.fallbackTime)
            setRetentionDays(dd.retentionDays)
            setBarNote('已恢复未保存的改动（还没保存）')
          } else {
            setBarNote('')
          }
        }).catch(function (e) {
          toast('error', '设置加载失败：' + e)
          setBarNote('设置加载失败：' + e)
        })
      }, [])
      React.useEffect(function () { load() }, [load])
      /**
       * /overview 可能晚于 /catalog 到达（面板直接停在设置页时尤其常见）：
       * 保留天数未知时先禁用 select、不参与 diff；值到达或变化后补进 saved，
       * 草稿里的保留天数若当时不脏，跟着同步，避免把「变长」误判成「删数据」。
       */
      React.useEffect(function () {
        const rd = ov && ov.storage && (typeof ov.storage.retentionDays === 'number' || ov.storage.retentionDays === 'forever') ? ov.storage.retentionDays : null
        if (rd == null) return
        const sv = savedRef.current
        if (!sv) return
        const old = sv.retentionDays
        if (String(old) === String(rd)) return
        const next = Object.assign({}, sv, { retentionDays: rd })
        savedRef.current = next
        setSaved(next)
        setRetentionDays(function (cur) {
          if (cur == null || String(cur) === String(old)) return rd
          return cur
        })
      }, [ov])
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
      /** 统一草稿：设置项全部走这个对象；顺序固定，便于比较与持久化 */
      const draft = {
        captures: (picked || []).slice(),
        autoEnrich: !!autoEnrich,
        qidianEnrich: !!qdEnrich,
        requestIntervalMs: intervalMs,
        siteTimes: tTimes || {},
        fallbackTime: tFall || '',
        retentionDays: retentionDays,
      }
      const diff = saved ? settingsDiff(saved, draft) : []
      const dirty = diff.length > 0
      const draftKey = [
        draft.captures.slice().sort().join(','),
        draft.autoEnrich, draft.qidianEnrich, draft.requestIntervalMs,
        Object.keys(draft.siteTimes).sort().map(function (k) { return k + '=' + (draft.siteTimes[k] || '') }).join(','),
        draft.fallbackTime, draft.retentionDays,
      ].join('|')
      /** 草稿写回组件外 + 登记脏状态（面板切页/收起前据此拦一下） */
      React.useEffect(function () {
        if (!saved) return
        if (!dirty) { DRAFTS.settings = null; dirtyGuard.set('settings', false); return }
        DRAFTS.settings = Object.assign({}, draft, { dirty: true })
        dirtyGuard.set('settings', true)
      }, [draftKey, saved, dirty])
      /** 草稿一变就收起删除确认，避免确认的是旧值 */
      React.useEffect(function () { setRetentionConfirm(false) }, [draftKey])
      if (!cat || !picked) return h('div', { style: C.muted }, barNote || '加载中…')
      const has = function (id) { return picked.indexOf(id) >= 0 }
      const toggle = function (id, on) {
        const next = picked.slice()
        const at = next.indexOf(id)
        if (on && at < 0) next.push(id)
        if (!on && at >= 0) next.splice(at, 1)
        setPicked(next)
        setBarNote('')
      }
      const setAll = function (site, on) {
        const ids = cat.boards.filter(function (b) { return b.site === site }).map(function (b) { return b.boardId })
        setPicked(on ? picked.concat(ids.filter(function (i) { return picked.indexOf(i) < 0 })) : picked.filter(function (i) { return ids.indexOf(i) < 0 }))
        setBarNote('')
      }
      /**
       * ★ Spec S4「恢复默认」：只改**草稿**，并说清将新增/移除多少 —— 保存后才生效。
       *   默认集来自 catalog 的 defaultCaptures（宿主 defaultState().boards，唯一权威）；
       *   宿主没给就明确拒绝，不自己猜一套默认集（猜出来的东西会让「恢复默认」变成另一种事故）。
       */
      const restoreDefaults = function () {
        const def = cat && Array.isArray(cat.defaultCaptures) ? cat.defaultCaptures.slice() : null
        if (!def || !def.length) {
          setBarNote('这台宿主没有提供默认抓取集（catalog.defaultCaptures 缺失），只能手动勾选')
          toast('warn', '这台宿主没有提供默认抓取集，只能手动勾选')
          return
        }
        const add = def.filter(function (id) { return picked.indexOf(id) < 0 })
        const del = picked.filter(function (id) { return def.indexOf(id) < 0 })
        setPicked(def)
        setBarNote('已恢复默认抓取：将新增 ' + add.length + ' 个、移除 ' + del.length + ' 个（点「保存设置」才落盘）')
      }
      const toggleGroup = function (key) {
        const nx = Object.assign({}, closedGroups)
        nx[key] = !nx[key]
        setClosedGroups(nx)
      }
      /** 动作后只刷新起点缓存计数；不重跑 load（否则会把未保存草稿写成「已恢复未保存的改动」） */
      const refreshQd = function () {
        return jget('/catalog').then(function (c) {
          setQdCache((c && c.qidian) || null)
          setCat(c)
        }).catch(function () {})
      }
      const retentionKnown = !!(saved && saved.retentionDays != null)
      const retentionLabel = retentionDays == null ? '读取中' : (retentionDays === 'forever' ? '永久' : retentionDays + ' 天')
      const retentionShortens = !!(diff.indexOf('保留天数') >= 0 && retentionShortensOf(saved, draft))
      /** 底栏保存：按变化分组顺序提交；成功的组并入 saved，失败的组留在草稿里继续算脏 */
      const doSave = function () {
        if (busy) return
        const d = draft
        const changes = diff.slice()
        const selChanged = changes.some(function (x) { return x === '抓取范围' || x === '自动补全' || x === '起点收藏补全' || x === '请求间隔' })
        const timerChanged = changes.some(function (x) { return x === '计划时刻' || x === '兜底时刻' })
        const retChanged = changes.indexOf('保留天数') >= 0
        const done = []
        const failed = []
        const notes = []
        let nextSaved = saved ? Object.assign({}, saved, { captures: (saved.captures || []).slice(), siteTimes: Object.assign({}, saved.siteTimes || {}) }) : null
        setBusy(true)
        setRetentionConfirm(false)
        const run = async function () {
          if (selChanged) {
            try {
              const r = await jpost('/select', { captures: d.captures, autoEnrich: d.autoEnrich, qidianEnrich: d.qidianEnrich, requestIntervalMs: d.requestIntervalMs })
              if (r && r.note) notes.push(r.note)
              nextSaved = Object.assign({}, nextSaved, { captures: d.captures.slice(), autoEnrich: d.autoEnrich, qidianEnrich: d.qidianEnrich, requestIntervalMs: d.requestIntervalMs })
              done.push('抓取/补全/间隔')
            } catch (e) { failed.push('抓取/补全/间隔：' + e) }
          }
          if (timerChanged) {
            try {
              const r = await jpost('/timer', { enabled: tOn, siteTimes: d.siteTimes, fallbackTime: d.fallbackTime })
              if (r && r.note) notes.push(r.note)
              nextSaved = Object.assign({}, nextSaved, { siteTimes: Object.assign({}, d.siteTimes), fallbackTime: d.fallbackTime })
              done.push('计划时刻')
            } catch (e) { failed.push('计划时刻：' + e) }
          }
          if (retChanged) {
            try {
              const r = await jpost('/retention', { days: d.retentionDays })
              if (r && r.note) notes.push(r.note)
              nextSaved = Object.assign({}, nextSaved, { retentionDays: d.retentionDays })
              done.push('保留天数')
            } catch (e) { failed.push('保留天数：' + e) }
          }
        }
        run().then(function () {
          setBusy(false)
          if (nextSaved) { savedRef.current = nextSaved; setSaved(nextSaved) }
          if (failed.length) {
            toast('error', (done.length ? '已保存：' + done.join('、') + '；失败：' : '保存失败：') + failed.join('；') + '（失败项仍在草稿里，可再试）')
            return
          }
          DRAFTS.settings = null
          dirtyGuard.set('settings', false)
          toast('success', notes.filter(Boolean).join('；') || ('已保存：' + (changes.length ? changes.join('、') : '设置')))
          if (props.onSaved) props.onSaved()
          try { window.dispatchEvent(new Event('rank-scan:saved')) } catch (e) {}
        }).catch(function (e) {
          setBusy(false)
          toast('error', '保存失败：' + e)
        })
      }
      /** 保存入口：保留天数变短时先在底栏出确认；确认后再真正提交 */
      const onSaveClick = function () {
        if (busy) return
        if (retentionShortens && !retentionConfirm) { setRetentionConfirm(true); return }
        doSave()
      }
      const discard = function () {
        const sv = savedRef.current
        if (!sv) return
        setPicked(sv.captures.slice())
        setAutoEnrich(sv.autoEnrich)
        setQdEnrich(sv.qidianEnrich)
        setIntervalMs(sv.requestIntervalMs)
        setTTimes(Object.assign({}, sv.siteTimes))
        setTFall(sv.fallbackTime)
        setRetentionDays(sv.retentionDays)
        DRAFTS.settings = null
        dirtyGuard.set('settings', false)
        setRetentionConfirm(false)
        setBarNote('已放弃改动')
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
        jpost('/timer', { enabled: next }).then(function (r) {
          toast('success', (r && r.note ? r.note : '已' + (next ? '开启' : '关闭')) + '（立即生效）')
          return jget('/catalog').then(function (c) { setTLast(c.timer || null) })
        }).catch(function (e) {
          setTOn(prev)
          toast('error', '没能' + (next ? '开启' : '关闭') + '：' + e + '（已恢复原状态）')
        })
      }
      /** 全站补全：按站把抓取集里的榜逐个补（逐本 1 请求 + 当前间隔，会很慢） */
      const enrichSite = function (site) {
        const ids = (cat.captures || []).filter(function (id) { return String(id).split('.')[0] === site })
        if (!ids.length) { setBarNote('该站当前没有勾选任何榜'); toast('warn', '该站当前没有勾选任何榜'); return }
        setBusy(true)
        let done = 0
        let filled = 0
        let seq = Promise.resolve()
        ids.forEach(function (id) {
          seq = seq.then(function () {
            setBarNote('补全 ' + siteNameOf(site) + ' ' + done + '/' + ids.length + ' 个榜…')
            return jpost('/enrich?boardId=' + encodeURIComponent(id)).then(function (r) {
              done += 1
              filled += (r && r.filled) || 0
            }).catch(function () { done += 1 })
          })
        })
        seq.then(function () {
          setBarNote('')
          toast('success', siteNameOf(site) + ' 补全完成：' + ids.length + ' 个榜，共补 ' + filled + ' 条')
        })
          .catch(function (e) { setBarNote(''); toast('error', '补全失败：' + e) })
          .then(function () { setBusy(false) })
      }
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
        lines.push('最近提示: ' + (lastNote || '—'))
        return lines.join('\n')
      }
      /**
       * ★ Spec E（2026-10-24 审查）：保存/未保存条属于**整个设置层**，不是「抓取范围」分组的附属。
       *   旧实现把它放在抓取范围里 ⇒ 这个分组一折叠，改「自动补全 / 起点收藏补全」时就看不到
       *   「有未保存的改动」和保存按钮（改了半天以为已经生效）。
       *   保持原语义：保存只落抓取集 + 两个补全开关，计划时刻仍由「保存计划」单独保存。
       */
      const saveBar = h('div', { style: { position: 'sticky', bottom: '0', zIndex: 4, marginTop: '6px', padding: '6px 8px',
        border: '1px solid ' + (dirty ? wash(T.warn, 60) : T.border), borderRadius: T.r.s,
        background: T.surface,
        backgroundImage: dirty ? 'linear-gradient(' + wash(T.warn, 16) + ',' + wash(T.warn, 16) + ')' : 'none',
        boxShadow: T.shadowBar } },
        retentionConfirm ? h(Banner, { tone: 'warn', live: false },
          h('span', null, '将删除早于 ' + retentionLabel + '的数据日期目录，不可恢复'),
          h('button', { className: 'rs-btn is-danger', disabled: busy, onClick: doSave }, '确认保存'),
          h('button', { className: 'rs-btn', disabled: busy, onClick: function () { setRetentionConfirm(false) } }, '取消')) : null,
        h('div', { style: C.row },
          h('button', { className: 'rs-btn is-primary', disabled: busy || !dirty, onClick: onSaveClick }, busy ? '保存中…' : '保存设置'),
          dirty ? h('button', { className: 'rs-btn', disabled: busy, onClick: discard }, '放弃改动') : null,
          h('span', { style: { color: dirty ? T.warn : T.muted } }, dirty ? '有 ' + diff.length + ' 处未保存：' + diff.join('、') : '已保存'),
          h('button', { className: 'rs-btn', disabled: busy, onClick: restoreDefaults, title: '把勾选恢复成插件默认抓取集（只改草稿，保存后生效）' }, '恢复默认'),
          barNote ? h('span', { style: C.muted }, String(barNote).slice(0, 120)) : null))
      return h('div', null,
        h(Section, { title: '抓取范围（' + picked.length + ' 个榜）', defaultOpen: true },
          h('div', { style: C.muted }, '勾选 = 抓什么；改动进草稿，点下面的「保存设置」才落盘（下次扫描生效）。抓到的榜就会显示。'),
          h('div', { style: C.row }, sites.map(function (s) {
            return h('span', { key: s, style: { ...C.row, margin: 0 } },
              h('span', { style: C.muted }, siteNameOf(s) + ' ' + pickedOf(s) + '/' + siteTotal(s)),
              h('button', { className: 'rs-btn is-ghost', onClick: function () { setAll(s, true) } }, '全选'),
              h('button', { className: 'rs-btn is-ghost', onClick: function () { setAll(s, false) } }, '全不选'),
              h('button', { className: 'rs-btn is-ghost', disabled: busy, onClick: function () { enrichSite(s) }, title: '把该站已勾选的榜逐个补全（联网：逐本 1 请求，很慢）' }, '补齐缺失'))
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
        ),
        h(Section, { title: '扫描计划', defaultOpen: false, summary: (tOn ? '已开启' : '已关闭') + ' · 兜底 ' + (tFall || '') + ' · ' + (tLast && tLast.wired ? '自动扫描已生效' : '自动扫描未生效') },
          h('label', { style: C.row },
            h('input', { type: 'checkbox', checked: tOn, onChange: function (e) { toggleTimer(e.target.checked) } }),
            h('span', null, tOn ? '已开启' : '已关闭'),
            h('span', { style: C.muted }, '立即生效'),
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
                type: 'time', style: { ...C.input, width: '92px' }, value: (tTimes || {})[key] || '',
                onChange: function (e) { const nx = Object.assign({}, tTimes); nx[key] = e.target.value; setTTimes(nx) },
              }),
              h('span', { style: C.muted }, why))
          })),
          h('div', { style: { ...C.row, marginTop: '2px' } },
            h('span', { style: { width: '46px', flex: '0 0 auto' } }, '兜底'),
            h('input', { type: 'time', style: { ...C.input, width: '92px' }, value: tFall, onChange: function (e) { setTFall(e.target.value) } }),
            h('span', { style: C.muted }, '当天失败或内容待核对的站，到这个点再补一次（每站每天一次）')),
          h('div', { style: C.muted }, '状态更新于 ' + ((planLive && planLive.now) || '—') + (planLive && planLive.installedToday ? '　· 今天刚安装：安装当天不自动跑，明天起按上面的时刻执行' : '')),
          ),
        h(Section, { title: '数据与性能', defaultOpen: false, summary: (ov && ov.storage ? '数据目录 ' + fmtBytes(ov.storage.totalBytes) + ' · 保留 ' + retentionLabel : '') },
          h('div', { style: C.row },
            h('span', { style: C.muted }, '保留'),
            h('select', {
              style: { ...C.input, width: 'auto', padding: '1px 4px' },
              value: retentionKnown ? String(retentionDays) : '__loading',
              disabled: !retentionKnown || busy,
              title: retentionKnown ? '只影响数据日期目录（快照/报告）；配置、书签、书页缓存永不删' : '正在读取数据目录的保留天数…',
              onChange: function (e) {
                setRetentionDays(e.target.value === 'forever' ? 'forever' : Number(e.target.value))
                setBarNote('')
              },
            },
              retentionKnown
                ? [30, 90, 180, 365].map(function (n) { return h('option', { key: n, value: String(n) }, n + ' 天') })
                  .concat([h('option', { key: 'forever', value: 'forever' }, '永久保留')])
                : [h('option', { key: 'loading', value: '__loading' }, '读取中')])),
          ov && ov.storage ? h('div', { style: C.muted },
            '快照 ' + fmtBytes(ov.storage.snapshotBytes) + ' · state ' + fmtBytes(ov.storage.stateBytes) +
            ' · ' + ov.storage.dates + ' 天（' + dash(ov.storage.oldest) + ' 起）· 书签 ' + ov.storage.bookmarks + ' 条') : null,
          h('label', { style: C.row },
            h('input', { type: 'checkbox', checked: autoEnrich, onChange: function (e) { setAutoEnrich(e.target.checked); setBarNote('') } }),
            h('span', null, '扫描后自动补全缺失字段'),
            h('span', { style: C.muted }, '（榜页没有收藏/字数时要进书页取；补全在后台跑，抓榜先返回）')),
          h('div', { style: { ...C.row, marginTop: '4px' } },
            h('span', { style: C.muted }, '起点收藏补全'),
            h('input', { type: 'checkbox', checked: qdEnrich, onChange: function (e) { setQdEnrich(e.target.checked); setBarNote('') } }),
            h('span', { style: C.muted }, qdEnrich ? '已开启' : '已关闭（默认关）'),
            h('button', { className: 'rs-btn', disabled: busy, title: '补全起点收藏页缺失的字段（联网：逐本 1 请求）', onClick: function () { setBusy(true); jpost('/qidianEnrich').then(function (r) { toast('success', (r && r.note) || '起点补全完成'); return refreshQd() }).catch(function (e) { toast('error', String(e)) }).then(function () { setBusy(false) }) } }, '补全起点收藏'),
            h('button', { className: 'rs-btn', disabled: busy, onClick: function () { setBusy(true); jpost('/qidianCache', { clear: true }).then(function (r) { toast('success', (r && r.note) || '缓存已清'); return refreshQd() }).catch(function (e) { toast('error', String(e)) }).then(function () { setBusy(false) }) } }, '清空书页缓存')),
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
              h('span', { style: C.muted }, '1s 是本项目自定的保守值（不是站点要求）；调小更快，也更容易被站点注意到')))),
        h(Section, { title: '关于与诊断', defaultOpen: false, summary: (sv.webServer ? '服务正常' : 'webServer 未注册') + ' · 自动扫描' + (sv.timerArmed ? '已生效' : '未生效') },
          h(VersionRow, null),
          h('div', { style: C.muted }, '服务：webServer ' + (sv.webServer ? '✓' : '✗') + ' · timer ' + (sv.timerService ? '✓' : '✗') + ' · 定时任务' + (sv.timerArmed ? '已启用' : '未启用')),
          lastNote ? h('div', { style: C.muted }, '最近提示：' + String(lastNote).slice(0, 160)) : null,
          h('div', { style: C.row },
            h('button', { className: 'rs-btn', onClick: function () { try { navigator.clipboard.writeText(diag()); toast('success', '诊断信息已复制（不含凭证）') } catch (e) { toast('error', '复制失败：' + e) } } }, '复制诊断信息'))), saveBar)
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
      /**
       * ★ 2026-10-16 审计：一键更新的轮询链最多 30 次 × 2s（§runUpdate 的 poll）。
       *   旧写法没有任何取消令牌 ⇒ 组件卸载（收起浮窗/切页签/热重载）后旧链还在 setTimeout 里
       *   继续打 /update-check 并 setState。用 ref 当令牌，cleanup 时置 false。
       */
      const aliveRef = React.useRef(true)
      function refresh(opId) {
        return jget('/update-check' + (opId ? '?operationId=' + encodeURIComponent(opId) : ''))
          .then(function (j) { if (aliveRef.current) setChk(j); return j })
          .catch(function (e) { if (aliveRef.current) toast('error', '检查更新失败：' + String(e).slice(0, 80)); return null })
      }
      React.useEffect(function () {
        aliveRef.current = true
        let alive = true
        jget('/version').then(function (j) { if (alive) setInfo(j) }).catch(function () { if (alive) setInfo({ version: null }) })
        refresh()
        return function () { alive = false; aliveRef.current = false }
      }, [])
      function runUpdate() {
        setBusy('update'); toast('info', '已请求更新…')
        jpost('/update', {}).then(function (r) {
          const id = r && r.operationId
          if (!id) { toast('error', (r && r.error) || '更新提供方没有返回 operationId'); return refresh() }
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
              if (st === 'failed') toast('error', '更新未成功：' + ((j && j.reason) || '未知原因'))
              else if (j && j.action === 'refresh') toast('success', '更新完成，刷新页面即可生效')
              else if (j && j.action === 'restart') toast('success', '更新完成，按提示重启 DSH 生效')
              else if (j && j.action === 'manual') toast('success', '更新完成，但需要你自己重启 DSH 才能生效')
              else toast('success', '更新完成')
              return j
            })
          }
          return poll()
        }).catch(function (e) { if (aliveRef.current) toast('error', '更新请求失败：' + String(e).slice(0, 80)) })
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
      return h('div', { style: { ...C.card, margin: '8px 0', padding: '7px 9px' } },
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '版本'),
        h('div', { style: C.muted }, line),
        (info && info.name && info.version) ? h('div', { style: C.muted }, info.name + '　v' + info.version) : null,
        h('div', { style: C.row },
          h('button', {
            className: 'rs-btn',
            disabled: busy !== '' || !canClick,
            onClick: function () {
              if (!chk) return
              if (chk.action === 'refresh') { try { window.location.reload() } catch (e) {} return }
              if (chk.action === 'restart') {
                setBusy('update'); toast('info', '已请求重启…')
                jpost('/update-restart', {}).then(function (r) { toast((r && r.ok) ? 'success' : 'error', (r && r.ok) ? '重启请求已发出' : ('重启失败：' + ((r && r.error) || '?'))) })
                  .catch(function (e) { toast('error', '重启请求失败：' + String(e).slice(0, 80)) })
                  .then(function () { setBusy('') })
                return
              }
              if (chk.canUpdateInPlace) runUpdate()
              else refresh()
            },
          }, busy !== '' ? '处理中…' : (!chk ? '检查中…' : chk.buttonLabel)),
          h('button', { className: 'rs-btn', disabled: busy !== '', onClick: function () { refresh() } }, '重新检查')))
    }

