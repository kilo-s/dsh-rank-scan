/**
 * 80-panel.js：侧栏入口图标与 Panel 外壳（页签、轮询、尺寸、Toast 挂载）。依赖前面全部页签。不要放 apply。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    function SidebarEntryIcon(props) {
      const size = Number(props && props.size) || 16
      const active = !!(props && props.active)
      /**
       * ★ 2026-10-16（使用者反馈「我点开就跳到扫榜面板、会话被顶掉」）：
       *   点这个图标要**就地弹出浮窗**，而不是把主区域切到薄 main 面板。做法：
       *     · 外层用 <div> 承接点击（不再嵌 <button>，避免按钮套按钮）；
       *     · onClick 里 stopPropagation() ⇒ 挡掉宿主 PanelRow 那个 selectPanel(id)，会话视图不被顶走；
       *     · 浮窗由 panelOpen 打开 ⇒ 一次点击就出窗。薄 main 面板照旧注册（键盘/无障碍路径仍有落点）。
       */
      // ★ 2026-10-16 定稿（使用者两轮反馈后）：**纯图标**（文字由宿主那行自己的 label 提供），
      //   点击时四种事件全部吃掉 ⇒ 就地弹浮窗、不切主区域。
      // ★ 2026-10-16 定稿（使用者：「为什么要两个按钮，统一一个不就行了」）：整行只保留宿主的
      //   那个 <button>。图标这里降级为**纯展示节点**（不挂任何点击处理器），点击接管只有一处：
      //   下面这个 effect 在「标记节点所在根节点」的捕获阶段注册一次 —— 图标/文字/行内空白行为一致。
      React.useEffect(function () {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined
        const mark = document.querySelector('[data-rank-scan-entry]')
        const root = (mark && mark.getRootNode && mark.getRootNode()) || document
        if (!root.addEventListener || root.__rankScanRowHooked) return undefined
        root.__rankScanRowHooked = true
        const onRowActivate = function (e) {
          try {
            const t = e.target
            const btn = t && t.closest ? t.closest('button, [role="button"]') : null
            const node = document.querySelector('[data-rank-scan-entry]')
            if (!btn || !node || !btn.contains(node)) return
            if (e.stopPropagation) e.stopPropagation()
            if (e.preventDefault) e.preventDefault()
            panelOpen.set(true)
          } catch (err) { /* 宿主 DOM 变了也不该把插件带崩 */ }
        }
        root.addEventListener('click', onRowActivate, true)
        root.addEventListener('pointerdown', onRowActivate, true)
        return undefined
      }, [])
      return h('div', {
        title: '打开扫榜浮窗',
        // 行标记：捕获阶段靠它认出「这一行是我们的」（只此一处接管）
        'data-rank-scan-entry': '1',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', lineHeight: 1, fontSize: '12px', opacity: active ? 1 : 0.92, whiteSpace: 'nowrap' },
      },
        h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          style: { display: 'block' },
          'aria-hidden': 'true', focusable: 'false',
        },
          // 三条由长到短的横杠 + 一个对勾：一眼认出是「榜单」，不是别的面板
          h('path', { d: 'M2 3.5h12M2 8h9M2 12.5h6' }),
          h('path', { d: 'M12.2 9.4l1.6 1.6 2-2.6' })))
      // ★ 2026-10-16：这里原来还挂了一个「扫榜」文字 span，结果左边我们一个「扫榜」、右边宿主的
      //   label「扫榜面板」，重复啰嗦。改为**纯图标**：文字由宿主那行自己的 label 提供。
    }

    /**
     * 入口分工（0.4.2）：
     *   · 概览 = 全局扫描：主按钮「扫描已选榜」、运行中「停止本次」、有失败时「重试失败 N 个榜」；
     *     问题行里的「查看本榜 / 重扫本榜」保留，不增删。
     *   · 榜单页 = 只对当前这一榜：扫描本榜、补全缺失、本榜设置、按上架日回看。
     *   · 设置页 = 设置与按站批量动作（补齐缺失），不放单榜扫描。
     * 扫描忙态 scanBusy 由本层统一算，传给 BoardTab，避免榜单页和概览两处并发。
     */
    function Panel(props) {
      const [open, setOpen] = panelOpen.use()
      // 收起面板会卸载 Panel ⇒ 用持久化的 tab（否则每次打开都跳回「概览」）
      const [tab, setTab] = React.useState(function () { return sel.get().tab || 'ov' })
      const LEAVE_LABEL = { bm: '书签备注', settings: '设置草稿' }
      const switchTab = function (t) {
        if (t === tab) return
        // 有没保存的东西：先拦一下（草稿不会丢，回来还在）
        if (dirtyGuard.any()) { setLeaveAsk({ tab: t, keys: dirtyGuard.list() }); return }
        sel.set({ tab: t }); setTab(t)
      }
      const doLeave = function () {
        const ask = leaveAsk
        setLeaveAsk(null)
        if (!ask) return
        if (ask.tab) { sel.set({ tab: ask.tab }); setTab(ask.tab) } else setOpen(false)
      }
      const [ov, setOv] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      /**
       * ★ Spec E：扫描类操作（扫描 / 重试 / 停止）自己的忙态。
       *   不能只靠 busy：POST /scan 还在路上时 overview 里仍是**上一轮的 completed**，
       *   面板若只看 ov.scan 就会退回 20s 慢轮询，用户点完扫描要等很久才看到 0/N。
       *   这个标记让「刚点完扫描」也立刻走 2s 快轮询，并在取消期间保持按钮禁用，
       *   直到 overview 真的不再显示在跑为止。
       */
      const [scanActBusy, setScanActBusy] = React.useState(false)
      const postInFlightRef = React.useRef(0)
      /** 概览轮询失败会每 20s 来一次：同一条错误 60s 内只弹一次，别把 Toast 刷屏 */
      const errToastRef = React.useRef({ msg: '', at: 0 })
      const [rect, setRect] = useRect()

      /** 有未保存草稿时切页/收起先问一句（草稿留在 DRAFTS，回来还在） */
      const [leaveAsk, setLeaveAsk] = React.useState(null)
      const [, bumpDirty] = React.useState(0)
      React.useEffect(function () {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined
        const onDirty = function () { bumpDirty(function (x) { return x + 1 }) }
        window.addEventListener('rank-scan:dirty', onDirty)
        return function () { window.removeEventListener('rank-scan:dirty', onDirty) }
      }, [])
      /** 轮询防重入：运行中每 2s 一次，慢请求不能叠成一堆（旧实现没有这道闸） */
      const reloadBusyRef = React.useRef(false)
      const reload = React.useCallback(function () {
        if (reloadBusyRef.current) return Promise.resolve()
        reloadBusyRef.current = true
        return readOverview()
          .then(function (data) { setOv(data); errToastRef.current = { msg: '', at: 0 } })
          .catch(function (e) {
            const s = String(e)
            const now = Date.now()
            if (errToastRef.current.msg !== s || now - errToastRef.current.at > 60000) {
              errToastRef.current = { msg: s, at: now }
              toast('error', '读取概览失败：' + s)
            }
          })
          .then(function () { reloadBusyRef.current = false })
      }, [])
      React.useEffect(function () { reload() }, [reload])
      // 轻量轮询：每 20s 静默刷新（不改变面板尺寸/位置，避免闪烁）
      // ★ 2026-10-16（票 27）：收起后必须彻底停 —— 旧写法把 `if (!open) return null` 放在 hooks 之后，
      //   面板收起时这个 interval 仍在跑（每 20s 打一次 /overview）。现在：收起即清，重新展开立即拉一次；
      //   页面隐藏（切到别的标签页）时跳过，恢复可见时补一次。
      const polledOnce = React.useRef(false)
      /**
       * ★ Spec E（2026-10-24）：轮询节奏跟着**真实扫描状态**走。
       *   ① running（含定时扫描，inFlight=true）⇒ 2s，面板上 0/N → N/N 才动得起来；
       *   ② 空闲 ⇒ 20s，维持原来「静默刷新」的成本；
       *   ③ 收起面板 / 页面隐藏 ⇒ 彻底停（展开或回到可见时补一次）；
       *   ④ 不再拿 busy 当闸门：busy 只表示「本面板有个请求在路上」，
       *      定时扫描期间恒为 false，旧写法整轮都刷不到进度。
       */
      const scanLive = !!(ov && ov.scan && ov.scan.outcome === 'running' && ov.scan.inFlight !== false)
      /** act 的 then 里要读「此刻是否还在跑」，用 ref 拿最新值（闭包里的 scanLive 是旧渲染的） */
      const scanLiveRef = React.useRef(false)
      scanLiveRef.current = scanLive
      /** 全局扫描忙态：定时/手动在跑，或扫描类 POST 还在路上 */
      const scanBusy = scanLive || scanActBusy
      React.useEffect(function () {
        if (!open) return undefined
        if (polledOnce.current) reload()
        else polledOnce.current = true
        // 刚点完扫描（POST 还没回）也要快轮询：那时 overview 仍是上一轮的 completed
        const every = pollDelay(scanLive, scanActBusy)
        const t = setInterval(function () {
          if (document.visibilityState !== 'hidden') reload()
        }, every)
        const onVis = function () { if (document.visibilityState === 'visible') reload() }
        document.addEventListener('visibilitychange', onVis)
        return function () { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
      }, [reload, open, scanLive, scanActBusy])
      /**
       * 跳到某个榜（概览的「查看本榜」与变化行都走这里）：写进 sel 再切页，
       * BoardTab 挂载时按 sel 初始化 ⇒ 站/榜/日期/排序/详情都保留（Spec S6「保上下文」）。
       */
      const openBoard = function (boardId) {
        const id = String(boardId || '')
        if (!id) return
        sel.set({ site: id.split('.')[0], board: id })
        switchTab('board')
      }
      /**
       * path + 可选 JSON body（概览「重扫本榜」要传 {boards}，以前 act 吞掉了 body）。
       * ★ Spec E：扫描/重试/停止走 scanActBusy —— 响应回来时如果 overview 还在 running，
       *   保持禁用（否则「停止本次」刚返回就能再点一次扫描，等于并发两轮）；
       *   真正解锁交给下面的 scanLive 变化，避免抢先 setBusy(false)。
       */
      const isScanAct = function (path) { return path === '/scan' || path === '/retry' || path === '/cancel' }
      const act = function (path, body) {
        const scanAct = isScanAct(path)
        if (scanAct) setScanActBusy(true)
        else setBusy(true)
        postInFlightRef.current += 1
        jpost(path, body).then(function (r) {
          toast('success', r && r.note ? r.note : '完成：' + (r.outcome || 'ok'))
          return reload()
        })
          .catch(function (e) { toast('error', String(e)) })
          .then(function () {
            postInFlightRef.current -= 1
            if (!scanAct) return setBusy(false)
            if (!scanLiveRef.current && postInFlightRef.current === 0) setScanActBusy(false)
          })
      }
      // 扫描真的停了（overview 不再 running）且没有扫描类请求在路上 ⇒ 解锁
      React.useEffect(function () {
        if (!scanLive && postInFlightRef.current === 0) setScanActBusy(false)
      }, [scanLive])
      // Esc：没有菜单/详情打开时收起面板；编辑中不收起（全局处理器已挡）
      // Esc 的最后一层：没有菜单/详情打开时收起面板（编辑中由全局处理器挡住）
      const closePanelLayer = React.useCallback(function () {
        if (dirtyGuard.any()) { setLeaveAsk({ tab: null, keys: dirtyGuard.list() }); return true }
        setOpen(false)
        return true
      }, [setOpen])
      useEscLayer(open ? closePanelLayer : null)
      // 收起后：按钮同样可拖动、同样记住位置（用同一份 rect，不再回右上角）
      if (!open) return null
      const narrow = rect.w < 720
      const rev = revOf(ov)
      return h('div', { 'data-rank-scan-win': '1', style: { ...C.win, left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' } },
        h(DragBar, {
          rect: rect, setRect: setRect,
          onCollapse: function () {
            if (dirtyGuard.any()) { setLeaveAsk({ tab: null, keys: dirtyGuard.list() }); return }
            setOpen(false)
          },
        }),
        h('div', { style: C.body },
          h('div', { style: C.tabs },
            h('button', { style: C.tab(tab === 'ov'), onClick: function () { switchTab('ov') } }, '概览'),
            h('button', { style: C.tab(tab === 'board'), onClick: function () { switchTab('board') } }, '榜单'),
            h('button', { style: C.tab(tab === 'bm'), onClick: function () { switchTab('bm') } }, '书签'),
            h('button', { style: C.tab(tab === 'pick'), onClick: function () { switchTab('pick') } }, '设置')),
          leaveAsk ? h(Banner, { tone: 'warn' },
            h('span', null, '有未保存的改动（' + (leaveAsk.keys || []).map(function (k) { return LEAVE_LABEL[k] || k }).join('、') + '）'),
            h('span', { style: C.muted }, '草稿会保留，下次进来还在'),
            h('button', { className: 'rs-btn', onClick: doLeave }, '仍然离开'),
            h('button', { className: 'rs-btn', onClick: function () { setLeaveAsk(null) } }, '继续编辑')) : null,
          h(TabBoundary, { name: tab },
            tab === 'ov' ? h(Overview, {
              ov: ov, busy: busy || scanActBusy, act: act, reload: reload, narrow: narrow, width: rect.w, rev: rev,
              /** 刚点完扫描、overview 还没反映 running 时，按钮也要说「扫描中…」而不是「处理中…」 */
              scanStarting: scanActBusy && !scanLive,
              onOpenBoard: openBoard,
              onRescanBoard: function (boardId) { act('/scan', { boards: String(boardId) }) },
              onOpenSettings: function () { switchTab('pick') },
            })
              : tab === 'board' ? h(BoardTab, {
                ov: ov, openLink: props.openLink, narrow: narrow, width: rect.w, rev: rev, scanBusy: scanBusy,
                onScanned: reload,
                onScanStart: function () { postInFlightRef.current += 1; setScanActBusy(true) },
                onScanEnd: function () { postInFlightRef.current = Math.max(0, postInFlightRef.current - 1); if (!scanLiveRef.current && postInFlightRef.current === 0) setScanActBusy(false) },
              })
              : tab === 'bm' ? h(BookmarksTab, { openLink: props.openLink })
              : h(SettingsTab, { ov: ov, onSaved: reload }))),
        h(ToastHost, null),
        h(ResizeHandle, { rect: rect, setRect: setRect }))
    }

    /** 打开作品页：
     * 首选 DSH **侧栏内嵌浏览器**（@deepseek-ai/dsh-client-ui-sidebar-browser 注册的 kind='browser'）
     * —— 该服务是可选依赖，用 ctx.inject(['sidebarRight']) 晚绑定；拿不到就退回新标签。 */
    /** 侧栏浏览器服务（可选依赖，晚绑定捕获后复用） */
    let sidebarSvc = null
    /**
     * 打开链接。★ 兼容两种调用方式（2026-10-15 修）：
     *   ① openLink(ctx, url) —— 早先的写法；
     *   ② openLink(url)      —— 行内「书名」与详情卡按钮都是这么调的。
     * 之前只认 ①，行内/详情卡传进来的是 (url) ⇒ url 形参恒 undefined ⇒ **静默 return，什么也不发生**，
     * 于是「看起点图原始页」点了没反应（使用方 2026-10-15 反馈的就是这个）。
     */
