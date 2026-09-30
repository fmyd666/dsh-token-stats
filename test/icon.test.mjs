/** Structural check of the bundle icon, which the manifest exposes to Plugin Manager. */
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8');
const checks = {
  'no currentColor (loaded via <img src>)': !svg.includes('currentColor'),
  'single <svg> root': (svg.match(/<svg/g) ?? []).length === 1,
  'closing </svg>': svg.trim().endsWith('</svg>'),
  'gradient defined': svg.includes('id="tokenStatsStroke"'),
  'gradient referenced': svg.includes('url(#tokenStatsStroke)'),
  'explicit hex colors': /#[0-9A-Fa-f]{6}/.test(svg),
  'xmlns present': svg.includes('xmlns="http://www.w3.org/2000/svg"'),
};
for (const [label, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([label]) => label);
console.log(failed.length === 0 ? 'icon check: PASS' : `icon check: FAIL (${failed.join('; ')})`);
process.exitCode = failed.length === 0 ? 0 : 1;
