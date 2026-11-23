/**
 * 55-board-cell.js：榜单表格单元格 cell、榜名记忆与 boardLabel。依赖 10/20。不要放 BoardTab 本体。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    /**
     * Unix 秒 → 「MM-DD HH:mm」（东八区固定偏移）。
     * 只用于**确定是时间戳**的列（三江「日期」）；拿不到合理时间戳一律「—」，绝不把裸数字放出去。
     */
    const fmtStamp = function (sec) {
      const n = Number(sec)
      if (!isFinite(n) || n < 1e9) return '—'
      const d = new Date(n * 1000)
      if (isNaN(d.getTime())) return '—'
      // ★ 固定 +8h 再按 UTC 读：不受运行环境时区影响（数据源本来就是北京时间）
      const t = new Date(d.getTime() + 8 * 3600 * 1000)
      const p2 = function (x) { return (x < 10 ? '0' : '') + x }
      return p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate()) + ' ' + p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes())
    }
    function cell(c, r) {
      const k = c.key
      const ex = r.extra || {}
      if (k === 'title') {
        const label = (r.title || '') + (ex.titleSuspect || ex.titleTruncated ? ' ⚠' : '')
        const link = h('a', { href: r.url || '#', style: { color: 'inherit' }, title: '在 DSH 侧栏浏览器打开', onClick: function (e) { e.preventDefault(); e.stopPropagation(); (c._openLink || function (u) { window.open(u, '_blank', 'noopener,noreferrer') })(r.url) } }, label)
        return c._boardId ? h('span', null, link, ' ', h(BookmarkStar, { bookKey: c._bmKey, row: r, boardId: c._boardId, dataDate: c._dataDate })) : link
      }
      // 名次变化：0 显示「0」（持平），不要显示「—」（— 留给「算不出来」：无基准/新入榜）
      // ★ 2026-10-16 跨期不可比（周期榜换期当天）：变化列显示「新期」，不显示一个跨期的假变化
      // ★ 2026-10-17（配色）：delta 是「名次前进为正」的口径 ⇒ >0 上升=绿、<0 下滑=红；0/新期/回榜 不上色
      if (k === 'delta') {
        if (ex.periodChanged === true) return '新期'
        if (r.deltaGroup === 'new') return '＋ 新'
        if (r.deltaGroup === 'rebound') return '回榜'
        // B2：「算不出」也是弱信息，用 muted；只有真涨跌与「＋新」用全色
        if (r.delta === null || r.delta === undefined) return h('span', { style: C.muted }, '—')
        // ★ 2026-11-06：箭头与数字之间不留空格 —— 与概览「变化」列同一写法（↑3 / ↓2）
        if (r.delta > 0) return h('span', { style: C.up }, '↑' + r.delta)
        if (r.delta < 0) return h('span', { style: C.down }, '↓' + Math.abs(r.delta))
        // B2：持平仍然是「0」（语义不变），只是不再抢眼
        return h('span', { style: C.muted }, '0')
      }
      if (k === 'read') return fmtRead(ex.read !== undefined ? ex.read : r.value)
      if (k === 'value') return fmtRead(r.value)
      if (k === 'baseRead') return fmtRead(ex.baseRead !== undefined ? ex.baseRead : ex.prevRead)
      /**
       * 「在读变化」= **我方按天的数值差**（今日 − 上一数据日），口径见 spec-扫榜插件-v1 / 取证文档。
       * ★ 2026-10-16：必须读 extra.valueDelta —— 排在它后面的名次差（row.delta / extra.delta）
       *   是**另一件事**（站方升降）；旧代码读 extra.delta ⇒ 番茄整列显示的是名次差（名次没动就只有 0/—）。
       *   宿主没给 valueDelta 时只认「在读 − 昨日在读」，**绝不**退回名次差。
       */
      if (k === 'readDelta') {
        const vd = ex.valueDelta != null ? ex.valueDelta
          : (typeof r.value === 'number' && typeof ex.prevRead === 'number' ? r.value - ex.prevRead : null)
        if (vd == null) return '—'
        if (vd > 0) return h('span', { style: C.up }, '+' + fmtRead(vd))
        if (vd < 0) return h('span', { style: C.down }, String(vd))
        return '0'
      }
      if (k === 'dailyDelta') {
        if (ex.dailyDelta == null) return '—'
        return h('span', { style: ex.dailyDelta > 0 ? C.up : ex.dailyDelta < 0 ? C.down : null },
          (ex.dailyDelta > 0 ? '+' : '') + ex.dailyDelta)
      }
      // 每日增量已拆成 daily0..daily6 七列（见 view.ts），单元格只取那一天
      if (/^daily\d+$/.test(k)) {
        const d = (ex.daily || [])[Number(k.slice(5))]
        if (!d) return '—'
        return d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + d.delta
      }
      if (k === 'ratio') {
        // 起点图对「首订暂缺」的行把收订比写成 0/-1（伪造值）⇒ 按口径当缺失，不显示负数
        const v = ex.ratio
        return typeof v === 'number' && v > 0 ? v : '—'
      }
      if (k === 'settledDays') return dash(ex.settledDays)
      // 三江「期累计」= 本期已结算各日增量之和（未到的天不计）
      if (k === 'periodTotal') return ex.periodTotal == null ? '—' : (ex.periodTotal > 0 ? '+' : '') + ex.periodTotal
      // 番茄在读周榜：本期内第 N 天的逐日增量数组（与三江的每日增量同构）
      if (/^pday\d+$/.test(k)) {
        const arr = ex.pdays || []
        const v2 = arr[Number(k.slice(4))]
        return v2 == null ? '—' : (v2 > 0 ? '+' : '') + v2
      }
      // 派生榜「本期累计」（自然周内：今日在读 − 期首在读）；期中入池算不出来 ⇒ 「—」
      if (k === 'periodDelta') return ex.periodDelta == null ? '—' : (ex.periodDelta > 0 ? '+' : '') + ex.periodDelta
      // 0.6 收尾补列：都已在快照里，只是之前没有列。空值一律「—」，不补 0
      if (k === 'shouding') return dash(ex.shouding)
      // ★ 2026-10-29 口径修正：三江这一列是「日期」（Unix 秒时间戳），不是「首日增量」⇒ 显示成 MM-DD HH:mm
      if (k === 'firstDay') return fmtStamp(ex.firstDay)
      if (k === 'firstV') return dash(ex.firstV)
      if (k === 'collect') return fmtRead(ex.collect)
      if (k === 'collectBase') return fmtRead(ex.collectBase)
      if (k === 'fans') return fmtRead(ex.fans)
      if (k === 'score') return dash(ex.score)
      if (k === 'words') return fmtWords(ex.wordsText !== undefined ? ex.wordsText : ex.wordsCnt !== undefined ? ex.wordsCnt : ex.wordNumber !== undefined ? ex.wordNumber : ex.words)
      if (k === 'subCat') return dash(ex.subCat)
      if (k === 'cat') return dash(ex.cat)
      if (k === 'days') return dash(r.days)
      if (k === 'author') return dash(r.author)
      if (k === 'rank') return dash(r.rank)
      if (k === 'buyNumRaw') return dash(ex.buyNumRaw)
      return dash(r[k])
    }

    /** 榜 + 站内书号 ⇒ bookKey（与 host 端同一套命名空间规则；起点图归并到 qidian） */
    /**
     * 榜名注册表：概览/目录任一处拿到 name 就记下来。
     * 书签详情、导出提示等处用它把 boardId 换成「站 · 榜名」（以前直接把 `qidiantu.shouding` 这种内部 id 甩给使用者）。
     */
    const BOARD_NAMES = (window.__rankScanBoardNames = window.__rankScanBoardNames || {})
    const rememberBoardNames = function (list) {
      (list || []).forEach(function (b) {
        if (!b || !b.boardId) return
        const label = b.name || b.label
        if (!label) return
        BOARD_NAMES[b.boardId] = b.siteName ? b.siteName + ' · ' + label : label
      })
    }
    const boardLabel = function (boardId) {
      const id = String(boardId || '')
      return BOARD_NAMES[id] || (id || '—')
    }

    /** 清洗简介文本：去掉每行首尾空白（含全角空格 U+3000）与空行，段落之间保留单个换行；空值返回 '' */
    const cleanDesc = function (raw) {
      if (raw == null) return ''
      const lines = String(raw).replace(/\u3000/g, ' ').split(/\r?\n/).map(function (x) { return x.trim() }).filter(function (x) { return !!x })
      return lines.join('\n')
    }

    /** 榜单/书签共用的作品简介（默认 3 行截断，实测溢出才显示「展开简介」） */
    function BoardDesc(props) {
      const [open, setOpen] = React.useState(false)
      const [over, setOver] = React.useState(false)
      const textRef = React.useRef(null)
      const text = cleanDesc(props.text)
      React.useEffect(function () {
        if (!text) return undefined
        const measure = function () {
          const el = textRef.current
          if (!el) return
          // 收起态才量得出「被截断」；展开态下 scrollHeight == clientHeight
          setOver(el.scrollHeight - el.clientHeight > 1)
        }
        measure()
        // 字体/宽度变化都会改变行数：窗口 resize 与面板宽度变化都重量一次
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
        return function () {
          if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure)
        }
      }, [text, open])
      if (!text) return null
      return h('div', { style: { textAlign: 'left' } },
        h('div', {
          ref: textRef,
          style: open
            ? { color: T.fg, fontSize: T.fs.m, whiteSpace: 'pre-line', lineHeight: 1.68, wordBreak: 'break-word', textAlign: 'left' }
            : { color: T.fg, fontSize: T.fs.m, whiteSpace: 'pre-line', lineHeight: 1.68, wordBreak: 'break-word', textAlign: 'left', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
        }, text),
        (over || open)
          ? h('button', { className: 'rs-btn is-ghost', style: { marginTop: '4px', height: '22px', padding: '0', color: T.accent, fontSize: T.fs.s }, onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); setOpen(!open) } }, open ? '收起简介' : '展开简介')
          : null)
    }

    /** 压缩上榜徽章冗余分类后缀（与顶部「分类：…」重复的频道名省略，总榜#1兼分类#1省略，完整信息保留在 hover title） */
    function shortHonourSub(it, category) {
      const sub = it && it.sub ? String(it.sub).trim() : ''
      if (!sub) return null
      const cats = String(category || '').split(/[·/／\s]+/).map(function (s) { return s.trim() }).filter(Boolean)
      const sameCat = function (ch) { return cats.some(function (c) { return c === ch || c.indexOf(ch) === 0 }) }
      if (sameCat(sub)) return null
      const m = /^(.+?)第(\d+)名$/.exec(sub)
      if (m) {
        const ch = m[1].trim()
        const subRk = Number(m[2])
        if (sameCat(ch)) {
          if (it.rank === 1 && subRk === 1) return null
          return '分类#' + subRk
        }
        return ch + '#' + subRk
      }
      return sub
    }

    /** 同会话单本详情内存缓存（榜单与书签共用，已点开的作品再次展开 0ms 秒出） */
    const BOARD_DETAIL_CACHE = {}

    /** 统一左轴规格行（32px 浅灰键名 + 右侧全宽自动换行，消除左右分栏留白洞） */
    const detailKvRow = function (key, label, items) {
      return h('div', { key: key, className: 'rs-bd-kv', style: { display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: '8px', alignItems: 'start', textAlign: 'left' } },
        h('span', { className: 'rs-bd-kv-label', style: { fontSize: T.fs.xs, fontWeight: 500, color: T.muted, lineHeight: '22px', userSelect: 'none' } }, label),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', minWidth: 0 } }, items))
    }

    /** 统一站点题材标签（无边框轻量 4px 软底块，不抢正文和上榜的视觉焦点） */
    const detailTagChip = function (t, idx) {
      return h('span', { key: 'tg-' + idx + '-' + t, className: 'rs-bd-tag', style: { display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: '4px', background: wash(T.fg, 6), fontSize: T.fs.xs, color: T.muted, lineHeight: 1.55 } }, t)
    }

    /** 统一上榜结构徽章（6px 徽章 + 4px 语义色名次方块；榜单浅灰底与书签白底自适应底色） */
    const detailHonourBadge = function (opts) {
      const rk = typeof opts.rank === 'number' && Number.isFinite(opts.rank) ? opts.rank : null
      const rankBg = rk === 1 ? wash(T.warn, 18) : (rk != null && rk <= 3 ? wash(T.accent, 15) : wash(T.fg, 7))
      const rankFg = rk === 1 ? T.warn : (rk != null && rk <= 3 ? T.accent : T.fg)
      const badgeBg = opts.onWhite ? T.surface2 : wash(T.surface, 78)
      return h('span', {
        key: opts.key,
        className: 'rs-bd-honour',
        style: { display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '100%', padding: '2px 7px 2px 3px', borderRadius: T.r.s, background: badgeBg, border: '1px solid ' + wash(T.border, 48), fontSize: T.fs.xs, lineHeight: 1.35, color: T.fg },
        title: opts.title || '',
      },
        h('span', {
          className: rk === 1 ? 'rs-bd-rank is-first' : (rk != null && rk <= 3 ? 'rs-bd-rank is-top' : 'rs-bd-rank'),
          style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '18px', height: '17px', padding: '0 4px', borderRadius: '4px', fontSize: T.fs.xs, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto', background: rankBg, color: rankFg },
        }, rk == null ? '—' : String(rk)),
        h('span', { style: { fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, opts.label),
        opts.meta ? h('span', { style: { color: T.muted, fontSize: T.fs.xs, whiteSpace: 'nowrap' } }, opts.meta) : null)
    }


