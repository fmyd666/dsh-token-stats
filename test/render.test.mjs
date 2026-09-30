/**
 * Bounded render smoke test for the Token Stats client half.
 *
 * Boots the bundle's Client factory against a minimal React runtime and a
 * stubbed module loader, expands the element tree the way React would, and
 * asserts:
 *   1. the plugin shape and apply() wiring (locale + slot registration),
 *   2. the closed pill shows the compact total, cache-hit share, context share,
 *   3. opening the pill renders the detail panel with exact bucket figures,
 *   4. nothing renders without any projection,
 *   5. usage-only, clamped, and stats-only sessions each behave.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const SOURCE = new URL('../client.js', import.meta.url);
const PACKAGE_ID = '@local/token-stats';

// --- minimal React runtime with working hooks --------------------------------
const hookState = [];
let hookIndex = 0;
let stateVersion = 0;
const effectCleanups = [];

const React = {
  createElement(type, props, ...children) {
    return { $$el: true, type, props: props ?? {}, children: children.flat() };
  },
  useState(initial) {
    const slot = `s${hookIndex++}`;
    if (!(slot in hookState)) hookState[slot] = typeof initial === 'function' ? initial() : initial;
    return [
      hookState[slot],
      (next) => {
        hookState[slot] = typeof next === 'function' ? next(hookState[slot]) : next;
        stateVersion += 1;
      },
    ];
  },
  useRef(initial) {
    const slot = `r${hookIndex++}`;
    if (!(slot in hookState)) hookState[slot] = { current: initial ?? null };
    return hookState[slot];
  },
  useEffect(callback) {
    // Run for real so listener wiring is exercised; cleanups are collected.
    const cleanup = callback();
    if (typeof cleanup === 'function') effectCleanups.push(cleanup);
  },
  useLayoutEffect() {},
};

const ReactDOM = { createPortal(children, container) { return { $$portal: true, children, container }; } };

const listeners = [];
globalThis.document = {
  body: { $$body: true },
  addEventListener: (...args) => listeners.push(args),
  removeEventListener() {},
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 };

// --- capture the factory through the real loader entry point -----------------
let captured;
globalThis.window.__ModuleLoader__ = { load(registration) { captured = registration; } };

const requireStub = (specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom') return ReactDOM;
  throw new Error(`unexpected require("${specifier}")`);
};

const source = readFileSync(SOURCE, 'utf8');
new Function('window', 'require', source)(globalThis.window, requireStub);

assert.equal(captured.id, PACKAGE_ID, 'factory registers under the package id');
const plugin = captured.factory(requireStub);

// --- 1. plugin shape and apply() wiring --------------------------------------
assert.deepEqual(plugin.inject, ['slots', 'locale'], 'declares its two services');
assert.equal(typeof plugin.apply, 'function', 'exposes apply()');

const registrations = [];
let registeredDicts = null;
const fakeCtx = {
  effect(callback, label) {
    const dispose = callback();
    registrations.push({ effect: label, dispose });
    return () => {};
  },
  slots: {
    inject(key, callback) {
      assert.equal(key, 'conversation.composer.dock', 'injects into the composer dock');
      callback();
      return () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
  locale: {
    register: (ns, dicts) => {
      registeredDicts = dicts;
      registrations.push({ ns, dicts });
      return () => {};
    },
    // The plugin binds its namespace for the registration label, exactly as the
    // real locale service does; the chain mirrors ns -> common -> key.
    bind: (ns) => (key, params) => {
      const table = registeredDicts?.['zh'] ?? {};
      const template = table[key] ?? COMMON[key] ?? key;
      return params === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
    },
  },
};
plugin.apply(fakeCtx);

const dict = registrations.find((entry) => entry.ns !== undefined);
assert.ok(dict, 'registers a dictionary');
assert.equal(dict.ns, 'tokenStats', 'owns the tokenStats namespace');
assert.deepEqual(Object.keys(dict.dicts).sort(), ['en', 'zh'], 'ships both locales');
assert.deepEqual(
  Object.keys(dict.dicts.zh).sort(),
  Object.keys(dict.dicts.en).sort(),
  'locale key sets are identical',
);
assert.ok(registrations.some((entry) => entry.effect !== undefined), 'registers inside an effect');

const entry = registrations.find((entry) => entry.options !== undefined);
assert.ok(entry, 'registers one slot entry');
assert.equal(entry.options.name, 'conversation.composer.dock');
assert.equal(entry.options.id, 'token-stats', 'uses an id of its own, not a shipped one');
assert.equal(entry.options.order, 10, 'sits beside the shipped stats pill');
assert.equal(entry.options.locale, 'tokenStats', 'binds its dictionary namespace');
// The registration label must be locale-driven, not a hardcoded English string.
assert.equal(typeof entry.options.label, 'function', 'the label is a thunk so owners re-read the active locale');
assert.equal(entry.options.label(), 'Token 统计', 'the label resolves through the plugin dictionary');

// --- tree expansion ----------------------------------------------------------
/** Expand function components the way React would, collecting DOM elements. */
function expand(node) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (Array.isArray(node)) {
    const out = [];
    for (const child of node) {
      const expanded = expand(child);
      if (expanded === null) continue;
      if (Array.isArray(expanded)) out.push(...expanded);
      else if (expanded.$$frag === true) out.push(...expanded.children);
      else out.push(expanded);
    }
    return out;
  }
  if (typeof node !== 'object') return node;
  if (node.$$portal) return { $$portal: true, children: expand(node.children) };
  if (!node.$$el) return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, children: expand(node.children) };
}

/** Normalize a node's children to an array. */
function kidsOf(node) {
  const kids = node.children;
  if (kids === undefined || kids === null || kids === false) return [];
  return Array.isArray(kids) ? kids : [kids];
}

/** Flatten every string in an expanded tree. */
function texts(node) {
  if (node === null || node === undefined || node === false) return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return kidsOf(node).flatMap(texts);
}

/** Depth-first search for the first expanded node matching a predicate. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if ((node.$$el === true || node.$$portal === true) && predicate({ ...node, props: node.props ?? {} })) return node;
  return find(kidsOf(node), predicate);
}

/** Render the entry component with a fresh hook pass. */
function render(props) {
  hookIndex = 0;
  return expand(entry.component(props));
}

// --- fake projection data ----------------------------------------------------
const usage = { uncachedInputTokens: 1200, cacheReadTokens: 11400, cacheWriteTokens: 400, outputTokens: 3400 };
const pressure = { pressureTokens: 12000, projectedTokens: 13000, contextWindow: 1000000 };
const breakdown = { systemTokens: 2000, toolsTokens: 4000, messageTokens: 7000 };
const stats = { turns: 7, steps: 19 };
const projections = { tokenUsage: usage, contextPressure: pressure, contextBreakdown: breakdown, sessionStats: stats };

// A translate seat that mirrors the REAL host lookup chain: the entry's own
// namespace first, then the shared `common` vocabulary, and — like the host —
// the unresolved key itself when neither answers. Modelling the fallback this
// way is what catches keys borrowed from another plugin's private namespace.
const OWN_NS = dict.dicts.zh;
// Faithful to the installed `common` namespace, which ships ONLY these two
// number keys. `number.billion` and `number.groupSeparator` are NOT here, so
// the plugin must own them; borrowing either would break exactly as
// `number.groupSeparator` once did.
const COMMON = {
  'number.thousand': '{value}K',
  'number.million': '{value}M',
};
const t = (key, params) => {
  const template =
    key in OWN_NS ? OWN_NS[key] : key in COMMON ? COMMON[key] : key;
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
};

// Every key the component asks for must be answerable by the real chain; a
// borrowed key would surface as its own name in the rendered output.
const askedKeys = new Set();
const trackingT = (key, params) => {
  askedKeys.add(key);
  return t(key, params);
};

const props = { t: trackingT, sessionId: 'session-1', useProjection: (key) => projections[key] };

// --- 2. closed render --------------------------------------------------------
const closed = render(props);
assert.ok(find(closed, (el) => el.props.className === 'tks-root'), 'renders its root');
assert.ok(find(closed, (el) => el.type === 'style'), 'ships its stylesheet as an element');
const button = find(closed, (el) => el.props.className === 'tks-pill');
assert.ok(button, 'renders the pill button');
assert.equal(button.props['aria-haspopup'], 'dialog');
assert.equal(button.props['aria-expanded'], false, 'starts collapsed');
assert.equal(find(closed, (el) => el.$$portal) , null, 'panel stays closed');

const pillText = texts(button).join(' ');
// billed input = 1200 + 11400 + 400 = 13000; total = 13000 + 3400 = 16400 -> 16.4K
assert.ok(pillText.includes('16.4K'), `pill shows the compact total (got "${pillText}")`);
// cache hit = 11400 / 13000 = 87.69% -> 87.7
assert.ok(pillText.includes('87.7%'), `pill shows the cache-hit share (got "${pillText}")`);
// context = 13000 / 1000000 = 1.3% -> 1
assert.ok(pillText.includes('上下文 1%'), `pill shows the context share (got "${pillText}")`);
assert.ok(button.props['aria-label'].includes('Token 统计'), 'pill carries an accessible name');

// --- 3. open the panel by driving the real click handler ---------------------
const before = stateVersion;
button.props.onClick();
assert.ok(stateVersion > before, 'the click handler updates state');
const opened = render(props);
const portal = find(opened, (el) => el.$$portal);
assert.ok(portal, 'opening renders the detail panel through a portal');
assert.equal(portal.children.props.className, 'tks-panel', 'portal carries the panel');
const panel = find(opened, (el) => el.props.className === 'tks-panel');
assert.ok(panel, 'panel element exists');
assert.equal(panel.props.role, 'dialog');
assert.ok(panel.props['aria-label'].includes('详情'), 'panel is labelled');

const panelText = texts(panel).join(' ');
assert.ok(panelText.includes('Token 用量'), 'panel lists the usage section');
assert.ok(panelText.includes('16.4K'), `panel shows the compact total (got "${panelText}")`);
assert.ok(panelText.includes('1.2K'), 'panel shows the compact uncached input');
assert.ok(panelText.includes('11.4K'), 'panel shows the compact cache reads');
assert.ok(panelText.includes('400'), 'panel shows the cache writes');
assert.ok(panelText.includes('3.4K'), 'panel shows the compact output');
assert.ok(!panelText.includes('16,400'), 'no grouped exact figures remain');
assert.ok(panelText.includes('7 / 19'), 'panel shows turns and steps');
assert.ok(panelText.includes('上下文占用'), 'panel lists the context section');
assert.ok(panelText.includes('~13K / 1M · 1%'), `panel shows occupancy against capacity (got "${panelText}")`);
assert.ok(panelText.includes('系统提示词'), 'panel breaks down the system prompt');
assert.ok(panelText.includes('工具定义'), 'panel breaks down the tool schemas');
assert.ok(panelText.includes('对话消息'), 'panel breaks down the messages');
assert.equal(find(panel, (el) => el.props.className === 'tks-bar') !== null, true, 'panel draws the occupancy bar');

// --- 4. nothing to show renders nothing --------------------------------------
assert.equal(render({ ...props, useProjection: () => undefined }), null, 'renders nothing without any projection');

// --- 5. independent projections ----------------------------------------------
const usageOnly = texts(render({ ...props, useProjection: (key) => (key === 'tokenUsage' ? usage : undefined) })).join(' ');
assert.ok(usageOnly.includes('16.4K'), 'renders from usage alone');
assert.ok(!usageOnly.includes('上下文'), 'omits context copy without a capacity');

const clamped = texts(
  render({
    ...props,
    useProjection: (key) =>
      key === 'contextPressure' ? { pressureTokens: 5_000_000, contextWindow: 1_000_000 } : undefined,
  }),
).join(' ');
assert.ok(clamped.includes('上下文 100%'), `clamps occupancy to 100% (got "${clamped}")`);

// A stats-only session has no figure for this pill; section 10 asserts the
// resulting null more precisely.

// Zero usage renders nothing rather than a 0-token pill.
const emptyUsage = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
assert.equal(
  render({ ...props, useProjection: (key) => (key === 'tokenUsage' ? emptyUsage : undefined) }),
  null,
  'a zeroed usage projection shows no pill',
);

// Cache hit at 100% still reports a share rather than dividing by nothing.
const fullCache = texts(
  render({
    ...props,
    useProjection: (key) =>
      key === 'tokenUsage'
        ? { uncachedInputTokens: 0, cacheReadTokens: 900, cacheWriteTokens: 100, outputTokens: 50 }
        : undefined,
  }),
).join(' ');
assert.ok(fullCache.includes('90%'), `reports the cache-hit share (got "${fullCache}")`);

// --- 6. Escape and outside-pointer dismissal while open ----------------------
// A projection-less render correctly resets the panel to closed, so reopen it.
const reopen = find(render(props), (el) => el.props.className === 'tks-pill');
reopen.props.onClick();
listeners.length = 0;
render(props);
assert.ok(
  listeners.some(([type]) => type === 'keydown'),
  'registers a document keydown listener while open',
);
assert.ok(
  listeners.some(([type]) => type === 'pointerdown'),
  'registers an outside-pointer dismissal listener while open',
);

// Escaping through the registered handler closes the panel again.
const keydown = listeners.find(([type]) => type === 'keydown')[1];
const closeBefore = stateVersion;
keydown({ key: 'Escape' });
assert.ok(stateVersion > closeBefore, 'Escape closes the panel');
assert.equal(find(render(props), (el) => el.$$portal), null, 'panel is closed after Escape');

// --- 7. no rendered output may contain an unresolved locale key --------------
// Regression guard for the shipped defect: a figure rendered as
// `13number.groupSeparator861...` because the key belonged to another plugin's
// namespace. The key-coverage check runs at the END of this file, after every
// render below, so it sees the complete set of requested keys.
for (const [label, value] of [
  ['pill text', pillText],
  ['panel text', panelText],
  ['usage-only pill', usageOnly],
  ['clamped pill', clamped],
  ['full-cache pill', fullCache],
]) {
  assert.ok(
    !/number\.(thousand|million|billion|groupSeparator)/.test(value),
    `${label} must not leak an unresolved locale key (got "${value}")`,
  );
}

// --- 8. K / M / B unit promotion, driven through the real component ----------
/**
 * Render one session and return the pill text, to exercise formatCompact
 * through the actual component rather than a reimplementation.
 * @param outputTokens - provider output tokens to report.
 * @param uncachedInputTokens - uncached prompt tokens to report.
 * @returns the pill's flattened text.
 */
function pillFor(uncachedInputTokens, outputTokens) {
  return texts(
    render({
      ...props,
      useProjection: (key) =>
        key === 'tokenUsage'
          ? { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens }
          : undefined,
    }),
  ).join(' ');
}

const cases = [
  [0, 999, '999', 'sub-thousand stays exact'],
  [0, 1000, '1K', 'one thousand is 1K'],
  [0, 1500, '1.5K', 'sub-ten keeps one decimal'],
  [0, 12_500, '12.5K', 'two digits keep one decimal'],
  [0, 123_400, '123K', 'three digits round to whole'],
  [0, 999_400, '999K', 'just under a million stays K'],
  [0, 999_600, '1M', 'rounding past the threshold promotes to M'],
  [0, 1_000_000, '1M', 'one million is 1M'],
  [0, 2_450_000, '2.5M', 'millions keep one decimal'],
  [0, 999_600_000, '1B', 'rounding past a billion promotes to B'],
  [0, 1_500_000_000, '1.5B', 'billions render as B'],
  [0, 12_345_678_901, '12.3B', 'large values stay in B, never overflow the unit list'],
];
for (const [input, output, expected, why] of cases) {
  const text = pillFor(input, output);
  assert.ok(text.includes(expected), `${why}: expected "${expected}" in "${text}"`);
}

// --- 9. key coverage, checked last so it sees every render above -------------
// Every key the component ever asked for must be answerable by the real lookup
// chain (own namespace, then the shared `common` vocabulary). A borrowed key
// appears here as unresolved — this is the check that would have caught the
// original defect, and it only works once all renders have run.
const unresolved = [...askedKeys].filter((key) => !(key in OWN_NS) && !(key in COMMON));
assert.deepEqual(
  unresolved,
  [],
  `every requested key must resolve through own namespace or common; unresolved: ${unresolved.join(', ')}`,
);
assert.ok(askedKeys.has('number.thousand'), 'the K template was resolved');
assert.ok(askedKeys.has('number.million'), 'the M template was resolved');
assert.ok(askedKeys.has('number.billion'), 'the B template was resolved and is owned locally');
assert.ok(
  !askedKeys.has('number.groupSeparator'),
  'the borrowed grouping key is no longer requested at all',
);

// --- 10. edge cases around partial data --------------------------------------
// A session that only reports turns/steps has no figure to display. An
// icon-only pill would be meaningless and would also carry a dangling
// separator in its accessible name.
assert.equal(
  render({ ...props, useProjection: (key) => (key === 'sessionStats' ? stats : undefined) }),
  null,
  'a turns-only session renders nothing (no figure to show)',
);

// Context known but no provider usage yet: the pill shows the context share
// alone, and its accessible name must not end in a dangling separator.
const contextOnlyClosed = render({
  ...props,
  useProjection: (key) => (key === 'contextPressure' ? pressure : undefined),
});
const contextOnlyButton = find(contextOnlyClosed, (el) => el.props.className === 'tks-pill');
assert.ok(contextOnlyButton, 'a context-only session still renders the pill');
const contextOnlyAria = contextOnlyButton.props['aria-label'];
assert.ok(!/·\s*$/.test(contextOnlyAria), `aria must not end in a separator (got "${contextOnlyAria}")`);
assert.ok(contextOnlyAria.includes('上下文'), 'aria names the context share');
const contextOnlyLabel = texts(contextOnlyButton).join(' ');
assert.ok(contextOnlyLabel.includes('上下文'), 'the pill text names the context share');
assert.ok(!contextOnlyLabel.includes('16.4K'), 'no token figure is invented');

// The details panel reports the cache-hit share, not only the raw reads.
const reopenAgain = find(render(props), (el) => el.props.className === 'tks-pill');
reopenAgain.props.onClick();
const openedPanel = texts(find(render(props), (el) => el.props.className === 'tks-panel')).join(' ');
assert.ok(openedPanel.includes('缓存命中'), `panel reports the cache-hit share (got "${openedPanel}")`);
assert.ok(openedPanel.includes('87.7%'), 'the cache-hit share carries its percentage');

console.log('render smoke test: PASS');
console.log(`  pill (closed): ${pillText}`);
console.log(`  panel text: ${panelText}`);