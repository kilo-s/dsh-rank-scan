/**
 * 10-tokens.js：设计令牌 T/C、主题变量、wash 与 ensureStyle 样式注入。依赖 00。不要放业务组件。
 * 这个文件是同一闭包里的连续片段；顶层执行顺序由文件名排序保证。
 */
    const T = {
      surface: 'var(--dsw-alias-bg-layer-1, var(--dsh-surface, #fff))',
      surface2: 'var(--dsw-alias-bg-layer-2, var(--dsh-fill, rgba(128,128,128,.06)))',
      fg: 'var(--dsw-alias-label-primary, var(--dsh-text, currentColor))',
      muted: 'var(--dsw-alias-label-secondary, var(--dsh-text-secondary, rgba(128,128,128,.9)))',
      border: 'var(--dsw-alias-border-l3, var(--dsh-border, rgba(128,128,128,.28)))',
      subtle: 'var(--dsw-alias-interactive-bg-hover, var(--dsh-fill, rgba(128,128,128,.07)))',
      accent: 'var(--dsw-alias-state-business-primary, var(--dsh-accent, #2f6feb))',
      onAccent: 'var(--dsw-alias-label-primary-foreground, #fff)',
      primary: 'var(--dsw-alias-button-primary-fill, #2f6feb)',
      onPrimary: 'var(--dsw-alias-label-primary-foreground, #fff)',
      ok: 'var(--dsw-alias-state-success-primary, #2e9e5b)',
      warn: 'var(--dsw-alias-state-warn-primary, #c98a1a)',
      bad: 'var(--dsw-alias-state-error-primary, #d6453d)',
      // 涨跌口径沿用现有行为：名次前进（好）= 绿，后退（坏）= 红；箭头符号仍在，不靠颜色单打
      up: 'var(--dsw-alias-state-success-primary, #2e9e5b)',
      down: 'var(--dsw-alias-state-error-primary, #d6453d)',
      // 站点统一克制色板（跨浅/暗主题可读，用于关键词图谱、词云与多书曲线标识）
      siteFanqie: 'var(--dsw-alias-state-error-primary, #d6453d)',
      siteQidian: 'var(--dsw-alias-state-business-primary, #2f6feb)',
      siteCiweimao: 'var(--dsw-alias-state-success-primary, #2e9e5b)',
      siteSfacg: '#8b6bb1',
      // 多曲线克制循环色板（仅 6 色，避免高饱和彩虹噪点）
      chart0: 'var(--dsw-alias-state-business-primary, #2f6feb)',
      chart1: 'var(--dsw-alias-state-error-primary, #d6453d)',
      chart2: 'var(--dsw-alias-state-success-primary, #2e9e5b)',
      chart3: '#8b6bb1',
      chart4: 'var(--dsw-alias-state-warn-primary, #c98a1a)',
      chart5: '#5b7083',
      sp: [0, 4, 8, 12, 16],
      fs: { xs: '11px', s: '12px', m: '13px', l: '15px' },
      r: { s: '6px', m: '10px' },
      shadowWin: '0 10px 30px rgba(0,0,0,.20)',
      shadowMenu: '0 8px 20px rgba(0,0,0,.18)',
      shadowBar: '0 -8px 12px -8px rgba(0,0,0,.28)',
    }
    /** 语义色低透明度底：用于提示条/未保存条（color-mix 不可用时退化为透明，不影响可读性） */
    const wash = function (color, pct) { return 'color-mix(in srgb, ' + color + ' ' + pct + '%, transparent)' }
    /**
     * 作用域样式表：内联 style 写不了 :hover / :focus-visible / :disabled，
     * 按钮与提示条改用 rs- 前缀的 class。只注入一次；选择器全部带前缀，不污染宿主。
     */
    const ensureStyle = function () {
      if (typeof document === 'undefined' || !document.head) return
      // 测试/受限环境可能只有半截 document：缺 DOM API 就静默跳过，不影响功能
      if (typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return
      if (typeof document.head.appendChild !== 'function') return
      const css = [
        '.rs-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;font-size:' + T.fs.s + ';border-radius:' + T.r.s + ';border:1px solid ' + T.border + ';background:transparent;color:inherit;cursor:pointer;line-height:1.4;font-family:inherit}',
        '.rs-btn:hover:not(:disabled){background:' + T.subtle + '}',
        '.rs-btn:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '[data-rank-scan-win] button:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '.rs-btn:disabled{opacity:.45;cursor:not-allowed}',
        '.rs-btn.is-primary{background:' + T.primary + ';border-color:' + T.primary + ';color:' + T.onPrimary + ';font-weight:600}',
        '.rs-btn.is-primary:hover:not(:disabled){background:' + T.primary + ';opacity:.88}',
        '.rs-btn.is-ghost{border-color:transparent}',
        '.rs-btn.is-danger{color:' + T.bad + ';border-color:' + T.bad + '}',
        '.rs-btn.is-on{background:' + T.subtle + ';font-weight:600}',
        '.rs-menu-item{text-align:left;width:100%;border-color:transparent;background:transparent}',
        '.rs-section-toggle{border:none;background:transparent;padding:0;font-weight:600;font-size:' + T.fs.m + ';width:100%;text-align:left;cursor:pointer;color:inherit;font-family:inherit}',
        '.rs-section-toggle:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:2px}',
        '.rs-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;padding:8px 10px;border-radius:' + T.r.s + ';border:1px solid;border-left-width:3px;color:inherit}',
        '.rs-banner.is-info{border-color:' + T.accent + ';background:' + wash(T.accent, 8) + '}',
        '.rs-banner.is-warn{border-color:' + T.warn + ';background:' + wash(T.warn, 10) + '}',
        '.rs-banner.is-error{border-color:' + T.bad + ';background:' + wash(T.bad, 8) + '}',
        '.rs-banner .rs-banner-body{flex:1 1 100%;min-width:0}',
        '.rs-toasts{position:absolute;right:12px;top:64px;bottom:auto;z-index:95;display:flex;flex-direction:column;gap:6px;max-width:min(380px,calc(100% - 24px));max-height:calc(100% - 80px);overflow:auto;pointer-events:none}',
        '.rs-statcard:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '.rs-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:' + T.r.s + ';border:1px solid;border-left-width:3px;background:' + T.surface + ';color:' + T.fg + ';box-shadow:' + T.shadowMenu + ';font-size:' + T.fs.s + ';line-height:1.45}',
        '.rs-toast.is-info{border-color:' + T.accent + ';background-image:linear-gradient(' + wash(T.accent, 10) + ',' + wash(T.accent, 10) + ')}',
        '.rs-toast.is-warn{border-color:' + T.warn + ';background-image:linear-gradient(' + wash(T.warn, 12) + ',' + wash(T.warn, 12) + ')}',
        '.rs-toast.is-error{border-color:' + T.bad + ';background-image:linear-gradient(' + wash(T.bad, 10) + ',' + wash(T.bad, 10) + ')}',
        '.rs-toast.is-success{border-color:' + T.ok + ';background-image:linear-gradient(' + wash(T.ok, 10) + ',' + wash(T.ok, 10) + ')}',
        '.rs-toast-text{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word}',
        '.rs-toast-x{border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;font-family:inherit}',
        '.rs-toast-x:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '[data-rank-scan-win] tbody tr:hover td{background:' + T.subtle + '}',
        '[data-rank-scan-win] a:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        // A1：链接默认不画下划线（面板里链接多半是「打开」，满屏下划线很吵）；hover / focus-visible 才出现
        '[data-rank-scan-win] a{text-decoration:none}',
        '[data-rank-scan-win] a:hover,[data-rank-scan-win] a:focus-visible{text-decoration:underline;text-underline-offset:2px}',
        // A1：文字动作（「新标签打开」这类）保留下划线，用这个 class 与普通链接区分
        '.rs-link-action{text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
        // A1 例外：备注文字是可点文本，但不该长得像链接——常规字重 + 正文色，只有 hover / focus-visible 才出下划线
        // 注意：不可直接把 display:-webkit-box 挂在 <button> 上（Chromium 下会导致多行文字居中），由内层 .rs-note-clamp 负责两行截断
        '.rs-note-text{border:none;background:transparent;padding:0;cursor:pointer;font:inherit;font-weight:400;text-decoration:none;color:' + T.fg + ';margin:0;display:block;width:100%;text-align:left;line-height:1.6;word-break:break-word;appearance:none;-webkit-appearance:none}',
        '.rs-note-text:hover,.rs-note-text:focus-visible{text-decoration:underline;text-underline-offset:2px}',
        '.rs-note-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;text-align:left}',
        '.rs-note-full{display:block;width:100%;white-space:pre-wrap;word-break:break-word;text-align:left;line-height:1.68}',
        // 书签卡片（参考 DaoSearch 作品页：左对齐、清晰留白、展开态就地呈现数据/上榜/完整笔记不重复）
        '.rs-bm-card{text-align:left;transition:background .12s ease,border-color .12s ease}',
        '.rs-bm-card:hover{background:' + T.subtle + '}',
        '.rs-bm-card.is-open{background:' + T.surface + ';border-color:' + wash(T.accent, 48) + ';box-shadow:inset 3px 0 0 ' + T.accent + '}',
        '.rs-bm-card.is-open:hover{background:' + T.surface + '}',
        '.rs-bm-title{color:' + T.fg + ';font-size:14px;font-weight:600;line-height:1.35}',
        '.rs-bm-honour{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 9px 2px 4px;border-radius:999px;background:' + T.surface2 + ';border:1px solid ' + wash(T.border, 65) + ';font-size:' + T.fs.s + ';line-height:1.35;color:' + T.fg + '}',
        '.rs-bm-rank{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;font-size:' + T.fs.xs + ';font-weight:600;font-variant-numeric:tabular-nums;flex:0 0 auto;background:' + T.subtle + ';color:' + T.fg + '}',
        '.rs-bm-rank.is-first{background:' + wash(T.warn, 22) + ';color:' + T.warn + '}',
        '.rs-bm-rank.is-top{background:' + wash(T.accent, 18) + ';color:' + T.accent + '}',
        '.rs-bm-honour-meta{color:' + T.muted + ';font-size:' + T.fs.xs + ';white-space:nowrap}',
        '.rs-bm-tags{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:6px}',
        '.rs-bd-kv{display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;align-items:start}',
        '.rs-bd-kv-label{font-size:' + T.fs.xs + ';font-weight:500;color:' + T.muted + ';line-height:22px;user-select:none}',
        '.rs-bd-tag{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;background:' + wash(T.fg, 6) + ';font-size:' + T.fs.xs + ';color:' + T.muted + ';line-height:1.55}',
        '.rs-bd-honour{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 7px 2px 3px;border-radius:' + T.r.s + ';background:' + wash(T.surface, 78) + ';border:1px solid ' + wash(T.border, 48) + ';font-size:' + T.fs.xs + ';line-height:1.35;color:' + T.fg + '}',
        '.rs-bd-rank{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 4px;border-radius:4px;font-size:' + T.fs.xs + ';font-weight:600;font-variant-numeric:tabular-nums;flex:0 0 auto;background:' + wash(T.fg, 7) + ';color:' + T.fg + '}',
        '.rs-bd-rank.is-first{background:' + wash(T.warn, 18) + ';color:' + T.warn + '}',
        '.rs-bd-rank.is-top{background:' + wash(T.accent, 15) + ';color:' + T.accent + '}',
        // 概览新版：四平台活卡片、视角分段器、单书走势与微榜胶囊（全部走设计令牌）
        '.rs-ov-card{background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:9px;display:flex;flex-direction:column;min-width:0;transition:border-color .12s ease}',
        '.rs-ov-card:hover{border-color:' + wash(T.fg, 26) + '}',
        '.rs-ov-row{border-radius:5px;cursor:pointer;transition:background .1s ease}',
        '.rs-ov-row:hover{background:' + T.subtle + '}',
        '.rs-ov-row:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:-2px}',
        '[data-rank-scan-win] .rs-ov-row .rs-star.is-off{opacity:0}',
        '[data-rank-scan-win] .rs-ov-row:hover .rs-star.is-off,[data-rank-scan-win] .rs-ov-row:focus-within .rs-star.is-off{opacity:.42}',
        '@media (hover:none){[data-rank-scan-win] .rs-ov-row .rs-star.is-off{opacity:.32}}',
        '.rs-ov-seg{display:inline-flex;flex-wrap:wrap;gap:1px;padding:2px;border-radius:7px;background:' + wash(T.fg, 5) + ';border:1px solid ' + wash(T.border, 55) + '}',
        '.rs-ov-seg-btn{border:none;background:transparent;padding:2px 8px;border-radius:5px;font-size:' + T.fs.s + ';color:' + T.muted + ';cursor:pointer;font-family:inherit;line-height:1.45;white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.rs-ov-seg-btn:hover{color:' + T.fg + '}',
        '.rs-ov-seg-btn.is-on{background:' + T.surface + ';color:' + T.fg + ';font-weight:600}',
        '.rs-ov-bchip{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;font-size:' + T.fs.xs + ';background:' + wash(T.fg, 5) + ';color:' + T.muted + ';border:none;cursor:pointer;font-family:inherit;line-height:1.55;white-space:nowrap}',
        '.rs-ov-bchip:hover{background:' + wash(T.fg, 10) + ';color:' + T.fg + '}',
        '.rs-ov-rank{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:17px;padding:0 4px;border-radius:4px;font-size:' + T.fs.xs + ';font-weight:600;font-variant-numeric:tabular-nums;flex:0 0 auto;background:' + wash(T.fg, 7) + ';color:' + T.fg + '}',
        '.rs-ov-rank.is-first{background:' + wash(T.warn, 18) + ';color:' + T.warn + '}',
        '.rs-ov-rank.is-top{background:' + wash(T.accent, 15) + ';color:' + T.accent + '}',
        '.rs-ov-rank.is-out{background:' + wash(T.bad, 11) + ';color:' + T.bad + ';font-weight:500}',
        '.rs-ov-delta{display:inline-flex;align-items:center;padding:0 5px;height:17px;border-radius:4px;font-size:' + T.fs.xs + ';font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto}',
        '.rs-ov-delta.is-new{background:' + wash(T.fg, 7) + ';color:' + T.fg + '}',
        '.rs-ov-delta.is-up{color:' + T.up + '}',
        '.rs-ov-delta.is-down{color:' + T.down + '}',
        '.rs-ov-delta.is-out{background:' + wash(T.bad, 10) + ';color:' + T.bad + '}',
        '.rs-ov-delta.is-muted{color:' + T.muted + '}',
        // 概览自由画布与分析卡片（拖拽壳、周榜竞速目录、曲线工具条、关键词骨架树/词云）
        '.rs-ov-shell{background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:9px;display:flex;flex-direction:column;min-width:0;transition:border-color .14s ease,box-shadow .14s ease,opacity .14s ease}',
        '.rs-ov-shell:hover{border-color:' + wash(T.fg, 24) + '}',
        '.rs-ov-shell.is-dragging{opacity:.55;border-color:' + T.accent + '}',
        '.rs-ov-shell.is-drop{border-color:' + T.accent + ';box-shadow:inset 0 0 0 1px ' + T.accent + '}',
        '.rs-ov-shell-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;padding:6px 10px;border-bottom:1px solid ' + wash(T.border, 55) + ';user-select:none}',
        '.rs-ov-grip{display:inline-flex;align-items:center;justify-content:center;width:18px;height:20px;border-radius:4px;color:' + T.muted + ';cursor:grab;font-size:12px;line-height:1;flex:0 0 auto}',
        '.rs-ov-grip:hover{background:' + T.subtle + ';color:' + T.fg + '}',
        '.rs-ov-grip:active{cursor:grabbing}',
        '.rs-ov-iconbtn{border:none;background:transparent;color:' + T.muted + ';cursor:pointer;height:20px;padding:0 5px;border-radius:4px;font-size:' + T.fs.xs + ';font-family:inherit;line-height:1;display:inline-flex;align-items:center;gap:2px}',
        '.rs-ov-iconbtn:hover{background:' + T.subtle + ';color:' + T.fg + '}',
        '.rs-ov-iconbtn:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '.rs-ov-chip{display:inline-flex;align-items:center;gap:4px;padding:0 7px;height:24px;box-sizing:border-box;border-radius:5px;font-size:' + T.fs.xs + ';border:1px solid transparent;background:' + wash(T.fg, 5) + ';color:' + T.muted + ';cursor:pointer;font-family:inherit;white-space:nowrap;line-height:1}',
        '.rs-ov-chip:hover{background:' + wash(T.fg, 9) + ';color:' + T.fg + '}',
        '.rs-ov-chip.is-on{background:' + wash(T.accent, 14) + ';border-color:' + wash(T.accent, 42) + ';color:' + T.accent + ';font-weight:600}',
        '.rs-ov-chip-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin:-2px -4px -2px 0;padding:0;border:none;border-radius:4px;background:transparent;color:' + T.muted + ';cursor:pointer;font-size:12px;line-height:1;font-family:inherit;flex:0 0 auto}',
        '.rs-ov-chip-x:hover{background:' + wash(T.fg, 12) + ';color:' + T.fg + '}',
        '.rs-ov-chip-x:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        '.rs-ov-sdot{display:inline-flex;align-items:center;gap:4px;padding:0 6px;height:24px;box-sizing:border-box;border-radius:5px;font-size:' + T.fs.xs + ';border:1px solid transparent;background:transparent;color:' + T.muted + ';cursor:pointer;font-family:inherit;white-space:nowrap;line-height:1}',
        '.rs-ov-sdot:hover{background:' + wash(T.fg, 6) + ';color:' + T.fg + '}',
        '.rs-ov-sdot.is-on{border-color:currentColor;background:' + wash(T.fg, 6) + ';font-weight:600}',
        '.rs-ov-shell .rs-ov-seg{padding:2px;height:24px;box-sizing:border-box;align-items:center}',
        '.rs-ov-shell .rs-ov-seg-btn{padding:0 7px;height:18px;font-size:' + T.fs.xs + ';display:inline-flex;align-items:center;line-height:1}',
        '.rs-ov-dir-row{display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:5px;cursor:pointer;min-width:0;font-size:' + T.fs.xs + ';transition:background .1s ease}',
        '.rs-ov-dir-row:hover{background:' + T.subtle + '}',
        '.rs-ov-dir-row.is-pin{background:' + wash(T.fg, 5) + '}',
        '.rs-ov-dir-row.is-sel{background:' + wash(T.accent, 8) + '}',
        '.rs-ov-dir-row.is-sel:hover{background:' + wash(T.accent, 14) + '}',
        '.rs-ov-popover{position:absolute;right:0;top:100%;margin-top:4px;z-index:45;min-width:250px;background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:8px;box-shadow:' + T.shadowMenu + ';padding:8px;display:flex;flex-direction:column;gap:4px}',
        '.rs-kw-node{cursor:grab;transition:opacity .15s ease}',
        '.rs-kw-node:active{cursor:grabbing}',
        '.rs-kw-edge{transition:stroke-opacity .15s ease,stroke-width .15s ease}',
        '.rs-kw-word{cursor:pointer;transition:opacity .12s ease}',
        // A7：输入框 / 下拉框统一 28px，与 .rs-btn 同高（内联 C.input 也走同一数值）
        '.rs-input{height:28px;box-sizing:border-box;padding:0 6px;line-height:1.4}',
        '.rs-th-sort{border:none;background:transparent;padding:0;font:inherit;font-weight:600;cursor:pointer;color:inherit;display:inline-flex;align-items:center;gap:3px}',
        '.rs-th-sort:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:1px}',
        // B1：数字列表头也右对齐（排序按钮铺满 th 并靠右，箭头在文字左侧）
        '.rs-th-sort.is-num{width:100%;justify-content:flex-end}',
        // B3：星标——已收藏常显；未收藏只在行 hover / 行内 focus / 行已展开时出现（暗色下不再是一排灰点）
        '.rs-star.is-off{opacity:.32}',
        '[data-rank-scan-win] tbody tr .rs-star.is-off{opacity:0}',
        '[data-rank-scan-win] tbody tr:hover .rs-star.is-off{opacity:.32}',
        '[data-rank-scan-win] tbody tr:focus-within .rs-star.is-off{opacity:.32}',
        '[data-rank-scan-win] tr[aria-expanded="true"] .rs-star.is-off{opacity:.32}',
        '@media (hover:none){[data-rank-scan-win] tbody tr .rs-star.is-off{opacity:.32}}',
        '.rs-sort-arrow{opacity:0;color:' + T.muted + ';font-size:10px;line-height:1}',
        '.rs-th-sort:hover .rs-sort-arrow,.rs-th-sort:focus-visible .rs-sort-arrow{opacity:1}',
        '.rs-sort-arrow.is-on{opacity:1;color:' + T.accent + ';font-weight:600}',
        '[data-rank-scan-win] [data-row-idx]:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:-2px}',
      ].join('\n')
      const prev = document.getElementById('rank-scan-style')
      if (prev) {
        if (prev.textContent !== css) prev.textContent = css
        return
      }
      const el = document.createElement('style')
      el.id = 'rank-scan-style'
      el.textContent = css
      document.head.appendChild(el)
    }
    const C = {
      win: { position: 'fixed', zIndex: 60, background: T.surface, color: T.fg,
        border: '1px solid ' + T.border, borderRadius: T.r.m,
        boxShadow: T.shadowWin, fontSize: T.fs.m, lineHeight: 1.5,
        display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      titlebar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px 6px 10px',
        borderBottom: '1px solid ' + T.border, cursor: 'move', userSelect: 'none', background: T.subtle },
      title: { fontWeight: 600, fontSize: T.fs.m, marginRight: '2px' },
      body: { padding: '12px', overflow: 'auto', flex: '1 1 auto' },
      // A5 间距节奏：组内 4、行间 8（上下各 4 相加）、分区间 16（见 C.section）
      row: { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', margin: '4px 0' },
      tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid ' + T.border, marginBottom: '6px' },
      tab: (on) => ({ padding: '3px 9px', cursor: 'pointer', border: 'none', background: 'transparent',
        color: on ? T.fg : T.muted,
        borderBottom: '2px solid ' + (on ? T.accent : 'transparent'), fontWeight: on ? 600 : 400 }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: T.fs.m },
      th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', fontWeight: 600, position: 'sticky', top: 0, zIndex: 3, background: T.surface, boxShadow: '0 -12px 0 ' + T.surface },
      td: { padding: '6px 8px', borderBottom: '1px solid ' + wash(T.border, 50), verticalAlign: 'top' },
      /**
       * ★ 2026-10-17（易用性 P0）：数字列以前会折行（「退 1」被拆成两行、20 个榜的表拉高一倍）。
       *   num 给数字列用（不折行 + 等宽数字，扫一眼就能对齐比大小）。
       */
      num: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      /* 涨跌配色：绿涨红跌，与 dot('ok'/'bad') 同一套语义；符号仍然保留，不靠颜色单打 */
      up: { color: T.up, whiteSpace: 'nowrap' },
      down: { color: T.down, whiteSpace: 'nowrap' },
      /* 长榜名单行省略（全名放 title 里）——避免「签约榜 × 轻小说（移动端口径）」撑成两行 */
      ellip: { display: 'inline-block', maxWidth: '232px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' },
      muted: { color: T.muted, fontSize: T.fs.s },
      siteBar: { marginTop: '8px', fontWeight: 600, fontSize: T.fs.m, display: 'flex', gap: '6px', alignItems: 'center' },
      dot: (tone) => ({ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
        background: tone === 'bad' ? T.bad : tone === 'warn' ? T.warn : T.ok }),
      handle: { position: 'absolute', right: '0', bottom: '0', width: '16px', height: '16px', cursor: 'nwse-resize',
        background: 'linear-gradient(135deg, transparent 46%, ' + T.muted + ' 46%, ' + T.muted + ' 54%, transparent 54%, transparent 70%, ' + T.muted + ' 70%, ' + T.muted + ' 78%, transparent 78%)' },
      /** A2：详情不再画整圈边框（盒子套盒子），只用浅底 + 左侧 accent 色条表示「这是展开区」 */
      detail: { marginTop: '6px', padding: '6px 8px 6px 10px', border: 'none', borderLeft: '2px solid ' + T.accent, borderRadius: T.r.s, background: T.subtle },
      // 书签（用户数据）：星标按钮与卡片
      bmOn: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', color: T.warn, fontSize: T.fs.m, lineHeight: 1 },
      /** 未收藏：透明度交给样式表（B3：只在行 hover / 行内 focus / 已展开时露出），这里不再写死 */
      bmOff: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: T.fs.m, lineHeight: 1 },
      /** A2：卡片只留 1px 边框、去掉底色（与详情同底色叠加时像一堆小盒子） */
      card: { margin: '7px 0', padding: '7px 9px', border: '1px solid ' + T.border, borderRadius: '8px' },
      cardTitle: { fontWeight: 600, fontSize: T.fs.m },
      /** 圆形小标签：★ 只留给状态类（待补 / 超 7 天 / 站点）与 #标签 / 夹；普通元信息走 C.meta */
      chip: { display: 'inline-block', marginRight: '4px', padding: '0 5px', borderRadius: '8px', background: T.subtle, fontSize: T.fs.s },
      /** A3：普通元信息——无背景、12px muted，用中点串联（例：「字数 17.4万字 · 收藏 141,159」） */
      meta: { fontSize: T.fs.s, color: T.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      /** A4：三层字号——分区标题 12/600 muted、条目标题 13/500、元信息 12 muted */
      sectionLabel: { fontSize: T.fs.s, fontWeight: 600, color: T.muted },
      itemTitle: { fontSize: T.fs.m, fontWeight: 500 },
      /** A5：分区之间留 16px */
      section: { marginTop: '16px' },
      /** A7：高度与 .rs-btn 对齐为 28px（textarea 需要自己覆盖成 height:auto） */
      input: { height: '28px', boxSizing: 'border-box', padding: '0 6px', fontSize: T.fs.s, borderRadius: T.r.s, border: '1px solid ' + T.border, background: 'transparent', color: 'inherit' },
    }
    /**
     * 元信息分隔中点（A3 / 0.6.0 修）：必须是「 · 」并且两边留 4px。
     *   ★ 不能靠空格：meta 行是 flex 容器，每个子节点的首尾空格会被行盒裁掉，
     *     于是截图里出现「在读 676,671·截止」这种粘在一起的字符串。
     *   中点用 T.muted（不抢元信息本身的颜色）。
     */
    const metaDot = function (key) {
      return h('span', { key: key, style: { color: T.muted, margin: '0 4px' }, 'aria-hidden': 'true' }, '·')
    }
    /** 统一提示条：三种语气只差颜色，形状一致；错误用 role=alert 让读屏器打断 */
