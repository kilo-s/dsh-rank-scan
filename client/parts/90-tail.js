/**
 * 90-tail.js：openLink/diagLink、inject、apply 与 factory 返回值/闭合括号。依赖全部。不要放组件。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    function openLink(ctx, url) {
      if (typeof ctx === 'string' && url === undefined) { url = ctx; ctx = null }
      if (!url) return
      const c = ctx || {}
      try {
        const sr = sidebarSvc || c.sidebarRight
        if (sr && typeof sr.openTab === 'function') {
          sr.openTab('browser', { params: { url }, revealIfOpened: true })
          if (c.logger?.info) c.logger.info('[dsh-rank-scan] 已在侧栏浏览器打开：' + url)
          return
        }
        if (c.logger?.warn) c.logger.warn('[dsh-rank-scan] 侧栏浏览器服务不可见（ctx.sidebarRight 缺失），退回新标签')
      } catch (e) {}
      try { window.open(url, '_blank', 'noopener,noreferrer') } catch (e) {}
    }

    /** 自检：侧栏浏览器服务是否可见（改面板时用来确认在 DSH 里打开作品页这条路通不通） */
    function diagLink(ctx) {
      const sr = ctx && ctx.sidebarRight
      return {
        hasSidebarRight: !!sr,
        hasOpenTab: !!(sr && typeof sr.openTab === 'function'),
        hasOpenTabIn: !!(sr && typeof sr.openTabIn === 'function'),
        hasTabs: !!(ctx && ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === 'function'),
      }
    }
    /**
     * ★ 2026-10-16 审计（加载期死码）：这里原来在**模块求值期**跑 diagLink(ctx) 并往 DOM 里塞一个
     *   自检标记节点，而 `ctx` 只作为 apply(ctx) 的形参存在 ⇒ 每次加载都抛 ReferenceError，
     *   又被紧跟的空 catch 吞掉：标记永远不出现（自检形同虚设），还在加载路径上白留一个 try/catch，
     *   并把「模块求值期碰了宿主作用域」这类缺陷藏起来。要查侧栏浏览器可见性，看 apply 里捕获的
     *   sidebarSvc / window.__rankScanLinkSvc 即可（diagLink 保留，供 apply 内按需调用）。
     */

    const inject = ['slots']
    function apply(ctx) {
      // 样式表只注入一次；选择器都带 rs- 前缀（见 ensureStyle）
      ensureStyle()
      // ★ 首次安装自动弹一次：认领点从「模块求值期」移到这里（apply 真的跑到了才算数）
      if (claimAutoOpen()) panelOpen.set(true)
      // 可选依赖晚绑定：侧栏浏览器服务可用后捕获（不在 inject 列表里，避免服务缺失时整个面板挂不上）
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sidebarRight'], function (scope) {
            sidebarSvc = (scope && scope.sidebarRight) || (scope && scope.reflect && typeof scope.reflect.get === 'function' ? scope.reflect.get('sidebarRight') : null) || null
            if (sidebarSvc) window.__rankScanLinkSvc = true
          })
        } catch (e) {}
      }
      // 自检：此刻 ctx 是真的，记下侧栏浏览器服务可见性（排查「打开作品页退化到新标签」用）
      try { window.__rankScanLinkDiag = diagLink(ctx) } catch (e) {}
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: PANEL_ID, order: 900 }, function RankScanPanel() { return h(Panel, { openLink: function (u) { openLink(ctx, u) } }) })
      })
      /**
       * ★ 2026-10-16 使用者口径 B：**这里不再注册 main 面板**。审计时我按「宿主 selectPanel 对未注册
       *   main id 会抛」的顾虑加了那个中间页，但事实是：审计前一直直接弹浮窗、用得好好的。
       *   现在恢复原状：点入口只弹浮窗，不产生任何可切换的页面。
       *   （保留原注释备查）
       * ★ 旧口径（Q29 / 审计-2 2026-10-16）：
       *   宿主 PanelRow 点击时调 layout.selectPanel(id)，而 layout.selectPanel 对**没有注册的 main 面板
       *   id** 是直接抛异常的（`main panel "x" is not registered`）。所以入口 id 必须与 main 槽的 key 一致。
       *   这里只放「一行说明 + 打开浮窗」：浮窗的拖动/缩放/位置记忆全部保留，不迁进主面板。
       */
      // 入口放 DSH **左侧栏会话列表下方**（使用方 2026-10-15 口径：收起按钮不要浮在对话上）
      // id 与 main 面板一致（PANEL_ID）⇒ 宿主那一行的 selectPanel(id) 不会抛；label 给宿主做 aria-label。
      try {
        const reg = function (slot) {
          try {
            ctx.slots.inject(slot, function () {
              // ★ 2026-10-16（使用者反馈「点『扫榜面板』文字本身没反应」）：宿主把 label 文字画在同一行的
          //   那个 <button> 里，点文字走的是宿主的 selectPanel(入口 id)；而我们的入口 id 没有对应
          //   main 面板 ⇒ 什么都不会发生。这里在 document 的**捕获阶段**接管：只要点击（或指针按下）
          //   落在「含我们入口标记的那个 button」内，就就地弹浮窗并阻断宿主处理 —— 图标与文字整行一致。
          return ctx.slots.register({ name: slot, id: ENTRY_ID, order: 900, label: '扫榜面板' }, SidebarEntryIcon)
            })
            return true
          } catch (e) { console.warn('[dsh-rank-scan] 入口槽位注册失败：' + slot, e); return false }
        }
        window.__rankScanEntry = reg('sidebar.panellist') ? 'sidebar.panellist' : reg('sidebar.footer.action') ? 'sidebar.footer.action' : null
      } catch (e) { console.warn('[dsh-rank-scan] 入口注册失败：', e) }
    }
    /**
   * 书签卡片的「站方指标」chip 文案（纯函数，便于单测）。null ⇒ 不渲染。
   * 规则（2026-10-16 使用反馈）：
   *   ① 没有数值就不渲染 —— 名次型榜（起点/刺猬猫/菠萝包）的 row.value 恒为 null，
   *      以前会画成「名次 —」这种只有标签没有内容的空 chip；
   *   ② 与 collect chip 同源同值时不重复渲染 —— 番茄的 metric 与 collect 都是 row.value（在读）。
   */
  function metricChipText(metric, collect, collectLabel) {
    if (!metric || metric.value == null) return null
    if (collect != null && metric.value === collect) return null
    /**
     * ★ 2026-10-17：同口径（例如番茄的 metric 与 collect 都是「在读」）不再另画一个同名 chip ——
     *   上层会把它渲染成「书签记录 X」并说明不是同一时点；否则就是两个「在读」并排，看着像 bug。
     */
    if (collectLabel && metric.name === collectLabel) return null
    return metric.name + ' ' + metric.value
  }
  // 测试缝：宿主只消费 name/inject/apply，多挂一个纯展示函数对运行无影响
  // 测试缝：宿主只消费 name/inject/apply；多挂纯函数与组件给离线测试用（对运行无影响）
  return { name: 'dsh-rank-scan', inject: inject, apply: apply, __test: {
    metricChipText: metricChipText,
    // 0.6.0（C3/C4）：书签排序与分批的纯函数，供离线测试直接调用
    sortBookmarks: sortBookmarks,
    bmBatch: bmBatch,
    bmPage: BM_PAGE,
    bmSortKey: BM_SORT_KEY,
    bmSortOptions: BM_SORT_OPTIONS,
    helpers: { cell: cell, metaDot: metaDot, cleanDesc: cleanDesc, revOf: revOf, statusText: statusText, scanLabel: scanLabel, pollDelay: pollDelay, canDayQuery: canDayQuery, fitColumns: fitColumns, colPrio: colPrio, mdOf: mdOf, boardLabel: boardLabel, rememberBoardNames: rememberBoardNames },
    components: { Overview: Overview, BoardTab: BoardTab, BookmarksTab: BookmarksTab, SettingsTab: SettingsTab, PopMenu: PopMenu, Panel: Panel, ToastHost: ToastHost, StatCard: StatCard, SectionHeader: SectionHeader },
    nextPlanOf: nextPlanOf,
    toast: toast, toastStore: toastStore, lastNote: lastNote, settingsDiff: settingsDiff,
  } }
  },
})
