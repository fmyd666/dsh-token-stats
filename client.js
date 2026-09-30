/**
 * Token Stats — client half.
 *
 * Renders one ambient entry in `conversation.composer.dock`, beside the shipped
 * statistics pills, showing this session's cumulative Token usage, cache-hit
 * share, and context occupancy. Every figure comes from durable session
 * projections (`tokenUsage`, `contextPressure`, `contextBreakdown`,
 * `sessionStats`) read through the slot's `useProjection` seat, so nothing is
 * folded or polled here.
 */
window.__ModuleLoader__.load({
  id: '@local/token-stats',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'tokenStats';

    const zh = {
      'pill.title': 'Token 统计',
      'pill.cacheHit': '缓存 {percent}%',
      'pill.context': '上下文 {percent}%',
      'panel.aria': 'Token 统计详情',
      'panel.usageTitle': 'Token 用量',
      'panel.contextTitle': '上下文占用',
      'panel.total': '总计',
      'panel.input': '输入',
      'panel.cacheHit': '缓存命中',
      'panel.cacheRead': '缓存读取',
      'panel.cacheWrite': '缓存写入',
      'panel.output': '输出',
      'panel.contextUsed': '已用 / 容量',
      'panel.system': '系统提示词',
      'panel.tools': '工具定义',
      'panel.messages': '对话消息',
      'panel.turns': '轮次 / 步骤',
      'panel.empty': '暂无用量数据',
      'number.billion': '{value}B',
    };

    const en = {
      'pill.title': 'Token stats',
      'pill.cacheHit': '{percent}% cached',
      'pill.context': '{percent}% context',
      'panel.aria': 'Token statistics details',
      'panel.usageTitle': 'Token usage',
      'panel.contextTitle': 'Context occupancy',
      'panel.total': 'Total',
      'panel.input': 'Input',
      'panel.cacheHit': 'Cache hit',
      'panel.cacheRead': 'Cache read',
      'panel.cacheWrite': 'Cache write',
      'panel.output': 'Output',
      'panel.contextUsed': 'Used / capacity',
      'panel.system': 'System prompt',
      'panel.tools': 'Tool schemas',
      'panel.messages': 'Conversation',
      'panel.turns': 'Turns / steps',
      'panel.empty': 'No usage recorded yet',
      'number.billion': '{value}B',
    };

    /** Fallback translate seat for assemblies without the locale plugin. */
    const fallbackT = (key, params) => {
      const template = en[key] ?? key;
      if (params === undefined) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
      );
    };

    const CSS = [
      '.tks-root{box-sizing:border-box;min-width:0;max-width:100%;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:flex;justify-content:center}',
      '.tks-pill{box-sizing:border-box;max-width:100%;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:none;border-radius:999px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer}',
      '.tks-pill:hover,.tks-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.tks-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.tks-pill svg{flex:none;width:14px;height:14px}',
      '.tks-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tks-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
      '.tks-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:default}',
      '.tks-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.tks-titleLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.tks-titleLabel svg{flex:none;width:14px;height:14px}',
      '.tks-titleValue{font-variant-numeric:tabular-nums}',
      '.tks-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.tks-section{margin:12px 0 8px;color:var(--dsw-alias-label-tertiary)}',
      '.tks-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0}',
      '.tks-details dt,.tks-details dd{min-width:0;margin:0}',
      '.tks-details dt{color:var(--dsw-alias-label-tertiary)}',
      '.tks-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.tks-bar{display:flex;height:6px;margin-bottom:10px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
      '.tks-seg{height:100%}',
      '.tks-seg-system{background:var(--dsw-alias-brand-primary)}',
      '.tks-seg-tools{background:var(--dsw-alias-state-warn-primary)}',
      '.tks-seg-messages{background:var(--dsw-alias-state-success-primary)}',
    ].join('');

    /**
     * One decimal place below 100, whole numbers from there up.
     * @param candidate - the scaled magnitude.
     * @returns display-ready number text.
     */
    function scaledUnits(candidate) {
      return candidate >= 100
        ? String(Math.round(candidate))
        : String(Math.round(candidate * 10) / 10);
    }

    /**
     * Compact token count in K / M / B units.
     *
     * The unit is promoted when rounding would otherwise print a value at or
     * past the next threshold, so 999,999 reads `1M` rather than `1000K`. Each
     * template is resolved defensively: a translate seat that cannot answer a
     * key returns the key itself, so an unresolved template falls back to the
     * plain suffix instead of leaking a key name into the figure.
     * @param value - token count.
     * @param t - locale seat.
     * @returns compact display string.
     */
    function formatCompact(value, t) {
      const rounded = Math.max(0, Math.round(value));
      if (rounded < 1e3) return String(rounded);
      const units = [
        ['number.thousand', 'K'],
        ['number.million', 'M'],
        ['number.billion', 'B'],
      ];
      let index = 0;
      let magnitude = rounded / 1e3;
      while (magnitude >= 999.5 && index < units.length - 1) {
        magnitude /= 1e3;
        index += 1;
      }
      const shown = scaledUnits(magnitude);
      const [key, suffix] = units[index];
      const resolved = t(key, { value: shown });
      return typeof resolved === 'string' && resolved !== '' && resolved !== key
        ? resolved
        : `${shown}${suffix}`;
    }

    /**
     * Prompt-side billing buckets, summed.
     * @param usage - the `tokenUsage` projection value.
     * @returns billed input tokens.
     */
    function billedInput(usage) {
      return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    }

    /**
     * Display-ready cache-hit share of prompt-side input.
     * @param usage - the `tokenUsage` projection value.
     * @returns percentage text, or null when no billed input exists.
     */
    function cacheHitPercent(usage) {
      const prompt = billedInput(usage);
      if (prompt <= 0) return null;
      const exact = (usage.cacheReadTokens / prompt) * 100;
      if (usage.cacheReadTokens < prompt && exact >= 99.95) return '99.9';
      const rounded = Math.round(exact * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }

    /** The rounded context-occupancy percentage, or null without both figures. */
    function contextPercent(pressure) {
      if (pressure === undefined) return null;
      const window_ = pressure.contextWindow;
      const used = pressure.projectedTokens ?? pressure.pressureTokens;
      if (typeof window_ !== 'number' || window_ <= 0 || typeof used !== 'number') return null;
      return Math.max(0, Math.min(100, Math.round((used / window_) * 100)));
    }

    /** Icon used on the pill and in the panel title. */
    function StatsIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
        h('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2.2 }),
        h('path', { d: 'M3 4v4c0 1.2 2.24 2.2 5 2.2s5-1 5-2.2V4' }),
        h('path', { d: 'M3 8v4c0 1.2 2.24 2.2 5 2.2s5-1 5-2.2V8' }),
      );
    }

    /**
     * Anchor, outside-pointer dismissal, and Escape handling for the details
     * panel — the same behavior the shipped statistic dialogs implement.
     * @param open - whether the panel is showing.
     * @param setOpen - state setter shared with the trigger.
     * @returns refs plus the measured fixed position (null while unmeasured).
     */
    function useAnchoredPanel(open, setOpen) {
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const [pos, setPos] = React.useState(null);

      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        let placed = false;
        const place = () => {
          const anchor = rootRef.current;
          const panel = panelRef.current;
          if (anchor === null || panel === null) return;
          const box = anchor.getBoundingClientRect();
          const width = panel.offsetWidth;
          const height = panel.offsetHeight;
          const margin = 12;
          const gap = 8;
          const maxLeft = Math.max(margin, window.innerWidth - margin - width);
          const left = Math.max(margin, Math.min(box.left + box.width / 2 - width / 2, maxLeft));
          const above = box.top - height - gap;
          const top = above >= margin ? above : Math.min(box.bottom + gap, window.innerHeight - margin - height);
          placed = true;
          setPos({ left: Math.round(left), top: Math.round(Math.max(margin, top)) });
        };
        place();
        if (!placed) return undefined;
        const onViewportChange = () => place();
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        return () => {
          window.removeEventListener('resize', onViewportChange);
          window.removeEventListener('scroll', onViewportChange, true);
        };
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current !== null && rootRef.current.contains(target)) return;
          if (panelRef.current !== null && panelRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open, setOpen]);

      return { rootRef, panelRef, pos };
    }

    /** The details panel body. */
    function StatsPanel({ t, usage, pressure, breakdown, stats, total, cacheHit, percent, panelRef, style }) {
      const rows = [];
      if (usage !== undefined) {
        if (cacheHit !== null) rows.push([t('panel.cacheHit'), t('pill.cacheHit', { percent: cacheHit })]);
        rows.push([t('panel.input'), formatCompact(usage.uncachedInputTokens, t)]);
        rows.push([t('panel.cacheRead'), formatCompact(usage.cacheReadTokens, t)]);
        if (usage.cacheWriteTokens !== 0) rows.push([t('panel.cacheWrite'), formatCompact(usage.cacheWriteTokens, t)]);
        rows.push([t('panel.output'), formatCompact(usage.outputTokens, t)]);
        rows.push([t('panel.total'), formatCompact(total, t)]);
      }
      if (stats !== undefined && (stats.turns > 0 || stats.steps > 0)) {
        rows.push([t('panel.turns'), `${stats.turns} / ${stats.steps}`]);
      }

      let context = null;
      if (percent !== null && pressure !== undefined) {
        const used = pressure.projectedTokens ?? pressure.pressureTokens;
        const breakdownTotal =
          breakdown === undefined ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
        const segments = [];
        if (breakdown !== undefined && breakdownTotal > 0) {
          for (const part of [
            ['system', t('panel.system'), breakdown.systemTokens, 'tks-seg-system'],
            ['tools', t('panel.tools'), breakdown.toolsTokens, 'tks-seg-tools'],
            ['messages', t('panel.messages'), breakdown.messageTokens, 'tks-seg-messages'],
          ]) {
            const share = (percent * part[2]) / breakdownTotal;
            if (share > 0) segments.push(h('span', { key: part[0], className: `tks-seg ${part[3]}`, style: { width: `${share}%` } }));
          }
        } else {
          segments.push(h('span', { key: 'total', className: 'tks-seg tks-seg-system', style: { width: `${percent}%` } }));
        }
        context = h('div', null, [
          h('div', { key: 'section', className: 'tks-section' }, t('panel.contextTitle')),
          h('div', { key: 'bar', className: 'tks-bar' }, segments),
          h(
            'dl',
            { key: 'details', className: 'tks-details' },
            [
              h('dt', { key: 'used' }, t('panel.contextUsed')),
              h('dd', { key: 'usedValue' }, `~${formatCompact(used, t)} / ${formatCompact(pressure.contextWindow, t)} · ${percent}%`),
              breakdown !== undefined
                ? [h('dt', { key: 'system' }, t('panel.system')), h('dd', { key: 'systemValue' }, formatCompact(breakdown.systemTokens, t))]
                : null,
              breakdown !== undefined
                ? [h('dt', { key: 'tools' }, t('panel.tools')), h('dd', { key: 'toolsValue' }, formatCompact(breakdown.toolsTokens, t))]
                : null,
              breakdown !== undefined
                ? [h('dt', { key: 'messages' }, t('panel.messages')), h('dd', { key: 'messagesValue' }, formatCompact(breakdown.messageTokens, t))]
                : null,
            ].filter(Boolean).flat(),
          ),
        ]);
      }

      return h(
        'div',
        { ref: panelRef, className: 'tks-panel', role: 'dialog', 'aria-label': t('panel.aria'), style },
        [
          h(
            'div',
            { key: 'title', className: 'tks-title' },
            [
              h('span', { key: 'label', className: 'tks-titleLabel' }, [h(StatsIcon, { key: 'icon' }), t('pill.title')]),
              usage !== undefined ? h('span', { key: 'value', className: 'tks-titleValue' }, formatCompact(total, t)) : null,
            ],
          ),
          h('div', { key: 'rule', className: 'tks-rule', 'aria-hidden': true }),
          rows.length === 0 && context === null
            ? h('div', { key: 'empty', className: 'tks-section' }, t('panel.empty'))
            : null,
          rows.length === 0 ? null : h('div', { key: 'usageSection', className: 'tks-section' }, t('panel.usageTitle')),
          rows.length === 0
            ? null
            : h(
                'dl',
                { key: 'usage', className: 'tks-details' },
                rows.flatMap(([term, value], index) => [
                  h('dt', { key: `dt${index}` }, term),
                  h('dd', { key: `dd${index}` }, value),
                ]),
              ),
          context,
        ],
      );
    }

    /**
     * Token statistics entry: a compact pill plus its click-open detail panel.
     * @param props - the `conversation.composer.dock` entry props.
     */
    function TokenStatsView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const useProjection = props.useProjection;
      const usage = useProjection('tokenUsage');
      const pressure = useProjection('contextPressure');
      const breakdown = useProjection('contextBreakdown');
      const stats = useProjection('sessionStats');
      const [open, setOpen] = React.useState(false);
      const { rootRef, panelRef, pos } = useAnchoredPanel(open, setOpen);

      const total = usage === undefined ? 0 : billedInput(usage) + usage.outputTokens;
      const hasTokens = total > 0;
      const cacheHit = usage !== undefined && hasTokens ? cacheHitPercent(usage) : null;
      const percent = contextPercent(pressure);

      // A pill exists to show a figure. Turn/step counts alone have nothing to
      // display here, and an icon-only pill would read as a broken control.
      const available = hasTokens || percent !== null;
      React.useEffect(() => {
        if (!available && open) setOpen(false);
      }, [available, open]);

      if (!available) return null;

      const parts = [];
      if (hasTokens) parts.push(formatCompact(total, t));
      if (cacheHit !== null) parts.push(t('pill.cacheHit', { percent: cacheHit }));
      if (percent !== null) parts.push(t('pill.context', { percent: percent }));
      const aria = `${t('pill.title')} · ${parts.join(' · ')}`;

      const label = parts.flatMap((part, index) =>
        index === 0
          ? [h('span', { key: `part${index}` }, part)]
          : [
              h('span', { key: `sep${index}`, className: 'tks-sep', 'aria-hidden': true }, '·'),
              h('span', { key: `part${index}` }, part),
            ],
      );

      return h(
        'div',
        { className: 'tks-root' },
        [
          h('style', { key: 'styles' }, CSS),
          h('span', { key: 'anchor', ref: rootRef, style: { display: 'inline-flex', minWidth: 0 } },
            h(
              'button',
              {
                type: 'button',
                className: 'tks-pill',
                'aria-label': aria,
                'aria-haspopup': 'dialog',
                'aria-expanded': open,
                title: aria,
                onClick: () => setOpen(!open),
              },
              [h(StatsIcon, { key: 'icon' }), h('span', { key: 'label', className: 'tks-label' }, label)],
            ),
          ),
          open
            ? ReactDOM.createPortal(
                h(StatsPanel, {
                  t,
                  usage,
                  pressure,
                  breakdown,
                  stats,
                  total,
                  cacheHit,
                  percent,
                  panelRef,
                  style: pos ?? { visibility: 'hidden', left: 0, top: 0 },
                }),
                document.body,
              )
            : null,
        ],
      );
    }

    /** Guard the hook-using view so a projection-less assembly renders nothing. */
    function TokenStats(props) {
      if (typeof props.useProjection !== 'function' || props.sessionId === undefined) return null;
      return h(TokenStatsView, props);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-stats: dictionaries');
        // Bound once; the registration label is a thunk so an owner projecting
        // it (nav rows, tabs) reads the active locale without re-registering.
        const translate = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'token-stats',
              order: 10,
              label: () => translate('pill.title'),
              locale: NS,
            },
            TokenStats,
          ),
        );
      },
    };
  },
});
