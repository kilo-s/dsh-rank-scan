/**
 * 25-bookmark-star.js：书签本地 store 的 healStore 与 BookmarkStar 小部件。依赖 10/20。不要放书签页签。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    const healStore = function (s) {
      if (!s || typeof s !== 'object') return s
      if (!s.filters || typeof s.filters !== 'object') s.filters = { q: '', site: '', folder: '', tag: '' }
      if (s.map == null || typeof s.map !== 'object') s.map = {}
      if (s.busy == null || typeof s.busy !== 'object') s.busy = {}
      if (!s.subs || typeof s.subs.add !== 'function') s.subs = new Set()
      if (s.list === undefined) s.list = null
      if (s.total == null) s.total = 0
      if (s.error === undefined) s.error = null
      // ★ 连**方法本身**也要补：旧对象可能来自「还没有我的书签页签」的那一代，
      //   它上面既没有 refreshList 也没有 trashList，一调用就是 not a function。
      const self = s
      if (typeof s.listQuery !== 'function') s.listQuery = function () {
        healStore(self)
        const f = self.filters
        const qs = []
        if (f.q) qs.push('q=' + encodeURIComponent(f.q))
        if (f.site) qs.push('site=' + encodeURIComponent(f.site))
        if (f.folder) qs.push('folder=' + encodeURIComponent(f.folder))
        if (f.tag) qs.push('tag=' + encodeURIComponent(f.tag))
        return qs.length ? '?' + qs.join('&') : ''
      }
      if (typeof s.refreshList !== 'function') s.refreshList = function () {
        healStore(self)
        return jget('/bookmarks' + self.listQuery()).then(function (r) {
          self.list = r
          self.folders = (r && r.folders) || []
          self.health = (r && r.health) || null
          if (typeof self._emit === 'function') self._emit()
          return r
        }).catch(function (e) { self.error = String(e); if (typeof self._emit === 'function') self._emit(); return null })
      }
      if (typeof s.trashList !== 'function') s.trashList = function () {
        return jget('/bookmarks/trash').then(function (r) { return (r && r.trash) || [] })
      }
      if (typeof s.load !== 'function') s.load = function () {
        healStore(self)
        return jget('/bookmark/sync').then(function (r) {
          self.map = (r && r.map) || {}
          self.total = (r && r.total) || 0
          self.health = (r && r.health) || null
          self.done = true
          if (typeof self._emit === 'function') self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self.done = true; if (typeof self._emit === 'function') self._emit(); return null })
      }
      if (typeof s.has !== 'function') s.has = function (k) { healStore(self); return !!self.map[k] }
      if (typeof s.act !== 'function') s.act = function (body) {
        healStore(self)
        self.busy[body.bookKey] = true
        if (typeof self._emit === 'function') self._emit()
        return jpost('/bookmark', body).then(function (r) {
          delete self.busy[body.bookKey]
          return self.load().then(function () { return r })
        }).catch(function (e) { delete self.busy[body.bookKey]; self.error = String(e); throw e })
      }
      if (typeof s._emit !== 'function') s._emit = function () { self.subs.forEach(function (f) { try { f() } catch (e) {} }) }
      return s
    }

    const bmStore = healStore(SHARED.bookmarks || (SHARED.bookmarks = {}))
    // 每个入口都先补一次：旧对象缺 filters/subs 时，光靠上面的默认值治不好它
    Object.assign(bmStore, {
      list: bmStore.list === undefined ? null : bmStore.list,
      filters: bmStore.filters,
      sort: bmStore.sort || 'time',
      msg: bmStore.msg === undefined ? null : bmStore.msg,
      listQuery: function () {
        healStore(this)
        const f = this.filters
        const qs = []
        if (f.q) qs.push('q=' + encodeURIComponent(f.q))
        if (f.site) qs.push('site=' + encodeURIComponent(f.site))
        if (f.folder) qs.push('folder=' + encodeURIComponent(f.folder))
        if (f.tag) qs.push('tag=' + encodeURIComponent(f.tag))
        return qs.length ? '?' + qs.join('&') : ''
      },
      refreshList: function () {
        healStore(this)
        const self = this
        return jget('/bookmarks' + this.listQuery()).then(function (r) {
          self.list = r
          self.folders = (r && r.folders) || []
          self.health = (r && r.health) || null
          self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self._emit(); return null })
      },
      trashList: function () { return jget('/bookmarks/trash').then(function (r) { return (r && r.trash) || [] }) },
      load: function () {
        healStore(this)
        const self = this
        return jget('/bookmark/sync').then(function (r) {
          self.map = (r && r.map) || {}
          self.total = (r && r.total) || 0
          self.health = (r && r.health) || null
          self.done = true
          self._emit()
          return r
        }).catch(function (e) { self.error = String(e); self.done = true; self._emit(); return null })
      },
      has: function (k) { healStore(this); return !!this.map[k] },
      act: function (body) {
        healStore(this)
        const self = this
        self.busy[body.bookKey] = true
        self._emit()
        return jpost('/bookmark', body).then(function (r) {
          delete self.busy[body.bookKey]
          return self.load().then(function () { return r })
        }).catch(function (e) {
          delete self.busy[body.bookKey]
          self.error = String(e)
          self._emit()
          throw e
        })
      },
      use: function () {
        const [, force] = React.useState(0)
        React.useEffect(function () {
          const f = function () { force(function (x) { return x + 1 }) }
          const s = healStore(bmStore)
          s.subs.add(f)
          bmStore.load()
          return function () { try { s.subs.delete(f) } catch (e) {} }
        }, [])
        return healStore(bmStore)
      },
    })
    if (!bmStore._emit || typeof bmStore._emit !== 'function') {
      bmStore._emit = function () { this.subs.forEach(function (f) { try { f() } catch (e) {} }) }
    }
    if (bmStore.done === undefined) bmStore.done = false
    if (bmStore.health === undefined) bmStore.health = null
    if (!bmStore.folders || !bmStore.folders.length) bmStore.folders = bmStore.folders || []

    /** 星标按钮：四态（未打/已打/提交中/失败回滚）——失败必须可见，不静默 */
    function BookmarkStar(props) {
      const store = bmStore.use()
      const bk = props.bookKey
      if (!bk) return null
      const on = store.has(bk)
      const busy = !!store.busy[bk]
      const click = function (e) {
        e.preventDefault()
        e.stopPropagation()
        const body = props.row
          ? { action: on ? 'remove' : 'add', bookKey: bk, row: props.row, boardId: props.boardId, dataDate: props.dataDate }
          // 只有 bookKey 时：host 会拿 boardId + title（或 bookKey 里的书号）回本地快照里定位这本书
          : { action: on ? 'remove' : 'add', bookKey: bk, boardId: props.boardId, title: props.title, folders: props.folders }
        store.act(body).then(function () {
          if (store.list) store.refreshList()
        }).catch(function () {})
      }
      return h('button', {
        style: on ? C.bmOn : C.bmOff,
        title: busy ? '提交中…' : (on ? '已在书签里（点一下移除）' : '加入书签'),
        onClick: click,
      }, busy ? '…' : on ? '★' : '☆')
    }

    /**
     * ★ 2026-10-16 审计：拖动/缩放的 mousemove·mouseup 挂在 window 上，必须在**三处**都摘干净 ——
     *   ① 正常 mouseup；② 指针移出窗口后松开（只认 mouseup 会永久残留一个 mousemove）；
     *   ③ 组件卸载（收起浮窗 / 热重载）。
     *   旧写法只处理 ①：②③ 之后每次鼠标移动都还在改一个已经卸载的浮窗的 rect。
     */
