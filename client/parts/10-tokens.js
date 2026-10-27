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
      sp: [0, 4, 8, 12, 16],
      fs: { s: '12px', m: '13px', l: '15px' },
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
      if (document.getElementById('rank-scan-style')) return
      const el = document.createElement('style')
      el.id = 'rank-scan-style'
      el.textContent = [
        '.rs-btn{padding:4px 10px;font-size:' + T.fs.s + ';border-radius:' + T.r.s + ';border:1px solid ' + T.border + ';background:transparent;color:inherit;cursor:pointer;line-height:1.4;font-family:inherit}',
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
      ].join('\n')
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
      row: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', margin: '5px 0' },
      tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid ' + T.border, marginBottom: '6px' },
      tab: (on) => ({ padding: '3px 9px', cursor: 'pointer', border: 'none', background: 'transparent',
        color: on ? T.fg : T.muted,
        borderBottom: '2px solid ' + (on ? T.accent : 'transparent'), fontWeight: on ? 600 : 400 }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: T.fs.m },
      th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', fontWeight: 600, position: 'sticky', top: 0, zIndex: 3, background: T.surface },
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
      detail: { marginTop: '6px', padding: '6px 8px', border: '1px solid ' + T.border, borderRadius: '8px', background: T.subtle },
      // 书签（用户数据）：星标按钮与卡片
      bmOn: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', color: T.warn, fontSize: T.fs.m, lineHeight: 1 },
      bmOff: { padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', opacity: 0.32, fontSize: T.fs.m, lineHeight: 1 },
      card: { margin: '7px 0', padding: '7px 9px', border: '1px solid ' + T.border, borderRadius: '8px', background: T.subtle },
      cardTitle: { fontWeight: 600, fontSize: T.fs.m },
      chip: { display: 'inline-block', marginRight: '4px', padding: '0 5px', borderRadius: '8px', background: T.subtle, fontSize: T.fs.s },
      input: { padding: '3px 6px', fontSize: T.fs.s, borderRadius: T.r.s, border: '1px solid ' + T.border, background: 'transparent', color: 'inherit' },
    }
    /** 统一提示条：三种语气只差颜色，形状一致；错误用 role=alert 让读屏器打断 */
