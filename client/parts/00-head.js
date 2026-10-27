/**
 * dsh-rank-scan — 面板（手写 bundle，零依赖；只用平台提供的 react）。
 * 2026-10-14 重写：可拖动/可缩放浮窗（位置尺寸本地记忆）；概览单行汇总；异常榜折叠；行内详情卡。
 * 数据全部来自宿主同源路由 /api/rank-scan（只读本地快照，渲染不联网）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-rank-scan',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/rank-scan'
    /** ★ 入口 id 与 main 面板 key 必须**一致**：宿主 PanelRow 点击时直接 layout.selectPanel(入口 id) */
    const PANEL_ID = 'rank-scan-panel'
    // ★ 2026-10-16（使用者口径 B）：入口 id 恢复成审计前的独立值 —— 不复用浮窗 id，
    //   免得宿主把侧栏这一行当成「面板页」去 selectPanel 切主区域。
    const ENTRY_ID = 'rank-scan-entry'
    const readResponse = async (response) => {
      const data = await response.json()
      if (response.ok === false || (data && (data.ok === false || data.error))) {
        const err = new Error((data && (data.error || data.note)) || ('请求失败：' + response.status))
        err.status = response.status
        if (data && data.code) err.code = data.code
        throw err
      }
      return data
    }
    const jget = (p) => fetch(API + p, { headers: { Accept: 'application/json' } }).then(readResponse)
    const readOverview = async function () {
      const controller = new AbortController()
      let timer
      try {
        return await Promise.race([
          fetch(API + '/overview', { headers: { Accept: 'application/json' }, signal: controller.signal }).then(readResponse),
          new Promise(function (_, reject) {
            timer = setTimeout(function () { controller.abort(); reject(new Error('概览读取超时，请重试')) }, 10000)
          }),
        ])
      } finally { clearTimeout(timer) }
    }
    // ⚠️ 之前这里**丢掉了 body**（调用方写的 {captures:…} 全被忽略）⇒ 面板里所有「保存」实际都没带参数：
    //    抓取集保存不动、每榜深度存不进去。现在统一带 JSON body。
    const jpost = (p, body) => fetch(API + p, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(readResponse)

    const LS_POS = 'rank-scan-panel:rect:v1'
    // 面板开关的本地记忆：v1 = 用户最后一次的开/关；auto = 「首次安装已自动弹过」
    // 需求（2026-10-15 使用方口径）：安装成功后第一次打开 DSH 自动弹一次，之后用户关掉就不再自动弹。
    const LS_SEL = 'rank-scan-panel:sel:v1'
/** 面板 UI 选择（tab + 站 + 榜 + 每榜日期/排序）：模块级共享，收起面板/刷新页面都回到原界面 */
const sel = (function () {
  let s = { tab: 'ov', site: null, board: null, dates: {}, sorts: {} }
  try {
    const raw = localStorage.getItem(LS_SEL)
    if (raw) {
      const o = JSON.parse(raw)
      s = {
        tab: o.tab || 'ov', site: o.site || null, board: o.board || null,
        /**
         * ★ 2026-10-22（易用性 B）：日期/排序**按榜各记各的**。
         *   以前这两个是组件内 state，收起面板/换榜就丢 ⇒ 每天都要重新选一次日期。
         *   换成按 boardId 存：换榜回来还是上次那个视图，但不会把上一榜的日期带过去。
         */
        dates: o.dates && typeof o.dates === 'object' ? o.dates : {},
        sorts: o.sorts && typeof o.sorts === 'object' ? o.sorts : {},
      }
    }
  } catch (e) {}
  const store = {
    get: function () { return s },
    set: function (patch) {
      s = { ...s, ...patch }
      try { localStorage.setItem(LS_SEL, JSON.stringify(s)) } catch (e) {}
    },
    /** 读某榜记住的日期（'' = 最新）/ 排序（'' = 默认） */
    pref: function (boardId, kind) {
      if (!boardId) return ''
      const m = kind === 'sort' ? s.sorts : s.dates
      return (m && m[boardId]) || ''
    },
    /** 写某榜的日期/排序；空串 = 清掉，回到默认 */
    setPref: function (boardId, kind, value) {
      if (!boardId) return
      const key = kind === 'sort' ? 'sorts' : 'dates'
      const m = { ...(s[key] || {}) }
      if (value) m[boardId] = value
      else delete m[boardId]
      const patch = {}
      patch[key] = m
      store.set(patch)
    },
  }
  return store
})()
// 模块级单例锚：即使 loader 把 factory 跑两遍（本会话确实见到重复入口），两个实例也共用同一份状态
const SHARED = (window.__rankScanShared = window.__rankScanShared || {})
/**
 * ★ 2026-10-22（离开保护）：未保存草稿**放在组件外**，切页/收起/重载把组件卸了也不丢。
 *   bm = 书签备注/夹草稿；settings = 抓取范围 + 计划时刻草稿。
 */
const DRAFT_KEY = 'rank-scan-panel:drafts:v1'
let restoredDrafts = { bm: null, settings: null }
try {
  const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
  if (saved && typeof saved === 'object') restoredDrafts = saved
} catch (e) {}
const draftTarget = window.__rankScanDrafts || restoredDrafts
const DRAFTS = (window.__rankScanDrafts = new Proxy(draftTarget, {
  set: function (target, key, value) {
    target[key] = value
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(target)) } catch (e) {}
    return true
  },
}))
/** 脏状态登记：面板在切页/收起前据此拦一下（只提示，不替用户保存） */
const dirtyGuard = (function () {
  const m = { bm: !!(DRAFTS.bm && DRAFTS.bm.dirty), settings: !!DRAFTS.settings }
  return {
    set: function (k, v) {
      const on = !!v
      if (!!m[k] === on) return
      m[k] = on
      try { window.dispatchEvent(new Event('rank-scan:dirty')) } catch (e) {}
    },
    any: function () { return Object.keys(m).some(function (k) { return m[k] }) },
    list: function () { return Object.keys(m).filter(function (k) { return m[k] }) },
  }
})()
const LS_OPEN = 'rank-scan-panel:open:v1'
    const LS_AUTOOPENED = 'rank-scan-panel:autoopened:v1'
    /** 用户上次的开/关（纯读，无副作用） */
    const readPanelOpen = function () {
      try { return localStorage.getItem(LS_OPEN) === '1' } catch (e) { return false }
    }
    /**
     * ★ 2026-10-16 审计：首次安装「自动弹一次」的标记**必须在这一刻**才落。
     *   旧写法在模块求值期就 setItem(LS_AUTOOPENED,'1')，而那时 apply 还没跑、槽位可能根本不在
     *   ⇒ 插件没激活也把标记烧掉了，之后永远不再自动弹（现场症状：「标记落了但从不弹」）。
     *   现在由 apply() 在真的打开浮窗时调用一次；返回 true 表示本次是首次装载。
     */
    const claimAutoOpen = function () {
      try {
        if (localStorage.getItem(LS_AUTOOPENED)) return false
        localStorage.setItem(LS_AUTOOPENED, '1')
        localStorage.setItem(LS_OPEN, '1')
        return true
      } catch (e) { return false }
    }
    /**
     * 设计令牌：全面板唯一的颜色/间距/字号来源，其余地方不许写色值。
     * 颜色优先读 DSH 宿主的 --dsw-alias-*（亮/暗主题各自解析），再退到旧版 --dsh-* 与静态兜底；
     * 兜底只为了在宿主变量缺失时不至于透明或白底白字，不是第二套主题。
     */
