    const fmtBytes = (n) => {
      if (n == null || !isFinite(n)) return '—'
      const u = ['B', 'KB', 'MB', 'GB']
      let i = 0
      let v = Number(n)
      while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++ }
      return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + ' ' + u[i]
    }

    /**
     * 概览：先回答「今天有什么需要看」——
     *   ① 需要处理（**仅有问题时出现**：榜名 + 影响 + 可执行动作）
     *   ② 今天的变化（可按分组筛：新入榜/回榜/上升/下降/退榜）
     *   ③ 全部榜单（可折叠；逐榜状态 + 涨/新/退；同站抓取时刻一致时只写一次）
     * ★ 2026-10-22（简明性 B）：存储/保留/诊断移到「设置」页 —— 采集管理不再占首屏。
     */
    /**
     * 概览数字卡（0.5.0）：值大、标签小；tone 只影响左色条与数字颜色，文字本身必须能读懂状态。
     * 有 onClick 时渲染成 button（Tab 可聚焦，focus-visible 蓝框），没有时是 div。
     */
    function StatCard(props) {
      const tone = props.tone || 'muted'
      const color = tone === 'ok' ? T.ok : tone === 'warn' ? T.warn : tone === 'bad' ? T.bad : T.muted
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, textAlign: 'left' } },
        h('div', { style: { ...C.muted, fontSize: T.fs.s, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.label),
        h('div', { style: { fontSize: T.fs.l, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.value),
        props.sub ? h('div', { style: { ...C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: String(props.sub) }, props.sub) : null)
      const style = {
        display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, boxSizing: 'border-box', textAlign: 'left',
        padding: '8px 10px', paddingLeft: '12px', border: '1px solid ' + T.border, borderLeft: '3px solid ' + color,
        borderRadius: T.r.s, background: T.surface, color: T.fg, font: 'inherit',
        cursor: props.onClick ? 'pointer' : 'default',
      }
      if (props.onClick) {
        return h('button', { type: 'button', className: 'rs-statcard', style: Object.assign({ appearance: 'none' }, style), onClick: props.onClick, title: props.title || props.label },
          body)
      }
      return h('div', { className: 'rs-statcard', style: style, title: props.title || '' }, body)
    }
    /** 概览区块小标题：标题 + 右侧计数 + 可选操作；innerRef 供数字卡 scrollIntoView 用 */
    function SectionHeader(props) {
      return h('div', { ref: props.innerRef, style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, margin: props.first ? '8px 0 4px' : '12px 0 6px' } },
        h('div', { style: { fontWeight: 600, fontSize: T.fs.m, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.title),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: '6px', flex: '0 0 auto' } },
          props.count != null && props.count !== '' ? h('span', { style: C.muted }, '（' + props.count + '）') : null,
          props.action || null))
    }

    const SITE_LABELS = { qidian: '起点', qidiantu: '起点图', ciweimao: '刺猬猫', sfacg: '菠萝包', fanqie: '番茄' }
    const siteLabelOf = function (ov, s) {
      const hit = ((ov && ov.sites) || []).filter(function (x) { return x.site === s })[0]
      return hit ? hit.siteName : (SITE_LABELS[s] || String(s))
    }
    /**
     * 下次计划（0.5.0 验收修正）：
     *   · waiting 里最近站点的时刻 → 中性色；
     *   · 今天全跑完（无 waiting/fallback）→ 取已启用站 siteTimes 的最早时刻，写「明天 HH:mm」；
     *   · siteTimes 也为空 → label 改成「上次扫描」，避免把过去的时刻说成将来的计划；
     *   · 定时关闭/只剩兜底 → warn。
     */
    function nextPlanOf(plan, ov, scan, total) {
      if (!plan) return { label: '下次计划', value: '—', sub: '计划读取中', tone: 'muted' }
      if (plan.enabled === false) return { label: '下次计划', value: '已关闭', sub: '定时扫描', tone: 'warn' }
      if (typeof total === 'number' && total === 0) return { label: '下次计划', value: '—', sub: '还没有勾选要扫的榜', tone: 'muted' }
      const times = plan.siteTimes || {}
      const waiting = (plan.waiting || []).filter(function (s) { return times[s] })
      if (waiting.length) {
        const order = waiting.slice().sort(function (a, b) { return String(times[a]).localeCompare(String(times[b])) })
        return { label: '下次计划', value: times[order[0]], sub: siteLabelOf(ov, order[0]), tone: 'muted' }
      }
      if ((plan.fallback || []).length) {
        return { label: '下次计划', value: plan.fallbackTime || '22:30', sub: siteLabelOf(ov, plan.fallback[0]), tone: 'warn' }
      }
      const enabled = ((ov && ov.sites) || []).map(function (s) { return s.site }).filter(function (s) { return times[s] })
      const nextTimes = enabled.slice().sort(function (a, b) { return String(times[a]).localeCompare(String(times[b])) })
      if (nextTimes.length) {
        const s = nextTimes[0]
        return { label: '下次计划', value: '明天 ' + times[s], sub: siteLabelOf(ov, s), tone: 'muted' }
      }
      const last = scan && (scan.startedAt || scan.at)
      if (last) return { label: '上次扫描', value: fmtLocalHM(last), sub: '最近一次', tone: 'muted' }
      return { label: '下次计划', value: '—', sub: '暂时算不出下次', tone: 'muted' }
    }

    function Overview(props) {
      const ov = props.ov
      /**
       * ★ 2026-10-23（窄面板版式）：概览两张表以前一律四列铺开 —— 420px 时「分组/榜/书名/变化」
       *   互相挤成一条，备注列更会被压成一字一行。这里按面板宽度决定：
       *   变化列表 <620 换成卡片行（分组 chip + 书名 + 变化，榜名放第二行）；
       *   全部榜单 <620 不显示备注列，备注改到榜名下面一行。
       */
      const avail = Math.max(320, Number(props.width) || (props.narrow ? 420 : 900))
      const chgNarrow = avail < 620
      const enrichS = React.useState(null)
      const enrichStatus = enrichS[0]
      const enrichRun = enrichStatus && enrichStatus.enrichRun ? enrichStatus.enrichRun : null
      const setEnrichStatus = enrichS[1]
      const chgS = React.useState(null)
      const chg = chgS[0]
      const setChg = chgS[1]
      const filtS = React.useState('')
      const chgFilter = filtS[0]
      const setChgFilter = filtS[1]
      const allS = React.useState(true)
      const showAll = allS[0]
      const setShowAll = allS[1]
      const allRef = React.useRef(null)
      const issuesRef = React.useRef(null)
      const changesRef = React.useRef(null)
      const rev = props.rev || revOf(ov)
      /**
       * ★ 2026-10-22（同日刷新）：依赖**修订号**而不是 dataDate。
       *   以前同一天再扫一次（或点「扫描已选榜」）时，上面计数会变、下面「今天的变化」还是旧列表。
       */
      React.useEffect(function () {
        if (!ov || !ov.dataDate) return undefined
        let alive = true
        jget('/changes').then(function (r) { if (alive) setChg(r) }).catch(function () { if (alive) setChg(null) })
        return function () { alive = false }
      }, [rev])
      // 补全进行中：5 秒一次盯进度；跑完后自动刷新一次，让补上的字段出现
      React.useEffect(function () {
        let alive = true
        let id = null
        let wasActive = false
        const tick = function () {
          // 页面不可见时不轮询（概览页开着一天会白打上万次请求）
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
          }).catch(function () { /* 读不到进度不影响面板 */ })
        }
        tick()
        id = setInterval(tick, 5000)
        return function () { alive = false; if (id) clearInterval(id) }
      }, [])
      // 0.5.0：/overview 未到时不再整页「加载中…」——四张卡先占位「—」，版面不跳
      const c = (ov && ov.counts) || {}
      const total = (c.ok || 0) + (c.missing || 0) + (c.stale || 0) + (c.login_required || 0) + (c.truncated || 0)
      const rows = ((ov && ov.sites) || []).flatMap(function (s) { return (s.boards || []).map(function (b) { return { ...b, siteName: s.siteName } }) })

      const scan = (ov && ov.scan) || null
      const plan = (ov && ov.services && ov.services.schedule) || null
      const staleIds = plan && plan.staleFlag
        ? Object.keys(plan.staleFlag).filter(function (k) { return plan.staleFlag[k] && plan.staleFlag[k].date === (ov && ov.dataDate) })
        : []
      /**
       * ★ Spec S3（2026-10-22）：「未到计划」和「待补跑」不是失败。
       *   按站分时抓取（起点 01:30 / 番茄 08:30 / 菠萝包 09:30 / 刺猬猫 10:40 / 起点图 12:40）⇒
       *   每天中午之前打开概览，没到点的站本来就该是空的。旧实现把它们算成 missing，于是出现
       *   「已采集 0/20 · 待处理 18 项 · 重试失败 18 个榜」的假警报（Spec S3 / 方案 3.3）。
       *   口径：后端逐榜给 scheduleState=waiting|due（含 plannedTime）就用它；
       *   没给（旧宿主/旧数据）就退回 timer-plan 的站级 waiting/due 队列；两者都没有才当失败。
       */
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
      // 「失败/待修」= 既不是 ok，也不是「还没到点」「等到兜底补跑」
      const badRows = rows.filter(function (b) { return b.status !== 'ok' && !scheduleStateOf(b) })
      rememberBoardNames(rows)
      const enrichPending = enrichStatus && typeof enrichStatus.pending === 'number' ? enrichStatus.pending : 0
      /** 「需要处理」= 状态异常 + 内容待核对 + 字段待补（**没有问题就整块不出现**） */
      const issues = []
      badRows.forEach(function (b) {
        const why = b.status === 'missing' ? '这次没抓到（当天没有快照）'
          : b.status === 'login_required' ? '起点 cookie 失效：导出 cookie 后上传即可恢复'
          : b.status === 'truncated' ? '没抓完（预算用尽或被取消）'
          : b.status === 'stale' ? '抓到的内容不可信（疑似未刷新或换榜）' : '状态异常'
        issues.push({
          key: 'b-' + b.boardId,
          name: b.siteName + ' · ' + b.name,
          why: why,
          detail: b.note || '',
          status: b.status,
          boardId: b.boardId,
          // Spec S5：问题要带**发生时间**（day-index 的 lastAttempt.at 早已具备），否则看不出是哪次尝试失败的
          at: (b.attempt && b.attempt.at) || b.lastCapture || null,
        })
      })
      staleIds.forEach(function (id) {
        if (badRows.some(function (b) { return b.boardId === id })) return
        const b = rows.filter(function (x) { return x.boardId === id })[0] || { name: id, siteName: '' }
        issues.push({ key: 's-' + id, name: (b.siteName ? b.siteName + ' · ' : '') + b.name, why: '与上一数据日整榜一致：站点可能还没换榜（内容待核对）', detail: '', status: 'stale', boardId: id, at: b.lastCapture || null })
      })
      if (enrichPending > 0) {
        issues.push({ key: 'enrich', name: '字段补全', why: enrichPending + ' 个榜还缺字段（进榜页点「补全缺失字段」，或等定时续跑）', detail: '', status: 'enrich', boardId: null, at: null })
      }
      const hasNoteCol = rows.some(function (b) { return !!b.note })
      /**
       * 今天的变化：按**站**分组展示（Spec S6），行可点进榜保上下文。
       * ★ 条数必须用后端给的真实总数：diffFor 每类只回前 20 条预览，
       *   旧实现拿「预览条数」当「总条数」，首订换批那天会写成「今天的变化（20 条）」而实际 100+。
       */
      const chgEntries = []
      const chgTotals = {}
      let chgSum = 0
      if (chg && chg.sites) {
        chg.sites.forEach(function (s) {
          (s.groups || []).forEach(function (g) {
            const items = g.items || []
            const n = typeof g.count === 'number' ? g.count : items.length
            chgTotals[g.group] = (chgTotals[g.group] || 0) + n
            chgSum += n
            items.forEach(function (it) { chgEntries.push({ site: s.site, siteName: s.siteName, group: g.group, it: it }) })
          })
        })
      }
      /**
       * ★ Spec E（2026-10-24 审查）：运行中主按钮要变成「进度 + 取消」。
       *   done/total 只在宿主确实写了 running 记录时才有；没数字就老实说「扫描中…」，
       *   不编百分比。扫描进度只在这一处出现，补全进度仍走它自己那条横幅，两块不混。
       */
      const scanProg = (scan && scan.progress) || {}
      const scanTotal = typeof scanProg.total === 'number' ? scanProg.total : 0
      const scanDoneN = typeof scanProg.done === 'number' ? scanProg.done : 0
      /**
       * Spec E：运行态以**宿主记录**为准 —— 定时扫描不是本面板发起的，props.busy 永远是 false，
       *   旧实现因此在定时跑的时候仍显示「扫描已选榜」且没有取消入口。
       *   inFlight === false 的 running 是上次进程退出留下的落盘记录，不算在跑。
       *   props.busy 仍单独表示「本面板的请求还在路上」（保存/补全/取消），两者不互相冒充。
       */
      const scanRunning = !!(scan && scan.outcome === 'running' && scan.inFlight !== false)
      const scanHasProg = scanRunning && scanTotal > 0
      const scanBusy = scanRunning || !!props.busy
      const scanBtnText = scanHasProg
        ? '扫描中 ' + Math.min(scanDoneN, scanTotal) + '/' + scanTotal
        : scanRunning || props.scanStarting ? '扫描中…' : props.busy ? '处理中…' : '扫描已选榜'
      const groupNames = []
      chgEntries.forEach(function (e) { if (groupNames.indexOf(e.group) < 0) groupNames.push(e.group) })
      const groupCount = function (g) { return chgTotals[g] || 0 }
      const shownEntries = chgFilter ? chgEntries.filter(function (e) { return e.group === chgFilter }) : chgEntries
      const chgRealTotal = typeof (chg && chg.count) === 'number' && chg.count > chgSum ? chg.count : chgSum
      const previewLimited = chgRealTotal > chgEntries.length
      /** 首订榜每天整批换新（上架作品），叫「新入榜」会被读成榜单竞争意义的新入榜（Spec S7） */
      const changesGroupLabel = function (group, boardId) {
        return String(boardId || '').indexOf('qidiantu.shouding') === 0 && group === '新入榜' ? '本批上架' : group
      }
      /** 按站分组：同站的变化连在一起，行上不必再重复站名 */
      const shownBySite = []
      shownEntries.forEach(function (e) {
        const last = shownBySite[shownBySite.length - 1]
        if (last && last.site === e.site) last.items.push(e)
        else shownBySite.push({ site: e.site, siteName: e.siteName, items: [e] })
      })
      const collectSub = [
        waitingRows.length ? '未到计划 ' + waitingRows.length : '',
        dueRows.length ? '待补跑 ' + dueRows.length : '',
      ].filter(Boolean).join(' · ')
      const collectSubText = collectSub || (badRows.length ? '有榜没抓到' : (ov && total > 0 && (c.ok || 0) === total ? '全部采集完成' : ''))
      const collectTone = badRows.length ? 'bad' : dueRows.length ? 'warn' : (ov && total > 0 && (c.ok || 0) === total ? 'ok' : 'muted')
      const issuesTone = !issues.length ? 'ok' : (issues.some(function (it) { return it.status !== 'stale' && it.status !== 'enrich' }) ? 'bad' : 'warn')
      const changesSub = Object.keys(chgTotals).slice(0, 2).map(function (g) { return g + ' ' + chgTotals[g] }).join(' · ')
      const nextPlan = nextPlanOf(plan, ov, scan, total)
      const noData = !!(ov && (c.ok || 0) === 0 && chgRealTotal === 0)
      const noChanges = !!(ov && (c.ok || 0) > 0 && chg && chgRealTotal === 0)
      const jump = function (ref) {
        const el = ref && ref.current
        if (el && typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'nearest' }) } catch (e) {} }
      }
      const goAll = function () {
        setShowAll(true)
        setTimeout(function () { jump(allRef) }, 0)
      }
      return h('div', null,
        /* ① 数据日期小字 */
        h('div', { style: { ...C.muted, display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
          h('span', { title: '扫描开始时刻的本地自然日' }, '数据日期 ' + dash(ov && ov.dataDate)),
          ov && ov.hiddenCount ? h('span', null, '· 未显示 ' + ov.hiddenCount + ' 个榜') : null),
        /* ② 四张数字卡：先回答「今天怎么样」 */
        // 480px 面板内宽约 455px：140px 会挤成 3 列，180px 才能落到验收要求的 2×2
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' } },
          h(StatCard, {
            label: '已采集', value: ov ? (c.ok || 0) + '/' + total : '—',
            sub: ov ? (collectSubText || (total ? '—' : '还没有采集')) : '读取中', tone: collectTone,
            onClick: goAll, title: '展开全部榜单并滚到那里',
          }),
          h(StatCard, {
            label: '待处理', value: !ov ? '—' : (issues.length ? String(issues.length) : '无'),
            sub: !ov ? '读取中' : (issues.length ? '需要你动手' : '没有要处理的'), tone: !ov ? 'muted' : issuesTone,
            onClick: issues.length ? function () { jump(issuesRef) } : undefined,
            title: issues.length ? '滚到「需要处理」' : '当前没有问题',
          }),
          h(StatCard, {
            label: '今日变化', value: chg ? String(chgRealTotal) : '—',
            sub: !chg ? '读取中' : (changesSub || (chgRealTotal ? '' : '今天没有变化')),
            tone: chgRealTotal ? 'ok' : 'muted',
            onClick: chg ? function () { jump(changesRef) } : undefined,
            title: '滚到「今天的变化」',
          }),
          h(StatCard, {
            label: nextPlan.label, value: nextPlan.value, sub: nextPlan.sub, tone: nextPlan.tone,
            onClick: plan && plan.enabled === false && props.onOpenSettings ? props.onOpenSettings : undefined,
            title: plan && plan.enabled === false ? '定时已关闭，点这里去设置' : '下一次站点计划',
          })),
        /* ③ 主动作：扫描（联网）与重新载入（只读本地）分开写清 */
        h('div', { style: { ...C.row, marginTop: '8px' } },
          h('button', {
            className: 'rs-btn is-primary',
            disabled: scanBusy || !ov || total === 0,
            title: total === 0 ? '还没有勾选要扫的榜，先去「设置 → 抓取范围」勾选' : '按「设置 → 抓取范围」里勾选的榜逐个扫描（联网）',
            onClick: function () { props.act('/scan') },
          }, scanBtnText),
          scanBusy ? h('button', { className: 'rs-btn is-danger', onClick: function () { props.act('/cancel') } }, '停止本次（保留已完成）') : null,
          badRows.length ? h('button', { className: 'rs-btn', disabled: scanBusy, onClick: function () { props.act('/retry') }, title: '只重试失败的榜（联网）' }, '重试失败 ' + badRows.length + ' 个榜') : null,
          h('button', { className: 'rs-btn is-ghost', onClick: props.reload, title: '只重新读取本地数据：不联网、不采集' }, '重新载入'),
          // 运行中不显示「上次 …」：那一轮还没结束，进度只放在主按钮一处（否则会同时出现两条「扫描中」）
          scanRunning ? null : h('span', { style: C.muted }, '上次 ' + scanLabel(scan))),
        /* ④ 需要处理：要用户动手的排后台补全前面 */
        issues.length ? h('div', { ref: issuesRef },
          h(Banner, { tone: issues.some(function (it) { return it.status !== 'stale' && it.status !== 'enrich' }) ? 'error' : 'warn', title: '需要处理' },
            h('div', { className: 'rs-banner-body', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, issues.map(function (it) {
              return h('div', { key: it.key, style: { ...C.row, alignItems: 'baseline' } },
                h('span', { style: C.dot(it.status === 'stale' || it.status === 'enrich' ? 'warn' : 'bad') }),
                h('span', { style: { fontWeight: 600 } }, it.name),
                it.at ? h('span', { style: C.muted }, fmtLocalHM(it.at)) : null,
                h('span', null, it.why),
                it.detail ? h('span', { style: C.muted }, '（' + String(it.detail).slice(0, 80) + '）') : null,
                it.boardId ? h('button', { className: 'rs-btn', disabled: props.busy, onClick: function () { props.onOpenBoard && props.onOpenBoard(it.boardId) }, title: '在「榜单」页打开这一榜（保上下文）' }, '查看本榜') : null,
                it.boardId ? h('button', { className: 'rs-btn', disabled: props.busy, onClick: function () { props.onRescanBoard && props.onRescanBoard(it.boardId) }, title: '只重扫这一榜（联网）' }, '重扫本榜') : null)
            })))) : null,
        /* ⑤ 补全进度：面板顶部只有这一条（三态：跑着 / 还能续跑 / 当日已试满） */
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
        /* ④ 今天的变化 */
        h(SectionHeader, { innerRef: changesRef, title: '今天的变化', count: chgRealTotal ? chgRealTotal + ' 条' : '' }),
        chg && chg.note ? h('div', { style: C.muted }, chg.note) : null,
        previewLimited ? h('div', { style: C.muted }, '下表每榜每类最多列 20 条（本次 ' + chgEntries.length + ' 条，共 ' + chgRealTotal + ' 条）；点行到榜页看全部。') : null,
        total === 0 ? h('div', { style: { ...C.row, alignItems: 'center' } },
          h('span', { style: C.muted }, '还没有勾选要扫的榜'),
          props.onOpenSettings ? h('button', { className: 'rs-btn is-ghost', onClick: props.onOpenSettings }, '去设置勾选') : null) : null,
        total === 0 ? null : noData ? h('div', { style: C.muted }, '今天还没有采集结果，到计划时刻会自动跑，也可以点「扫描已选榜」') : null,
        noChanges ? h('div', { style: C.muted }, '今天没有榜单变化') : null,
        ov && !chg && !noData ? h('div', { style: C.muted }, '正在读取今天的变化…') : null,
        chgEntries.length ? h('div', { style: C.row },
          [{ label: '全部', value: '' }].concat(groupNames.map(function (g) { return { label: g, value: g } })).map(function (o) {
            return h('button', {
              key: 'f-' + (o.value || 'all'),
              className: chgFilter === o.value ? 'rs-btn is-on' : 'rs-btn',
              onClick: function () { setChgFilter(o.value) },
            }, o.label + ' ' + (o.value ? groupCount(o.value) : chgRealTotal))
          })) : null,
        /**
         * 变化列表：宽的时候是表格（分组 / 榜 / 书名 / 变化），窄的时候换卡片行 ——
         *   420px 下四列表格会把「分组/榜/书名/变化」挤成一条，书名被折成两行、星标掉到下一行。
         *   卡片行：第一行 分组 chip + 书名 + 星标 + 变化，第二行 榜名（次要信息，省略号）。
         */
        shownEntries.length ? (chgNarrow
          ? h('div', null, shownBySite.map(function (g) {
              return h('div', { key: 'nc-' + g.site },
                h('div', { style: { ...C.muted, marginTop: '6px', fontWeight: 600 } }, g.siteName + ' · ' + g.items.length + ' 条'),
                g.items.map(function (e, i) {
                  return h('div', {
                    key: 'nci-' + g.site + i,
                    tabIndex: 0,
                    title: '在「榜单」页打开：' + boardLabel(e.it.boardId),
                    style: { ...C.card, padding: '4px 7px', margin: '4px 0', cursor: 'pointer' },
                    onClick: function () { props.onOpenBoard && props.onOpenBoard(e.it.boardId) },
                    onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); props.onOpenBoard && props.onOpenBoard(e.it.boardId) } },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 } },
                      h('span', { style: { ...C.chip, flex: '0 0 auto', margin: 0 } }, changesGroupLabel(e.group, e.it.boardId)),
                      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: e.it.title }, e.it.title),
                      h('span', { style: { flex: '0 0 auto' }, onClick: function (ev) { ev.stopPropagation() } },
                        h(BookmarkStar, { bookKey: bookKeyOf(e.it.boardId, e.it.title), boardId: e.it.boardId, row: null, title: e.it.title })),
                      h('span', { style: { ...C.num, flex: '0 0 auto' }, title: '名次变化' }, dash(e.it.delta))),
                    h('div', { style: { ...C.muted, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.it.boardName))
                }))
            }))
          : h('table', { style: C.table },
              h('thead', null, h('tr', null, ['分组', '榜', '书名', '变化'].map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
              h('tbody', null, shownBySite.flatMap(function (g) {
                const head = h('tr', { key: 'ch-' + g.site },
                  h('td', { style: { ...C.td, paddingTop: '7px', fontWeight: 600, color: T.muted }, colSpan: 4 },
                    g.siteName + ' · ' + g.items.length + ' 条'))
                const body = g.items.map(function (e, i) {
                  return h('tr', {
                    key: 'c-' + g.site + i,
                    style: { cursor: 'pointer' },
                    title: '在「榜单」页打开：' + boardLabel(e.it.boardId),
                    onClick: function () { props.onOpenBoard && props.onOpenBoard(e.it.boardId) },
                  },
                    h('td', { style: { ...C.td, whiteSpace: 'nowrap' } }, changesGroupLabel(e.group, e.it.boardId)),
                    h('td', { style: { ...C.td, maxWidth: '160px' } }, h('span', { style: { ...C.ellip, maxWidth: Math.max(90, Math.round(avail * 0.2)) + 'px' }, title: e.it.boardName }, e.it.boardName)),
                    h('td', { style: { ...C.td, minWidth: '140px' } }, e.it.title, ' ',
                      h('span', { onClick: function (ev) { ev.stopPropagation() } },
                        h(BookmarkStar, { bookKey: bookKeyOf(e.it.boardId, e.it.title), boardId: e.it.boardId, row: null, title: e.it.title }))),
                    h('td', { style: { ...C.td, ...C.num } }, dash(e.it.delta)))
                })
                return [head].concat(body)
              })))) : null,
        /* ⑤ 全部榜单（可折叠） */
        h(SectionHeader, {
          innerRef: allRef, title: '全部榜单', count: total,
          action: h('button', {
            className: 'rs-btn is-ghost',
            'aria-expanded': showAll ? 'true' : 'false',
            onClick: function () { setShowAll(!showAll) },
          }, showAll ? '收起' : '展开'),
        }),
        showAll && total > 0 ? h('table', { style: C.table },
          h('thead', null, h('tr', null, ['榜（按站）', '涨 / 新 / 退', '状态'].concat(hasNoteCol && !chgNarrow ? ['备注'] : []).map(function (t) { return h('th', { key: t, style: C.th }, t) }))),
          h('tbody', null, ((ov && ov.sites) || []).flatMap(function (s) {
            const okN = s.boards.filter(function (b) { return b.status === 'ok' }).length
            const times = s.boards.map(function (b) { return b.lastCapture ? fmtLocalHM(b.lastCapture) : '' })
            const sameTime = times.length > 0 && times.every(function (t) { return t === times[0] })
            const headTime = sameTime ? times[0] : ''
            const head = h('tr', { key: 'h-' + s.site },
              h('td', { style: { ...C.td, paddingTop: '7px', fontWeight: 600 }, colSpan: hasNoteCol && !chgNarrow ? 4 : 3 },
                h('span', { style: C.dot(okN === s.boards.length ? 'ok' : 'bad') }),
                ' ' + s.siteName,
                h('span', { style: C.muted }, '  ' + s.boards.length + ' 个榜 · 已采集 ' + okN + (headTime ? ' · 抓取 ' + headTime : ''))))
            const rowsOut = s.boards.map(function (b) {
              /**
               * ★ 2026-10-25（批次榜）：这一格不写「涨/新/退」——整批换新，涨新退没有意义，
               *   改写成「第 479 期 · 17 本」；没有批次信息的老数据才退回「—」。
               */
              const batchCell = b.batch ? ((b.batch.label || ('批 ' + (b.batch.key || '—'))) + (b.batch.count != null ? ' · ' + b.batch.count + ' 本' : '')) : null
              const noBase = !batchCell && b.up === null && b.newCount === null && b.out === null
              const label = b.name + (b.derived ? ' · 本地派生' : b.displayed ? '' : ' · 未显示')
              return h('tr', { key: b.boardId },
                h('td', { style: { ...C.td, paddingLeft: '16px', maxWidth: Math.max(140, Math.round(avail * 0.5)) } },
                  h('span', { style: { ...C.ellip, maxWidth: Math.max(120, Math.round(avail * 0.46)) + 'px' }, title: label }, label),
                  // 窄面板不单开「备注」列（会被压成一字一行），备注改到榜名下面
                  hasNoteCol && chgNarrow && b.note ? h('div', { style: { ...C.muted, whiteSpace: 'normal' } }, dash(b.note)) : null),
                h('td', { style: { ...C.td, ...C.num } },
                  batchCell
                    ? h('span', { style: { whiteSpace: 'nowrap' }, title: '批次榜：整批换新，不比较变化（在「榜单」页按期看）' }, batchCell)
                    : noBase ? '—' : h('span', { style: { whiteSpace: 'nowrap' } },
                      '涨 ', h('span', { style: b.up > 0 ? C.up : null }, dash(b.up)), ' / ',
                      '新 ', h('span', { style: { fontWeight: 600 } }, dash(b.newCount)), ' / ',
                      '退 ', h('span', { style: b.out > 0 ? C.down : null }, dash(b.out)))),
                h('td', { style: C.td }, b.status === 'ok'
                  ? (headTime ? h('span', { style: C.muted }, '—') : (b.lastCapture ? fmtLocalHM(b.lastCapture) : '—'))
                  : h('span', { style: { color: b.status === 'stale' ? T.warn : T.bad } }, statusText(b.status))),
                hasNoteCol && !chgNarrow ? h('td', { style: C.td }, dash(b.note)) : null)
            })
            return [head].concat(rowsOut)
          }))) : null)
    }

    /**
     * 设置：四组 —— ① 抓取范围 ② 扫描计划 ③ 数据与性能 ④ 关于与诊断。
     *   · 勾选改动进**草稿**：底部常驻「未保存 / 放弃改动 / 保存设置」，离开前看得见
     *   · 扫描计划：开关即时生效（旁边写明开/关；失败回退），时刻改动走「保存计划」
     *   · 全站补全从榜单页挪到这里（按站「更多」），榜单页只保留「补全缺失字段」
     */
    /**
     * 设置草稿 vs 已保存快照的差异（纯函数）。
     * captures 按集合比较（顺序不算变化）；siteTimes 按字段比较。返回人类可读的分组名；空数组 = 干净。
     */
