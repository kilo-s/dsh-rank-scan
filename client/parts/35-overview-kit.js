/**
 * 35-overview-kit.js：概览纯辅助函数与微组件（平台归并、短榜名、高信号筛选、变化节点、Sparkline、StatCard）。依赖 10/20。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    const fmtBytes = (n) => {
      if (n == null || !isFinite(n)) return '—'
      const u = ['B', 'KB', 'MB', 'GB']
      let i = 0
      let v = Number(n)
      while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++ }
      return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + ' ' + u[i]
    }

    /** 概览简洁数值格式化：>=1亿用亿、>=1万用一位小数万、<1万千分位 */
    const ovFmtBrief = function (n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      const sign = n < 0 ? '-' : ''
      if (abs >= 100000000) return sign + (abs / 100000000).toFixed(2).replace(/\.?0+$/, '') + '亿'
      if (abs >= 10000) return sign + (abs / 10000).toFixed(1).replace(/\.0$/, '') + '万'
      return sign + fmtRead(abs)
    }

    /** 概览「变化」值节点（统一涨跌色，兼容只有字符串的老宿主） */
    function changeDeltaNode(group, it) {
      const row = it || {}
      let n = typeof row.deltaNum === 'number' && Number.isFinite(row.deltaNum) ? row.deltaNum : null
      const raw = row.delta == null ? '' : String(row.delta)
      if (n == null && raw) {
        const m = raw.match(/^([↑↓])\s*(-?\d+(?:\.\d+)?)$/)
        if (m) n = (m[1] === '↓' ? -1 : 1) * Math.abs(Number(m[2]))
      }
      if (group === '新入榜') return h('span', { className: 'rs-ov-delta is-new', style: C.up }, '＋ 新')
      if (group === '回榜') return h('span', { className: 'rs-ov-delta is-muted', style: C.muted }, '回榜')
      if (group === '退榜') return h('span', { className: 'rs-ov-delta is-out', style: C.down }, '→ 榜外')
      if (n == null) return dash(raw)
      if (row.metric === 'value') {
        if (n > 0) return h('span', { className: 'rs-ov-delta is-up', style: C.up }, '+' + fmtRead(n))
        if (n < 0) return h('span', { className: 'rs-ov-delta is-down', style: C.down }, '-' + fmtRead(Math.abs(n)))
        return h('span', { className: 'rs-ov-delta is-muted', style: C.muted }, '0')
      }
      if (n > 0) return h('span', { className: 'rs-ov-delta is-up', style: C.up }, '↑' + n)
      if (n < 0) return h('span', { className: 'rs-ov-delta is-down', style: C.down }, '↓' + Math.abs(n))
      return h('span', { className: 'rs-ov-delta is-muted', style: C.muted }, '0')
    }

    /** 概览卡片内克制变化微标（新入榜走轻量灰底避免满屏荧光绿，数值型用简洁万位） */
    function compactDeltaNode(group, it) {
      const row = it || {}
      let n = typeof row.deltaNum === 'number' && Number.isFinite(row.deltaNum) ? row.deltaNum : null
      const raw = row.delta == null ? '' : String(row.delta)
      if (n == null && raw) {
        const m = raw.match(/^([↑↓])\s*(-?\d+(?:\.\d+)?)$/)
        if (m) n = (m[1] === '↓' ? -1 : 1) * Math.abs(Number(m[2]))
      }
      if (group === '新入榜') {
        const isShouding = String(row.boardId || '').indexOf('qidiantu.shouding') === 0
        return h('span', { className: 'rs-ov-delta is-new' }, isShouding ? '本批上架' : '＋ 新')
      }
      if (group === '回榜') return h('span', { className: 'rs-ov-delta is-new' }, '回榜')
      if (group === '退榜') return h('span', { className: 'rs-ov-delta is-out' }, '→ 榜外')
      if (n == null) return h('span', { className: 'rs-ov-delta is-muted' }, dash(raw))
      if (row.metric === 'value') {
        const s = ovFmtBrief(Math.abs(n))
        if (n > 0) return h('span', { className: 'rs-ov-delta is-up', title: '+' + fmtRead(n) }, '+' + s)
        if (n < 0) return h('span', { className: 'rs-ov-delta is-down', title: '-' + fmtRead(Math.abs(n)) }, '-' + s)
        return h('span', { className: 'rs-ov-delta is-muted' }, '0')
      }
      if (n > 0) return h('span', { className: 'rs-ov-delta is-up' }, '↑' + n)
      if (n < 0) return h('span', { className: 'rs-ov-delta is-down' }, '↓' + Math.abs(n))
      return h('span', { className: 'rs-ov-delta is-muted' }, '0')
    }

    /** 统一 4px 名次方标（对齐榜单/书签细节：#1 琥珀、#2-3 蓝、退榜淡红） */
    function ovRankBadge(rank, isOut, prevRank) {
      if (isOut) {
        const tip = prevRank != null ? '昨日第 ' + prevRank + ' 名，今日退榜' : '今日退榜'
        return h('span', { className: 'rs-ov-rank is-out', title: tip }, '退')
      }
      if (typeof rank !== 'number' || !Number.isFinite(rank)) return h('span', { className: 'rs-ov-rank' }, '—')
      const cls = rank === 1 ? 'rs-ov-rank is-first' : (rank <= 3 ? 'rs-ov-rank is-top' : 'rs-ov-rank')
      return h('span', { className: cls }, String(rank))
    }

    /** 保留克制版 StatCard（供单测及复用：有 onClick 渲染 button，否则 div） */
    function StatCard(props) {
      const tone = props.tone || 'muted'
      const valColor = tone === 'bad' ? T.bad : tone === 'warn' ? T.warn : T.fg
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, textAlign: 'left' } },
        h('div', { style: { ...C.muted, fontSize: T.fs.s, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.label),
        h('div', { style: { fontSize: T.fs.l, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: valColor, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.value),
        props.sub ? h('div', { style: { ...C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: String(props.sub) }, props.sub) : null)
      const style = {
        display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, boxSizing: 'border-box', textAlign: 'left',
        padding: '8px 10px', border: '1px solid ' + T.border, borderRadius: '8px', background: T.surface, color: T.fg, font: 'inherit',
        cursor: props.onClick ? 'pointer' : 'default',
      }
      if (props.onClick) {
        return h('button', { type: 'button', className: 'rs-statcard', style: Object.assign({ appearance: 'none' }, style), onClick: props.onClick, title: props.title || props.label }, body)
      }
      return h('div', { className: 'rs-statcard', style: style, title: props.title || '' }, body)
    }

    /** 概览区块小标题（保留供复用） */
    function SectionHeader(props) {
      return h('div', { ref: props.innerRef, style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, margin: props.first ? '8px 0 4px' : '14px 0 6px' } },
        h('div', { style: { ...C.sectionLabel, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.title),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: '6px', flex: '0 0 auto' } },
          props.count != null && props.count !== '' ? h('span', { style: C.muted }, '（' + props.count + '）') : null,
          props.action || null))
    }

    const SITE_LABELS = { qidian: '起点', qidiantu: '起点图', ciweimao: '刺猬猫', sfacg: '菠萝包', fanqie: '番茄' }
    const PLATFORM_ORDER = ['qidian', 'fanqie', 'ciweimao', 'sfacg']
    const PLATFORM_LABELS = { qidian: '起点', fanqie: '番茄', ciweimao: '刺猬猫', sfacg: '菠萝包' }
    /** 平台归并：起点与起点图本质同属起点站内作品，首页合并呈现 */
    const platformIdOf = function (site) { return site === 'qidiantu' ? 'qidian' : String(site || '') }
    const platformNameOf = function (pid, fallback) { return PLATFORM_LABELS[pid] || fallback || SITE_LABELS[pid] || String(pid) }
    const siteLabelOf = function (ov, s) {
      const hit = ((ov && ov.sites) || []).filter(function (x) { return x.site === s })[0]
      return hit ? hit.siteName : (SITE_LABELS[s] || String(s))
    }

    /** 精简短榜名（界面零废话，完整名放 title） */
    const shortBoardName = function (boardId, fullName, batch) {
      const id = String(boardId || '')
      const raw = String(fullName || id)
      if (id === 'qidiantu.shouding') return batch && batch.key ? '首订·' + mdOf(batch.key) : '首订'
      if (id === 'qidiantu.sanjiang') return '三江'
      if (id === 'ciweimao.buy.latest') return batch && batch.key ? '首订·' + batch.key + '期' : '首订'
      if (id === 'ciweimao.no-vip-click.week') return '点击周'
      if (id === 'ciweimao.yp_new.week') return '新书周'
      if (id === 'sfacg.new.click') return '新书点击'
      if (id === 'sfacg.hot.week') return '轻小说热榜'
      if (id === 'sfacg.vip.week') return 'VIP热销'
      if (id.indexOf('fanqie.derived.') === 0) return '在读周榜'
      const mSign = /签约榜\s*[×xX]\s*([^（(]+)/.exec(raw)
      if (mSign) return mSign[1].trim()
      const mFq = /男频新书榜\s*[×xX]\s*([^（(]+)/.exec(raw)
      if (mFq) return mFq[1].trim()
      return raw.replace(/（移动端口径）|（候选池内）/g, '').trim()
    }

    /** 下次计划纯函数 */
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

    /** 极轻内联 SVG 迷你折线（零依赖；invert=true 时名次越靠前越靠上） */
    function sparklineNode(values, stroke, invert, w, hh) {
      const arr = Array.isArray(values) ? values : []
      const width = w || 44
      const height = hh || 14
      const pts = []
      for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] === 'number' && Number.isFinite(arr[i])) pts.push({ v: arr[i], i: i })
      }
      if (pts.length < 2) return null
      let min = pts[0].v
      let max = pts[0].v
      pts.forEach(function (p) { if (p.v < min) min = p.v; if (p.v > max) max = p.v })
      const span = max - min || 1
      const padX = 2
      const padY = 2
      const denom = Math.max(1, arr.length - 1)
      const coords = pts.map(function (p) {
        const x = padX + (p.i / denom) * (width - padX * 2)
        const norm = (p.v - min) / span
        const y = invert ? (padY + norm * (height - padY * 2)) : (height - padY - norm * (height - padY * 2))
        return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }
      })
      const last = coords[coords.length - 1]
      return h('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, style: { flex: '0 0 auto', display: 'block' }, 'aria-hidden': 'true' },
        h('polyline', {
          fill: 'none', stroke: stroke, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
          points: coords.map(function (c) { return c.x + ',' + c.y }).join(' '),
        }),
        h('circle', { cx: last.x, cy: last.y, r: 1.8, fill: stroke }))
    }

    /** 数值数组的中位数（纯函数，用于动态精选的站内当日基准） */
    const medianOf = function (arr) {
      if (!arr || !arr.length) return 0
      const s = arr.slice().sort(function (a, b) { return a - b })
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }

    /** 提取首订条目数值（兼容起点数字 value 与刺猬猫 9800+ 原串） */
    const batchNumericValueOf = function (bi) {
      const it = (bi && bi.it) ? bi.it : (bi || {})
      if (typeof it.value === 'number' && Number.isFinite(it.value) && it.value > 0) return it.value
      if (it.buyNumRaw) {
        const m = String(it.buyNumRaw).match(/(\d+(?:\.\d+)?)/)
        if (m) return Number(m[1])
      }
      return 0
    }

    /**
     * 统一动态精选引擎（方案 B：上升 / 空降新入榜 / 回榜 / 有效首订同池竞争，低分首订可自然降至 0 席）：
     * - 榜深归一化：按各榜真实行数（如起点签约 20、其余 30）折算相对爬升与空降落位；
     * - 当日相对强弱：对比本站当日涨幅中位数，自动适配平淡日与爆发日；
     * - 软多样性衰减：同子榜递增轻度衰减（-12/席），兼顾多榜覆盖同时放行同榜连爆黑马；
     * - 硬护栏：刺猬猫仅换新期当天参评（freshForHighlights），首订总席位宽窗≤3、窄窗≤2。
     */
    function pickHighlights(items, limit, opts) {
      const cap = limit || 3
      const o = opts || {}
      const changeList = Array.isArray(items) ? items : []
      const batch = o.batch || null
      const batchItems = Array.isArray(o.batchItems) ? o.batchItems : []
      const boardDepths = o.boardDepths || {}
      const pid = o.platformId || ''
      const maxBatch = Math.min(3, Math.max(1, cap - 3))
      const depthOf = function (bid) {
        const d = boardDepths && bid ? boardDepths[bid] : null
        if (typeof d === 'number' && Number.isFinite(d) && d >= 5) return d
        return String(bid || '').indexOf('qidian.sign.') === 0 ? 20 : 30
      }

      // 当日站内中位基准（用于相对离群倍率加分）
      const upVals = []
      const upRankRatios = []
      for (let i = 0; i < changeList.length; i++) {
        const e = changeList[i]
        const it = (e && e.it) || {}
        if (e && e.group === '上升' && typeof it.deltaNum === 'number' && Number.isFinite(it.deltaNum) && it.deltaNum > 0) {
          if (it.metric === 'value') upVals.push(it.deltaNum)
          else upRankRatios.push(it.deltaNum / depthOf(it.boardId))
        }
      }
      const medVal = Math.max(2500, medianOf(upVals))
      const medRankRatio = Math.max(0.08, medianOf(upRankRatios))

      const cands = []
      let seq = 0

      // 1) 日常变化候选
      for (let i = 0; i < changeList.length; i++) {
        const e = changeList[i]
        const it = (e && e.it) || {}
        const bid = it.boardId || ''
        const depth = depthOf(bid)
        const rk = typeof it.rank === 'number' && Number.isFinite(it.rank) ? it.rank : (depth + 1)
        const dn = typeof it.deltaNum === 'number' && Number.isFinite(it.deltaNum) ? it.deltaNum : 0
        const pos = Math.max(0, 1 - (rk - 1) / Math.max(1, depth))
        let sc = 10
        if (e.group === '上升') {
          if (it.metric === 'value') {
            const absPart = Math.min(80, Math.sqrt(Math.max(0, dn) / 1000) * 9.5)
            const relPart = Math.min(28, Math.log2(1 + Math.max(0, dn) / medVal) * 9)
            sc = 96 + absPart + relPart + pos * 14
          } else {
            const ratio = Math.max(0, dn) / Math.max(1, depth)
            const absPart = Math.min(82, ratio * 140)
            const relPart = Math.min(22, Math.log2(1 + ratio / medRankRatio) * 8)
            sc = 96 + absPart + relPart + pos * 14
          }
        } else if (e.group === '新入榜') {
          // 隐含最低爬升 (depth + 1 - rk) / depth，平滑幂函数（无断崖）：前排强空降高分，尾名噪音自动低分
          const implied = Math.max(0, (depth + 1 - rk) / Math.max(1, depth))
          sc = 96 + Math.min(76, Math.pow(implied, 1.35) * 145) + pos * 14
        } else if (e.group === '回榜') {
          sc = 58 + pos * 35
        } else if (e.group === '退榜') {
          sc = 20
        }
        cands.push({ kind: 'change', boardId: bid, key: it.key || it.title || '', sc: sc, idx: seq++, item: e })
      }

      // 2) 有效首订候选（仅 freshForHighlights !== false 时入池，完全凭成绩与日常黑马同池竞争）
      if (batch && batch.freshForHighlights !== false && batchItems.length) {
        const bCount = typeof batch.count === 'number' && batch.count > 0 ? batch.count : batchItems.length
        const volumeBonus = pid === 'qidian'
          ? Math.min(18, Math.log2(1 + bCount / 25) * 6)
          : Math.min(14, Math.log2(1 + bCount / 10) * 7)
        const scale = pid === 'ciweimao' ? 0.75 : 1.0
        for (let i = 0; i < batchItems.length; i++) {
          const bi = batchItems[i]
          const it = (bi && bi.it) ? bi.it : (bi || {})
          const v = batchNumericValueOf(bi)
          if (v <= 0) continue
          const effV = v / scale
          let sc = 46 + Math.min(145, Math.sqrt(effV / 100) * 18.5) + volumeBonus
          if (effV < 800) sc -= (800 - effV) / 22
          cands.push({ kind: 'batch', boardId: (bi && bi.boardId) || batch.boardId || '__batch__', key: it.key || it.title || '', sc: sc, idx: seq++, item: bi })
        }
      }

      if (!cands.length) return []

      // 3) 边际衰减贪心选席：同子榜第 2/3 条分别衰减 -12/-24，首订衰减 -14/-28 且总席位封顶 maxBatch
      const picked = []
      const boardCount = {}
      const seenKeys = {}
      let batchPicked = 0
      while (picked.length < cap) {
        let bestI = -1
        let bestEff = -Infinity
        for (let i = 0; i < cands.length; i++) {
          const c = cands[i]
          if (c._used) continue
          if (c.key && seenKeys[c.key]) continue
          if (c.kind === 'batch' && batchPicked >= maxBatch) continue
          const bc = boardCount[c.boardId] || 0
          const pen = c.kind === 'batch' ? batchPicked * 14 : bc * 12
          const eff = c.sc - pen
          if (eff > bestEff || (eff === bestEff && bestI >= 0 && c.idx < cands[bestI].idx)) {
            bestEff = eff
            bestI = i
          }
        }
        if (bestI < 0) break
        const win = cands[bestI]
        win._used = true
        if (win.key) seenKeys[win.key] = 1
        if (win.kind === 'batch') batchPicked += 1
        else boardCount[win.boardId] = (boardCount[win.boardId] || 0) + 1
        picked.push(win)
      }

      picked.sort(function (a, b) { return b.sc - a.sc || a.idx - b.idx })
      return picked.map(function (s) { return s.item })
    }

    /** 单视角/单站聚焦列表跨榜排序：上升/下降按幅度降序，新入榜/回榜按最新名次升序，退榜按原名次升序 */
    function sortGroupChanges(items, group) {
      if (!items || !items.length) return []
      const grpOrd = { '新入榜': 0, '回榜': 1, '上升': 2, '下降': 3, '退榜': 4 }
      const numOr = function (v, fb) { return typeof v === 'number' && Number.isFinite(v) ? v : fb }
      return items.map(function (e, idx) { return { e: e, idx: idx } }).sort(function (a, b) {
        const ga = group || a.e.group || ''
        const gb = group || b.e.group || ''
        if (!group && ga !== gb) {
          const oa = Object.prototype.hasOwnProperty.call(grpOrd, ga) ? grpOrd[ga] : 9
          const ob = Object.prototype.hasOwnProperty.call(grpOrd, gb) ? grpOrd[gb] : 9
          if (oa !== ob) return oa - ob
        }
        const ia = a.e.it || {}
        const ib = b.e.it || {}
        if (ga === '上升') {
          const da = numOr(ia.deltaNum, -Infinity), db = numOr(ib.deltaNum, -Infinity)
          if (db !== da) return db - da
          const ra = numOr(ia.rank, 9999), rb = numOr(ib.rank, 9999)
          if (ra !== rb) return ra - rb
        } else if (ga === '下降') {
          const da = Math.abs(numOr(ia.deltaNum, 0)), db = Math.abs(numOr(ib.deltaNum, 0))
          if (db !== da) return db - da
          const ra = numOr(ia.rank, 9999), rb = numOr(ib.rank, 9999)
          if (ra !== rb) return ra - rb
        } else if (ga === '退榜') {
          const pa = numOr(ia.prevRank, 9999), pb = numOr(ib.prevRank, 9999)
          if (pa !== pb) return pa - pb
        } else {
          const ra = numOr(ia.rank, 9999), rb = numOr(ib.rank, 9999)
          if (ra !== rb) return ra - rb
        }
        return a.idx - b.idx
      }).map(function (x) { return x.e })
    }

    /** 首订批次条目数值微标（刺猬猫优先 9800+ 原串，起点图用首订千分位） */
    function batchValueNode(it) {
      const row = it || {}
      if (row.buyNumRaw) return h('span', { className: 'rs-ov-delta is-new', title: '第三方约值首订' }, String(row.buyNumRaw))
      if (typeof row.value === 'number' && Number.isFinite(row.value) && row.value > 0) {
        return h('span', { className: 'rs-ov-delta is-new', title: '首订：' + fmtRead(row.value) }, fmtRead(row.value))
      }
      return h('span', { className: 'rs-ov-delta is-muted' }, '—')
    }

    /** 同会话单书走势缓存（key = bookKey|boardId|days|rev） */
    const BOOK_TREND_CACHE = {}

    /** 概览统一站点色板与多曲线循环色板（36/37/38/39/40 共用单一来源） */
    const OV_CHART_COLORS = [T.chart0, T.chart1, T.chart2, T.chart3, T.chart4, T.chart5]
    const OV_SITE_COLORS = {
      fanqie: T.siteFanqie,
      qidian: T.siteQidian,
      ciweimao: T.siteCiweimao,
      sfacg: T.siteSfacg,
    }

    /** 格式化本地接口报错（专门识别宿主未重启导致的 404，避免静默吞错显示成「无数据」） */
    function formatOvApiError(err) {
      if (!err) return '读取失败'
      const status = typeof err.status === 'number' ? err.status : 0
      const msg = String(err.message || err || '')
      if (status === 404 || /404|not found/i.test(msg)) {
        return '后端接口未就绪（HTTP 404）：DSH 宿主仍在运行旧版内存缓存，请完全重启 DSH 桌面端以加载新版接口'
      }
      return '读取失败：' + msg.slice(0, 120)
    }

    /** 概览卡片带标签复合状态 Hook（统一去重，并彻底免疫测试渲染器跨组件状态槽串味） */
    function useOvState(tag, initFn) {
      const [raw, setRaw] = React.useState(function () { return Object.assign({ _tag: tag }, initFn()) })
      const st = (raw && typeof raw === 'object' && raw._tag === tag) ? raw : Object.assign({ _tag: tag }, initFn())
      const patch = function (p) {
        setRaw(function (prev) {
          const base = (prev && typeof prev === 'object' && prev._tag === tag) ? prev : Object.assign({ _tag: tag }, initFn())
          return Object.assign({}, base, typeof p === 'function' ? p(base) : p)
        })
      }
      return [st, patch]
    }

    /** 概览浮层统一关闭 Hook（点外部自动收起 + 接入面板既有 Esc 层级，与 PopMenu 体验一致） */
    function useOvPopoverClose(open, onClose, boxRef) {
      const closeRef = React.useRef(onClose)
      closeRef.current = onClose
      useEscLayer(open ? function () { closeRef.current && closeRef.current(); return true } : null)
      React.useEffect(function () {
        if (!open || typeof document === 'undefined' || !document.addEventListener) return undefined
        const onDown = function (ev) {
          const box = boxRef && boxRef.current
          if (box && ev && ev.target && box.contains && box.contains(ev.target)) return
          closeRef.current && closeRef.current()
        }
        document.addEventListener('mousedown', onDown, true)
        return function () { document.removeEventListener('mousedown', onDown, true) }
      }, [open, boxRef])
    }

    /** 概览卡片统一状态提示（错误+重试 / 加载中 / 空态） */
    function ovCardNotice(opts) {
      const o = opts || {}
      if (o.error) {
        return h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '18px 8px', fontSize: T.fs.xs, color: T.warn, textAlign: 'center' } },
          h('span', null, o.error),
          o.onRetry ? h('button', { type: 'button', className: 'rs-ov-chip', onClick: o.onRetry }, '重试') : null)
      }
      return h('div', { style: { ...C.muted, padding: o.pad || '24px 0', textAlign: 'center', fontSize: T.fs.xs } }, o.text || '')
    }

    /** 归一化跨源书号键（qidiantu:ID → qidian:ID），保证对比列表增删与后端返回键一致 */
    function normOvBookKey(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.indexOf('qidiantu:') === 0 ? ('qidian:' + s.slice(9)) : s
    }

    /** 对比书单去重归一化（最多 8 本） */
    function dedupeCompareKeys(arr) {
      const out = []
      const seen = {}
      ;(Array.isArray(arr) ? arr : []).forEach(function (raw) {
        const k = normOvBookKey(raw)
        if (!k || seen[k]) return
        seen[k] = 1
        if (out.length < 8) out.push(k)
      })
      return out
    }

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

    /** 生成整洁的对数（Log10）坐标刻度：按 1/2/5×10^k 紧贴边界并控制在 3~6 档 */
    function chartLogTicks(minV, maxV) {
      const loRaw = (typeof minV === 'number' && Number.isFinite(minV) && minV > 0) ? minV : 1
      const hiRaw = (typeof maxV === 'number' && Number.isFinite(maxV) && maxV > 0) ? Math.max(loRaw, maxV) : Math.max(10, loRaw * 10)
      const minExp = Math.floor(Math.log10(loRaw)) - 1
      const maxExp = Math.ceil(Math.log10(hiRaw)) + 1
      const mults = [1, 2, 5]
      const grid = []
      for (let e = minExp; e <= maxExp; e++) {
        const base = Math.pow(10, e)
        for (let i = 0; i < mults.length; i++) {
          const v = Number((mults[i] * base).toPrecision(6))
          if (v > 0) grid.push(v)
        }
      }
      let loIdx = 0
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] <= loRaw * 1.0001) loIdx = i
      }
      let hiIdx = grid.length - 1
      for (let i = grid.length - 1; i >= 0; i--) {
        if (grid[i] >= hiRaw * 0.9999) hiIdx = i
      }
      if (loIdx === hiIdx) {
        loIdx = Math.max(0, loIdx - 1)
        hiIdx = Math.min(grid.length - 1, hiIdx + 1)
      }
      const span = grid.slice(loIdx, hiIdx + 1)
      if (span.length <= 5) return span
      const decades = span.filter(function (v, idx) {
        if (idx === 0 || idx === span.length - 1) return true
        const lg = Math.log10(v)
        return Math.abs(lg - Math.round(lg)) < 1e-6
      })
      if (decades.length >= 3 && decades.length <= 6) return decades
      const step = Math.ceil((span.length - 1) / 4)
      const out = []
      for (let i = 0; i < span.length; i += step) out.push(span[i])
      if (out[out.length - 1] !== span[span.length - 1]) out.push(span[span.length - 1])
      return out
    }

    /**
     * 作品对比卡坐标轴计算（纯函数，支持离线单测）：
     * - 仅在 yAxis==='value' 且同时含番茄（在读）与非番茄（收藏）时自动启用左在读/右收藏双轴；
     * - yAxis==='value' 时支持 linear / log（Log10），涨幅% 与名次自动保持线性单轴。
     */
    function buildCompareAxes(books, yAxis, yScale, geom) {
      const g = geom || {}
      const vh = typeof g.vh === 'number' ? g.vh : 212
      const padB = typeof g.padB === 'number' ? g.padB : 26
      const yField = yAxis === 'pct' ? 'pct' : (yAxis === 'rank' ? 'rank' : 'value')
      const invertY = yAxis === 'rank'
      const useLog = yAxis === 'value' && yScale === 'log'

      const fqVals = []
      const otherVals = []
      ;(Array.isArray(books) ? books : []).forEach(function (b) {
        const bucket = b && b.site === 'fanqie' ? fqVals : otherVals
        ;((b && b.points) || []).forEach(function (p) {
          const yv = p && p[yField]
          if (typeof yv !== 'number' || !Number.isFinite(yv)) return
          if (useLog && !(yv > 0)) return
          bucket.push(yv)
        })
      })

      const isDual = yAxis === 'value' && fqVals.length > 0 && otherVals.length > 0
      const padT = isDual ? 22 : 16
      const padR = isDual ? 54 : 18
      const plotH = Math.max(40, vh - padT - padB)

      const mkAxis = function (vals, label, side) {
        if (!vals.length) return null
        const minV = Math.min.apply(null, vals)
        const maxV = Math.max.apply(null, vals)
        if (useLog) {
          const ticks = chartLogTicks(minV, maxV)
          const loLog = Math.log10(ticks[0])
          const hiLog = Math.log10(ticks[ticks.length - 1])
          const spanLog = Math.max(1e-6, hiLog - loLog)
          return {
            label: label, side: side, ticks: ticks, min: ticks[0], max: ticks[ticks.length - 1],
            yAt: function (v) {
              if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) return null
              const norm = (Math.log10(v) - loLog) / spanLog
              return padT + plotH - norm * plotH
            },
          }
        }
        const ticks = chartNiceTicks(minV, maxV, 4)
        const lo = ticks[0]
        const hi = ticks[ticks.length - 1]
        const span = Math.max(1e-6, hi - lo)
        return {
          label: label, side: side, ticks: ticks, min: lo, max: hi,
          yAt: function (v) {
            if (typeof v !== 'number' || !Number.isFinite(v)) return null
            const norm = (v - lo) / span
            return invertY ? (padT + norm * plotH) : (padT + plotH - norm * plotH)
          },
        }
      }

      const left = isDual
        ? mkAxis(fqVals, '在读', 'left')
        : mkAxis(fqVals.concat(otherVals), yAxis === 'value' ? (fqVals.length && !otherVals.length ? '在读' : '收藏') : '', 'left')
      const right = isDual ? mkAxis(otherVals, '收藏', 'right') : null
      const sideOfBook = function (b) { return (isDual && b && b.site !== 'fanqie') ? 'right' : 'left' }
      const yAtBook = function (b, v) {
        const ax = sideOfBook(b) === 'right' && right ? right : left
        return ax ? ax.yAt(v) : null
      }
      return {
        yField: yField,
        invertY: invertY,
        useLog: useLog,
        isDual: isDual,
        padT: padT,
        padR: padR,
        plotH: plotH,
        left: left,
        right: right,
        hasData: !!(left && left.ticks.length),
        sideOfBook: sideOfBook,
        yAtBook: yAtBook,
      }
    }
