/**
 * Determine whether the served/local byte difference is semantic staleness or
 * merely line-ending normalization.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const page = await get('http://127.0.0.1:3081/');
const marker = '__DSH_BOOT__"] = ';
const start = page.indexOf(marker);
const boot = JSON.parse(page.slice(start + marker.length, page.indexOf('</script>', start)));
const row = boot.entries.find((entry) => entry.id === '@local/token-stats');
const served = await get(`http://127.0.0.1:3081/${row.url}`);
const local = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const crlf = (text) => (text.match(/\r\n/g) ?? []).length;
const lfOnly = (text) => (text.match(/(?<!\r)\n/g) ?? []).length;

console.log(`local : bytes=${Buffer.byteLength(local)} crlf=${crlf(local)} lf=${lfOnly(local)}`);
console.log(`served: bytes=${Buffer.byteLength(served)} crlf=${crlf(served)} lf=${lfOnly(served)}`);

const normalizedLocal = local.replace(/\r\n/g, '\n');
const normalizedServed = served.replace(/\r\n/g, '\n');
console.log(`equal after CRLF normalization : ${normalizedLocal === normalizedServed}`);

if (normalizedLocal !== normalizedServed) {
  // The served copy carries host-added decoration: a sourcemap comment and,
  // here, a trailing `;`. Strip those, then the local source must equal what
  // the server serves — otherwise HMR has not picked the edit up.
  const firstMap = normalizedServed.indexOf('//# sourceMappingURL=');
  const servedCore = (firstMap >= 0 ? normalizedServed.slice(0, firstMap) : normalizedServed)
    .replace(/;\s*$/, '');
  console.log(`sourcemap comment stripped : ${firstMap >= 0}`);
  console.log(`served core equals local   : ${servedCore === normalizedLocal}`);
  if (servedCore !== normalizedLocal) {
    const limit = Math.min(normalizedLocal.length, servedCore.length);
    let at = -1;
    for (let i = 0; i < limit; i += 1) {
      if (normalizedLocal[i] !== servedCore[i]) { at = i; break; }
    }
    console.log(`first divergence at ${at}`);
    if (at >= 0) {
      console.log('local :', JSON.stringify(normalizedLocal.slice(Math.max(0, at - 60), at + 60)));
      console.log('served:', JSON.stringify(servedCore.slice(Math.max(0, at - 60), at + 60)));
    } else {
      console.log(`prefix relation; delta ${servedCore.length - normalizedLocal.length}`);
      console.log('served extra:', JSON.stringify(servedCore.slice(normalizedLocal.length)));
    }
  }
  process.exitCode = servedCore === normalizedLocal ? 0 : 1;
} else {
  process.exitCode = 0;
}
