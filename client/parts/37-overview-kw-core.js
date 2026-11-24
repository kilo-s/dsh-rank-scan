/**
 * 37-overview-kw-core.js：关键词生态核心引擎（词库模型、单连通枢纽衍生树排布、词云螺旋排布与 60fps 防碰撞 SVG 物理挂载）。依赖 00/10/20/35。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    const KW_SITES = [
      { id: 'fanqie', name: PLATFORM_LABELS.fanqie, color: OV_SITE_COLORS.fanqie },
      { id: 'qidian', name: PLATFORM_LABELS.qidian, color: OV_SITE_COLORS.qidian },
      { id: 'ciweimao', name: PLATFORM_LABELS.ciweimao, color: OV_SITE_COLORS.ciweimao },
      { id: 'sfacg', name: PLATFORM_LABELS.sfacg, color: OV_SITE_COLORS.sfacg },
    ]
    const KW_SITE_INDEX = { fanqie: 0, qidian: 1, ciweimao: 2, sfacg: 3 }
    const KW_TREE_VW = 960
    const KW_TREE_VH = 520

    function kwArcPath(x1, y1, x2, y2, bend) {
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const dx = x2 - x1
      const dy = y2 - y1
      return 'M' + x1.toFixed(1) + ',' + y1.toFixed(1)
        + ' Q' + (mx - dy * bend).toFixed(1) + ',' + (my + dx * bend).toFixed(1)
        + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1)
    }

    function kwMixSurface(color, pct) {
      return 'color-mix(in srgb, ' + color + ' ' + pct + '%, ' + T.surface + ')'
    }

    /** 将后端 /keywords 返回的 nodes 对象归一化为索引化词库与桥梁权重 */
    function prepareKwModel(nodesObj) {
      const names = nodesObj && typeof nodesObj === 'object' ? Object.keys(nodesObj) : []
      const byName = {}
      const terms = names.map(function (k, i) {
        byName[k] = i
        const raw = nodesObj[k] || {}
        const domIdx = KW_SITE_INDEX[raw.dom] != null ? KW_SITE_INDEX[raw.dom] : 0
        return {
          i: i, k: k,
          n: Number(raw.n) || 0, heat: Number(raw.heat) || 0, top1: Number(raw.top1) || 100,
          dom: domIdx,
          sc: Array.isArray(raw.sc) ? raw.sc : [0, 0, 0, 0],
          ss: Array.isArray(raw.ss) ? raw.ss : [0, 0, 0, 0],
          pName: raw.p || null, p: -1, sb: raw.sb || '',
          rawRels: Array.isArray(raw.r) ? raw.r : [], rels: [], bridge: 0,
        }
      })
      const coPair = {}
      terms.forEach(function (t) {
        if (t.pName && byName[t.pName] != null) t.p = byName[t.pName]
        t.rels = t.rawRels
          .filter(function (x) { return Array.isArray(x) && byName[x[0]] != null })
          .map(function (x) { return { i: byName[x[0]], co: Number(x[1]) || 0, sim: Number(x[2]) || 0, sb: x[3] || '' } })
        t.rels.forEach(function (r) {
          const key = Math.min(t.i, r.i) + '-' + Math.max(t.i, r.i)
          if (!coPair[key] || r.sim > coPair[key].sim) coPair[key] = r
        })
      })
      const kidsCount = new Array(terms.length).fill(0)
      terms.forEach(function (t) { if (t.p >= 0) kidsCount[t.p] += 1 })
      terms.forEach(function (t) {
        const strongRel = t.rels.filter(function (r) { return r.sim >= 0.09 }).length
        const siteSpread = t.ss.filter(function (v) { return v >= 0.5 }).length
        t.bridge = strongRel * 1.6 + Math.min(8, kidsCount[t.i]) * 1.1 + siteSpread * 1.2 + Math.sqrt(Math.max(0.1, t.heat)) * 1.4
        t.hubScore = t.heat * 0.65 + t.bridge * 0.35
      })
      const coreIds = terms
        .filter(function (t) { return t.n >= 3 || t.heat >= 0.8 })
        .sort(function (a, b) { return b.hubScore - a.hubScore })
        .slice(0, 64)
        .map(function (t) { return t.i })
      if (!coreIds.length && terms.length) {
        terms.slice().sort(function (a, b) { return b.heat - a.heat }).slice(0, 64).forEach(function (t) { coreIds.push(t.i) })
      }
      const bridgeHubs = {}
      terms.slice().sort(function (a, b) { return b.bridge - a.bridge }).slice(0, 14).forEach(function (t) { bridgeHubs[t.i] = true })
      const multiHubs = terms
        .filter(function (t) { return t.n >= 3 && t.top1 < 48 })
        .sort(function (a, b) { return b.hubScore - a.hubScore })
      const quickRootIds = multiHubs.slice(0, 8).map(function (t) { return t.i })
      if (quickRootIds.length < Math.min(8, terms.length)) {
        const seen = {}
        quickRootIds.forEach(function (id) { seen[id] = true })
        terms.slice().sort(function (a, b) { return b.hubScore - a.hubScore }).forEach(function (t) {
          if (quickRootIds.length < 8 && !seen[t.i]) { seen[t.i] = true; quickRootIds.push(t.i) }
        })
      }
      const quickRoots = quickRootIds.map(function (id) { return terms[id].k })
      const defaultRootId = quickRootIds.length ? quickRootIds[0] : (coreIds.length ? coreIds[0] : (terms.length ? 0 : -1))
      return { terms: terms, byName: byName, coPair: coPair, coreIds: coreIds, bridgeHubs: bridgeHubs, quickRoots: quickRoots, defaultRootId: defaultRootId }
    }

    /** 构建「单连通·3层均衡径向枢纽骨架树」（根稳居正中 480,260，100% 零重叠） */
    function buildKwBackboneTree(model, rootId) {
      if (!model || !model.terms.length || rootId < 0 || !model.terms[rootId]) {
        return { gNodes: [], gEdges: [], nodeById: {}, inTree: {} }
      }
      const terms = model.terms
      const getCo = function (a, b) { return model.coPair[Math.min(a, b) + '-' + Math.max(a, b)] || null }
      const pool = model.coreIds.indexOf(rootId) >= 0 ? model.coreIds.slice() : [rootId].concat(model.coreIds.slice(0, 63))

      const inTree = {}
      const inTreeIds = [rootId]
      inTree[rootId] = { id: rootId, depth: 0, parentId: -1, co: 0, sim: 1, sb: '', kids: [] }
      const rem = pool.filter(function (id) { return id !== rootId })

      const rootDirectMax = Math.min(8, rem.length)
      const rootCand = rem.map(function (v) {
        const pair = getCo(rootId, v)
        const vt = terms[v]
        const isSem = vt.p === rootId || terms[rootId].p === v
        const coW = pair ? pair.sim * Math.log2(pair.co + 1.5) : 0
        const score = coW + (isSem ? 0.28 : 0) + (model.bridgeHubs[v] ? 0.24 : -0.18) + Math.min(0.16, vt.heat * 0.018)
        return { v: v, pair: pair, score: score }
      }).sort(function (a, b) { return b.score - a.score }).slice(0, rootDirectMax)

      const remSet = {}
      rem.forEach(function (v) { remSet[v] = true })
      rootCand.forEach(function (rc) {
        inTree[rc.v] = {
          id: rc.v, depth: 1, parentId: rootId,
          co: rc.pair ? rc.pair.co : 0, sim: rc.pair ? rc.pair.sim : 0.11,
          sb: (rc.pair && rc.pair.sb) || terms[rc.v].sb, kids: [],
        }
        inTree[rootId].kids.push(rc.v)
        inTreeIds.push(rc.v)
        delete remSet[rc.v]
      })

      let leftIds = Object.keys(remSet).map(Number)
      while (leftIds.length) {
        let bestV = -1, bestU = -1, bestScore = -1e9, bestPair = null
        for (let i = 0; i < leftIds.length; i++) {
          const v = leftIds[i]
          const vt = terms[v]
          for (let j = 0; j < inTreeIds.length; j++) {
            const u = inTreeIds[j]
            const uInf = inTree[u]
            if (uInf.depth >= 3 || (u === rootId && uInf.kids.length >= rootDirectMax + 1)) continue
            const pair = getCo(u, v)
            const isSem = vt.p === u || terms[u].p === v
            if (!pair && !isSem) continue
            const coW = pair ? pair.sim * Math.log2(pair.co + 1.5) : 0.04
            const score = coW + (isSem ? 0.42 : 0) + (model.bridgeHubs[u] ? 0.12 : 0)
              - Math.max(0, uInf.kids.length - 5) * 0.07 - (uInf.depth === 0 ? 0.25 : uInf.depth * 0.06)
            if (score > bestScore) { bestScore = score; bestV = v; bestU = u; bestPair = pair }
          }
        }
        if (bestV < 0) {
          bestV = leftIds[0]
          const p = terms[bestV].p
          bestU = (p >= 0 && inTree[p]) ? p : (rootCand.length ? rootCand[0].v : rootId)
          bestPair = getCo(bestU, bestV)
        }
        const uInf = inTree[bestU]
        inTree[bestV] = {
          id: bestV, depth: uInf.depth + 1, parentId: bestU,
          co: bestPair ? bestPair.co : 0, sim: bestPair ? bestPair.sim : 0.08,
          sb: (bestPair && bestPair.sb) || terms[bestV].sb, kids: [],
        }
        uInf.kids.push(bestV)
        inTreeIds.push(bestV)
        delete remSet[bestV]
        leftIds = Object.keys(remSet).map(Number)
      }

      const weight = {}
      function calcW(id) {
        const inf = inTree[id]
        if (!inf.kids.length) { weight[id] = 1; return 1 }
        inf.kids.sort(function (a, b) { return terms[b].heat - terms[a].heat })
        let s = 0
        inf.kids.forEach(function (ki) { s += calcW(ki) })
        if (id === rootId && inf.kids.length > 3) {
          const sorted = inf.kids.slice().sort(function (a, b) { return (weight[b] || 1) - (weight[a] || 1) })
          const interleaved = []
          let l = 0, r = sorted.length - 1
          while (l <= r) { interleaved.push(sorted[l++]); if (l <= r) interleaved.push(sorted[r--]) }
          inf.kids = interleaved
        }
        weight[id] = s
        return s
      }
      calcW(rootId)

      const cx = KW_TREE_VW / 2, cy = KW_TREE_VH / 2
      const RADII = [0, 108, 198, 272, 322]
      const gNodes = []
      const nodeById = {}

      function layoutNode(id, aStart, aEnd) {
        const inf = inTree[id]
        const t = terms[id]
        const mid = (aStart + aEnd) / 2
        const isHub = inf.depth === 0 || inf.kids.length >= 2
        const baseR = Math.sqrt(Math.max(0.4, t.heat))
        const r = inf.depth === 0 ? Math.max(24, Math.min(30, 18 + baseR * 4.2))
          : isHub ? Math.max(14.5, Math.min(21, 10.5 + baseR * 3.5))
          : Math.max(10.5, Math.min(16, 8 + baseR * 2.7))
        const simPull = inf.depth > 0 ? Math.min(16, inf.sim * 42) : 0
        const baseRad = RADII[inf.depth] !== undefined ? RADII[inf.depth] : 322
        const rad = inf.depth === 0 ? 0 : Math.max(58, baseRad - simPull)
        const x = cx + Math.cos(mid) * rad * 1.42
        const y = cy + Math.sin(mid) * rad * 0.78
        const nd = { id: id, t: t, depth: inf.depth, parentId: inf.parentId, isHub: isHub, kidsCount: inf.kids.length, x: x, y: y, ax: x, ay: y, vx: 0, vy: 0, r: r, pin: inf.depth === 0 }
        gNodes.push(nd)
        nodeById[id] = nd
        let cur = aStart
        const totW = weight[id] || 1
        inf.kids.forEach(function (ki) {
          const next = cur + (aEnd - aStart) * ((weight[ki] || 1) / totW)
          layoutNode(ki, cur, next)
          cur = next
        })
      }
      layoutNode(rootId, -Math.PI / 2, Math.PI * 1.5)

      const gEdges = []
      const edgeKeys = {}
      inTreeIds.forEach(function (id) {
        const inf = inTree[id]
        if (inf.parentId < 0) return
        const a = nodeById[inf.parentId], b = nodeById[id]
        const restLen = a.r + b.r + (a.depth === 0 ? 54 : a.depth === 1 ? 42 : 30)
        gEdges.push({ a: a, b: b, co: inf.co, sim: inf.sim, sb: inf.sb, backbone: true, cross: false, restLen: restLen })
        edgeKeys[Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id)] = true
      })
      gNodes.forEach(function (nd) {
        nd.t.rels.slice(0, 3).forEach(function (r) {
          if (r.sim < 0.16 || !nodeById[r.i]) return
          const key = Math.min(nd.id, r.i) + '-' + Math.max(nd.id, r.i)
          if (edgeKeys[key]) return
          edgeKeys[key] = true
          gEdges.push({ a: nd, b: nodeById[r.i], co: r.co, sim: r.sim, sb: r.sb, backbone: false, cross: true, restLen: 140 })
        })
      })

      for (let it = 0; it < 160; it++) {
        for (let i = 0; i < gNodes.length; i++) {
          const a = gNodes[i]
          for (let j = i + 1; j < gNodes.length; j++) {
            const b = gNodes[j]
            const dx = b.x - a.x, dy = b.y - a.y
            const dist = Math.hypot(dx, dy) || 0.01
            const minD = a.r + b.r + (a.isHub || b.isHub ? 9 : 7)
            if (dist < minD) {
              const push = (minD - dist) * 0.52, ux = dx / dist, uy = dy / dist
              if (a.pin) { b.x += ux * push; b.y += uy * push }
              else if (b.pin) { a.x -= ux * push; a.y -= uy * push }
              else { a.x -= ux * push * 0.5; a.y -= uy * push * 0.5; b.x += ux * push * 0.5; b.y += uy * push * 0.5 }
            }
          }
        }
        for (let ei = 0; ei < gEdges.length; ei++) {
          const e = gEdges[ei]
          if (!e.backbone) continue
          const ax = e.a.x, ay = e.a.y, vx = e.b.x - ax, vy = e.b.y - ay
          const len2 = vx * vx + vy * vy || 1
          for (let ci = 0; ci < gNodes.length; ci++) {
            const c = gNodes[ci]
            if (c === e.a || c === e.b || c.pin) continue
            const tt = Math.max(0.08, Math.min(0.92, ((c.x - ax) * vx + (c.y - ay) * vy) / len2))
            const dx = c.x - (ax + vx * tt), dy = c.y - (ay + vy * tt)
            const dist = Math.hypot(dx, dy) || 0.01
            const clear = c.r + 10
            if (dist < clear) { const p = (clear - dist) * 0.35; c.x += (dx / dist) * p; c.y += (dy / dist) * p }
          }
        }
        for (let ni = 0; ni < gNodes.length; ni++) {
          const n = gNodes[ni]
          if (n.pin) continue
          n.x = Math.max(n.r + 16, Math.min(KW_TREE_VW - n.r - 16, n.x + (n.ax - n.x) * 0.032))
          n.y = Math.max(n.r + 16, Math.min(KW_TREE_VH - n.r - 16, n.y + (n.ay - n.y) * 0.032))
        }
      }
      gNodes.forEach(function (n) { n.ax = n.x; n.ay = n.y })
      return { gNodes: gNodes, gEdges: gEdges, nodeById: nodeById, inTree: inTree }
    }

    /** 宽画布高密度阿基米德螺旋词云排布（710×406，4600 步探测） */
    function packKwWordCloud(rawList, filter) {
      let list = (rawList || []).map(function (x) {
        return {
          k: String(x[0] || ''), v: Number(x[1]) || 0, n: Number(x[2]) || 0,
          top1: Number(x[3]) || 100, sb: String(x[4] || ''), tv: Number(x[5]) || 0,
          isMono: (Number(x[2]) || 0) <= 2 || (Number(x[3]) || 100) >= 48,
        }
      })
      if (filter === 'multi') list = list.filter(function (x) { return !x.isMono })
      else if (filter === 'mono') list = list.filter(function (x) { return x.isMono })

      const W = 710, H = 406, cx = W / 2, cy = H / 2
      let maxV = 0.1
      list.forEach(function (x) { if (x.v > maxV) maxV = x.v })
      const placed = []
      const hit = function (a, b) { return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2) }

      list.forEach(function (w, idx) {
        const ratio = w.v / maxV
        let fs = 8.2
        if (idx < 3) fs = Math.round(25 + ratio * 10)
        else if (idx < 12) fs = Math.round(15.5 + Math.pow(ratio, 0.7) * 9.5)
        else if (idx < 38) fs = Math.round(11 + Math.pow(ratio, 0.6) * 5.5)
        else if (idx < 90) fs = Math.round(9 + Math.pow(ratio, 0.5) * 3)
        const vert = idx >= 4 && idx % 6 === 0 && w.k.length <= 3
        let charW = 0
        for (let ci = 0; ci < w.k.length; ci++) charW += w.k.charCodeAt(ci) <= 127 ? 0.58 : (idx < 12 ? 1.04 : 0.98)
        const padX = idx < 12 ? 3.8 : (idx < 38 ? 1.9 : 1.05)
        const padY = idx < 12 ? 2.4 : (idx < 38 ? 1.3 : 0.85)
        const bw = (vert ? fs * 1.06 : charW * fs) + padX * 2
        const bh = (vert ? charW * fs : fs * 1.1) + padY * 2
        for (let step = 0; step < 4600; step++) {
          const ang = step * 0.185 + idx * 1.37
          const rad = 1.32 * Math.sqrt(step * 2.55)
          const x = cx + Math.cos(ang) * rad * 1.62
          const y = cy + Math.sin(ang) * rad * 0.89
          const box = { x1: x - bw / 2, y1: y - bh / 2, x2: x + bw / 2, y2: y + bh / 2 }
          if (box.x1 < 4 || box.x2 > W - 4 || box.y1 < 4 || box.y2 > H - 4) continue
          let collided = false
          for (let pi = 0; pi < placed.length; pi++) { if (hit(box, placed[pi].box)) { collided = true; break } }
          if (!collided) { placed.push({ x: x, y: y, box: box, fs: fs, vert: vert, w: w, idx: idx }); break }
        }
      })
      return { W: W, H: H, placed: placed, total: list.length, list: list }
    }

    /** 60fps 物理防碰撞 SVG 挂载器（拖拽唤醒、收敛休眠、滚轮缩放与背景平移） */
    function mountKwBackboneSvg(svg, treeData, stateRef, cbs) {
      if (!svg || typeof document === 'undefined' || typeof document.createElementNS !== 'function') return null
      const NS = 'http://www.w3.org/2000/svg'
      const mk = function (tag) { return document.createElementNS(NS, tag) }
      while (svg.firstChild) svg.removeChild(svg.firstChild)

      const vp = mk('g'), edgesL = mk('g'), nodesL = mk('g')
      vp.appendChild(edgesL); vp.appendChild(nodesL); svg.appendChild(vp)

      const gNodes = treeData.gNodes.map(function (n) { return Object.assign({}, n, { vx: 0, vy: 0 }) })
      const nodeById = {}
      gNodes.forEach(function (n) { nodeById[n.id] = n })
      const gEdges = treeData.gEdges.map(function (e) { return Object.assign({}, e, { a: nodeById[e.a.id], b: nodeById[e.b.id] }) })
      const inTree = treeData.inTree
      const backboneEdges = gEdges.filter(function (e) { return e.backbone })

      const tf = { x: 0, y: 0, k: 1 }
      const applyTf = function () {
        vp.setAttribute('transform', 'translate(' + tf.x.toFixed(1) + ',' + tf.y.toFixed(1) + ') scale(' + tf.k.toFixed(3) + ')')
      }

      const edgeEls = gEdges.map(function (e) {
        const g = mk('g'), p = mk('path')
        p.setAttribute('class', 'rs-kw-edge')
        const col = e.cross ? T.muted : KW_SITES[e.b.t.dom].color
        const sw = e.cross ? Math.max(0.8, Math.min(1.6, 0.7 + e.sim * 3.5))
          : (e.a.depth === 0 ? Math.max(1.6, Math.min(3.4, 1.2 + e.sim * 8)) : Math.max(1.0, Math.min(2.6, 0.8 + e.sim * 7)))
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', col); p.setAttribute('stroke-width', sw.toFixed(1))
        if (e.cross) p.setAttribute('stroke-dasharray', '3 3')
        g.appendChild(p)
        const lb = mk('text')
        lb.setAttribute('text-anchor', 'middle'); lb.setAttribute('font-size', '8.5'); lb.setAttribute('fill', T.muted)
        lb.style.pointerEvents = 'none'; lb.textContent = e.co > 0 ? e.co + '本·' + e.sim : ''; lb.setAttribute('opacity', '0')
        g.appendChild(lb); edgesL.appendChild(g)
        return { e: e, p: p, lb: lb, baseOp: e.cross ? 0.11 : (e.a.depth === 0 ? 0.54 : 0.38), baseSw: sw }
      })

      const nodeEls = gNodes.map(function (n) {
        const g = mk('g')
        g.setAttribute('class', 'rs-kw-node')
        const col = KW_SITES[n.t.dom].color
        const isMono = n.t.top1 >= 48 || n.t.n <= 2
        if (n.isHub && n.depth > 0) {
          const halo = mk('circle')
          halo.setAttribute('r', (n.r + 3).toFixed(1)); halo.setAttribute('fill', 'none')
          halo.setAttribute('stroke', col); halo.setAttribute('stroke-width', '0.8'); halo.setAttribute('stroke-opacity', '0.32')
          g.appendChild(halo)
        }
        const c = mk('circle')
        c.setAttribute('r', n.r.toFixed(1))
        c.setAttribute('fill', kwMixSurface(col, n.depth === 0 ? 18 : n.isHub ? 13 : 7))
        c.setAttribute('stroke', isMono && n.depth > 0 ? T.warn : col)
        c.setAttribute('stroke-width', n.depth === 0 ? '2' : n.isHub ? '1.4' : '1')
        if (isMono && n.depth > 0) c.setAttribute('stroke-dasharray', '2.8 2')
        g.appendChild(c)
        if (n.depth === 0) {
          const tot = n.t.ss.reduce(function (a, b) { return a + b }, 0) || 1
          let a0 = -Math.PI / 2
          const rr = n.r + 3.5
          n.t.ss.forEach(function (v, si) {
            const frac = v / tot
            if (frac < 0.025) return
            const a1 = a0 + frac * Math.PI * 2
            const arc = mk('path')
            arc.setAttribute('d', 'M' + (Math.cos(a0) * rr).toFixed(1) + ',' + (Math.sin(a0) * rr).toFixed(1) + ' A' + rr.toFixed(1) + ',' + rr.toFixed(1) + ' 0 ' + (frac > 0.5 ? 1 : 0) + ',1 ' + (Math.cos(a1) * rr).toFixed(1) + ',' + (Math.sin(a1) * rr).toFixed(1))
            arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', KW_SITES[si].color); arc.setAttribute('stroke-width', '2.4'); arc.setAttribute('stroke-opacity', '0.9')
            g.appendChild(arc); a0 = a1
          })
        }
        const txt = mk('text')
        txt.setAttribute('text-anchor', 'middle')
        const fs = n.depth === 0 ? (n.t.k.length >= 4 ? 11 : 13) : n.isHub ? (n.t.k.length >= 4 ? 9 : 10.4) : (n.t.k.length >= 4 ? 8.2 : 9.2)
        txt.setAttribute('font-size', String(fs)); txt.setAttribute('font-weight', n.depth === 0 ? '700' : n.isHub ? '600' : '400')
        txt.setAttribute('fill', T.fg); txt.setAttribute('y', n.depth === 0 ? '0.5' : '3.2')
        txt.style.pointerEvents = 'none'; txt.textContent = n.t.k; g.appendChild(txt)
        if (n.depth === 0) {
          const sub = mk('text')
          sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('font-size', '8.2'); sub.setAttribute('fill', T.muted)
          sub.setAttribute('y', '11.5'); sub.style.pointerEvents = 'none'; sub.textContent = n.t.n + '本·热' + n.t.heat; g.appendChild(sub)
        }
        nodesL.appendChild(g)
        return { n: n, g: g, c: c }
      })

      function redrawPositions() {
        edgeEls.forEach(function (it) {
          const e = it.e
          const bend = e.cross ? 0.16 : (e.a.depth === 0 ? 0.08 : 0.11)
          it.p.setAttribute('d', kwArcPath(e.a.x, e.a.y, e.b.x, e.b.y, bend))
          const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
          it.lb.setAttribute('x', ((e.a.x + e.b.x) / 2 - dy * bend * 0.52).toFixed(1))
          it.lb.setAttribute('y', ((e.a.y + e.b.y) / 2 + dx * bend * 0.52 - 2).toFixed(1))
        })
        nodeEls.forEach(function (it) { it.g.setAttribute('transform', 'translate(' + it.n.x.toFixed(1) + ',' + it.n.y.toFixed(1) + ')') })
      }
      redrawPositions()

      let localHoverId = -1
      function getTrace(tid) {
        const pathNodes = {}, pathEdges = {}
        pathNodes[tid] = true
        let cur = tid
        while (inTree[cur] && inTree[cur].parentId >= 0) {
          const p = inTree[cur].parentId
          pathNodes[p] = true; pathEdges[Math.min(cur, p) + '-' + Math.max(cur, p)] = true; cur = p
        }
        const q = [tid]
        while (q.length) {
          const u = q.shift(), inf = inTree[u]
          if (inf) inf.kids.forEach(function (k) { pathNodes[k] = true; pathEdges[Math.min(u, k) + '-' + Math.max(u, k)] = true; q.push(k) })
        }
        gEdges.forEach(function (e) { if (e.a.id === tid) pathNodes[e.b.id] = true; if (e.b.id === tid) pathNodes[e.a.id] = true })
        return { pathNodes: pathNodes, pathEdges: pathEdges }
      }

      function applyVisual() {
        const actId = localHoverId >= 0 ? localHoverId : stateRef.current.selectedId
        const sf = stateRef.current.siteFilter
        const tr = actId >= 0 ? getTrace(actId) : null
        nodeEls.forEach(function (it) {
          let op = 1
          if (tr) op = tr.pathNodes[it.n.id] ? 1 : 0.14
          else if (sf >= 0) op = (it.n.t.dom === sf || it.n.t.ss[sf] >= 0.8) ? 1 : 0.14
          it.g.style.opacity = String(op)
          it.c.setAttribute('stroke-width', it.n.id === actId ? '2.4' : (it.n.depth === 0 ? '2' : it.n.isHub ? '1.4' : '1'))
        })
        edgeEls.forEach(function (it) {
          const e = it.e, ek = Math.min(e.a.id, e.b.id) + '-' + Math.max(e.a.id, e.b.id)
          if (tr) {
            const direct = e.a.id === actId || e.b.id === actId
            if (direct) { it.p.setAttribute('stroke-opacity', '0.9'); it.p.setAttribute('stroke-width', (it.baseSw + 0.6).toFixed(1)); it.lb.setAttribute('opacity', e.co > 0 ? '0.95' : '0') }
            else if (tr.pathEdges[ek]) { it.p.setAttribute('stroke-opacity', '0.62'); it.p.setAttribute('stroke-width', it.baseSw.toFixed(1)); it.lb.setAttribute('opacity', '0') }
            else { it.p.setAttribute('stroke-opacity', '0.05'); it.p.setAttribute('stroke-width', it.baseSw.toFixed(1)); it.lb.setAttribute('opacity', '0') }
          } else if (sf >= 0) {
            const match = e.a.t.dom === sf || e.b.t.dom === sf
            it.p.setAttribute('stroke-opacity', match ? String(it.baseOp) : '0.05'); it.p.setAttribute('stroke-width', it.baseSw.toFixed(1)); it.lb.setAttribute('opacity', '0')
          } else {
            it.p.setAttribute('stroke-opacity', String(it.baseOp)); it.p.setAttribute('stroke-width', it.baseSw.toFixed(1)); it.lb.setAttribute('opacity', '0')
          }
        })
      }
      applyVisual()

      function svgPt(ev) {
        const rect = svg.getBoundingClientRect()
        const sx = (ev.clientX - rect.left) * (KW_TREE_VW / Math.max(1, rect.width))
        const sy = (ev.clientY - rect.top) * (KW_TREE_VH / Math.max(1, rect.height))
        return { x: (sx - tf.x) / tf.k, y: (sy - tf.y) / tf.k, sx: sx, sy: sy }
      }

      let dragNode = null, dragStart = null, moved = false, physRaf = 0, physEnergy = 0
      function stepPhysics() {
        let maxDisp = 0
        for (let ei = 0; ei < backboneEdges.length; ei++) {
          const e = backboneEdges[ei], dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dist = Math.hypot(dx, dy) || 0.01
          const fx = (dx / dist) * (dist - e.restLen) * 0.085, fy = (dy / dist) * (dist - e.restLen) * 0.085
          if (e.a !== dragNode && !e.a.pin) { e.a.vx += fx * 0.45; e.a.vy += fy * 0.45 }
          if (e.b !== dragNode && !e.b.pin) { e.b.vx -= fx * 0.9; e.b.vy -= fy * 0.9 }
        }
        for (let i = 0; i < gNodes.length; i++) {
          const a = gNodes[i]
          for (let j = i + 1; j < gNodes.length; j++) {
            const b = gNodes[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy
            if (d2 > 14400) continue
            const dist = Math.sqrt(d2) || 0.5, rep = (120 - dist) * 0.012, ux = dx / dist, uy = dy / dist
            if (a !== dragNode && !a.pin) { a.vx -= ux * rep; a.vy -= uy * rep }
            if (b !== dragNode && !b.pin) { b.vx += ux * rep; b.vy += uy * rep }
          }
        }
        for (let ei = 0; ei < backboneEdges.length; ei++) {
          const e = backboneEdges[ei], ax = e.a.x, ay = e.a.y, ex = e.b.x - ax, ey = e.b.y - ay, len2 = ex * ex + ey * ey || 1
          for (let ci = 0; ci < gNodes.length; ci++) {
            const c = gNodes[ci]
            if (c === e.a || c === e.b) continue
            const tt = Math.max(0.08, Math.min(0.92, ((c.x - ax) * ex + (c.y - ay) * ey) / len2))
            const dx = c.x - (ax + ex * tt), dy = c.y - (ay + ey * tt), dist = Math.hypot(dx, dy) || 0.01, clear = c.r + 13
            if (dist < clear) {
              const push = (clear - dist) * 0.24, ux = dx / dist, uy = dy / dist
              if (c !== dragNode && !c.pin) { c.vx += ux * push; c.vy += uy * push }
              else {
                if (e.a !== dragNode && !e.a.pin) { e.a.vx -= ux * push * 0.45; e.a.vy -= uy * push * 0.45 }
                if (e.b !== dragNode && !e.b.pin) { e.b.vx -= ux * push * 0.45; e.b.vy -= uy * push * 0.45 }
              }
            }
          }
        }
        for (let ni = 0; ni < gNodes.length; ni++) {
          const n = gNodes[ni]
          if (n === dragNode || n.pin) { n.vx = 0; n.vy = 0; continue }
          n.vx *= 0.72; n.vy *= 0.72
          const spd = Math.hypot(n.vx, n.vy)
          if (spd > 14) { n.vx = (n.vx / spd) * 14; n.vy = (n.vy / spd) * 14 }
          n.x += n.vx; n.y += n.vy
          const pad = n.r + 12
          if (n.x < pad) { n.x = pad; n.vx *= -0.2 } else if (n.x > KW_TREE_VW - pad) { n.x = KW_TREE_VW - pad; n.vx *= -0.2 }
          if (n.y < pad) { n.y = pad; n.vy *= -0.2 } else if (n.y > KW_TREE_VH - pad) { n.y = KW_TREE_VH - pad; n.vy *= -0.2 }
          if (spd > maxDisp) maxDisp = spd
        }
        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i < gNodes.length; i++) {
            const a = gNodes[i]
            for (let j = i + 1; j < gNodes.length; j++) {
              const b = gNodes[j], dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01, minD = a.r + b.r + 9
              if (dist < minD) {
                const ovl = minD - dist, ux = dx / dist, uy = dy / dist, aFix = a === dragNode || a.pin, bFix = b === dragNode || b.pin
                if (aFix && !bFix) { b.x += ux * ovl; b.y += uy * ovl; maxDisp = Math.max(maxDisp, ovl) }
                else if (bFix && !aFix) { a.x -= ux * ovl; a.y -= uy * ovl; maxDisp = Math.max(maxDisp, ovl) }
                else if (!aFix && !bFix) { a.x -= ux * ovl * 0.5; a.y -= uy * ovl * 0.5; b.x += ux * ovl * 0.5; b.y += uy * ovl * 0.5; maxDisp = Math.max(maxDisp, ovl * 0.5) }
              }
            }
          }
        }
        redrawPositions()
        physEnergy = dragNode ? 1 : Math.max(maxDisp, physEnergy * 0.92)
        if ((dragNode || physEnergy > 0.08) && typeof requestAnimationFrame === 'function') physRaf = requestAnimationFrame(stepPhysics)
        else physRaf = 0
      }
      function wakePhysics() { physEnergy = 1; if (!physRaf && typeof requestAnimationFrame === 'function') physRaf = requestAnimationFrame(stepPhysics) }

      nodeEls.forEach(function (it) {
        const n = it.n, g = it.g
        g.addEventListener('mouseenter', function () { if (dragNode) return; localHoverId = n.id; applyVisual(); cbs.onHover(n.id) })
        g.addEventListener('mouseleave', function () { if (dragNode) return; localHoverId = -1; applyVisual(); cbs.onHover(-1) })
        g.addEventListener('pointerdown', function (ev) {
          ev.stopPropagation(); dragNode = n; dragStart = { cx: ev.clientX, cy: ev.clientY }; moved = false
          if (g.setPointerCapture) { try { g.setPointerCapture(ev.pointerId) } catch (e) {} }
        })
        g.addEventListener('pointermove', function (ev) {
          if (dragNode !== n) return
          if (Math.hypot(ev.clientX - dragStart.cx, ev.clientY - dragStart.cy) > 4) moved = true
          if (!moved) return
          const pt = svgPt(ev)
          n.x = Math.max(n.r + 14, Math.min(KW_TREE_VW - n.r - 14, pt.x))
          n.y = Math.max(n.r + 14, Math.min(KW_TREE_VH - n.r - 14, pt.y))
          wakePhysics()
        })
        g.addEventListener('pointerup', function () {
          if (dragNode !== n) return
          const wasMoved = moved; dragNode = null
          if (wasMoved) wakePhysics()
          else {
            const nextSel = stateRef.current.selectedId === n.id ? -1 : n.id
            stateRef.current.selectedId = nextSel
            cbs.onSelect(nextSel); applyVisual()
          }
        })
        g.addEventListener('dblclick', function (ev) { ev.stopPropagation(); cbs.onReroot(n.t.k) })
      })

      let panning = false, panStart = null, panMoved = false
      const onDown = function (ev) {
        if (dragNode) return
        panning = true; panMoved = false; panStart = { x: ev.clientX, y: ev.clientY, tx: tf.x, ty: tf.y }
        svg.style.cursor = 'grabbing'
        if (svg.setPointerCapture) { try { svg.setPointerCapture(ev.pointerId) } catch (e) {} }
      }
      const onMove = function (ev) {
        if (!panning) return
        if (Math.hypot(ev.clientX - panStart.x, ev.clientY - panStart.y) > 4) panMoved = true
        const rect = svg.getBoundingClientRect()
        tf.x = panStart.tx + (ev.clientX - panStart.x) * (KW_TREE_VW / Math.max(1, rect.width))
        tf.y = panStart.ty + (ev.clientY - panStart.y) * (KW_TREE_VH / Math.max(1, rect.height))
        applyTf()
      }
      const onUp = function () {
        if (!panning) return
        panning = false; svg.style.cursor = 'grab'
        if (!panMoved && stateRef.current.selectedId >= 0) { stateRef.current.selectedId = -1; cbs.onSelect(-1); applyVisual() }
      }
      const onCancel = function () { panning = false; svg.style.cursor = 'grab' }
      const onWheel = function (ev) {
        ev.preventDefault()
        const pt = svgPt(ev), nk = Math.max(0.65, Math.min(3.0, tf.k * (ev.deltaY < 0 ? 1.13 : 0.88)))
        tf.x = pt.sx - pt.x * nk; tf.y = pt.sy - pt.y * nk; tf.k = nk; applyTf()
      }
      svg.addEventListener('pointerdown', onDown); svg.addEventListener('pointermove', onMove)
      svg.addEventListener('pointerup', onUp); svg.addEventListener('pointercancel', onCancel)
      svg.addEventListener('wheel', onWheel, { passive: false })

      return {
        sync: applyVisual,
        destroy: function () {
          if (physRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(physRaf)
          svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove)
          svg.removeEventListener('pointerup', onUp); svg.removeEventListener('pointercancel', onCancel)
          svg.removeEventListener('wheel', onWheel)
          if (vp.parentNode === svg) svg.removeChild(vp)
        },
      }
    }
