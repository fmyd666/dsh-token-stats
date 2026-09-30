/**
 * Leak audit over the PUBLIC repository.
 *
 * Fetches every file the public GitHub archive serves and scans it for
 * credentials, private infrastructure, and absolute local paths. Reading the
 * published archive (rather than the working tree) means a staging or
 * gitignore mistake cannot hide behind a clean local scan.
 *
 * Run: node test/leak-audit.mjs
 */
import https from 'node:https';
import { homedir, userInfo } from 'node:os';

const REPO = 'fmyd666/dsh-token-stats';
const BRANCH = 'master';

// Local identifiers are derived at runtime rather than written literally, so
// this audit never publishes the very paths it exists to catch.
const LOCAL_USER = userInfo().username;
const HOME_BASE = homedir().split(/[\\/]/).filter(Boolean).pop() ?? '';

/** Follow redirects and resolve the body as a Buffer. */
function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'dsh-token-stats-leak-audit' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location !== undefined) {
        if (redirects === 0) { reject(new Error('too many redirects')); return; }
        res.resume();
        resolve(fetchBuffer(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

const archiveUrl = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
console.log(`fetching ${archiveUrl}`);
const archive = await fetchBuffer(archiveUrl);
console.log(`archive bytes: ${archive.length}`);

// The audit scans the RAW archive bytes, so gzip-compressed content is not
// searchable directly. Fall back to listing the public tree and fetching each
// file's raw bytes individually, which also covers every published path.
async function publicPaths() {
  const listing = JSON.parse(
    (await fetchBuffer(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)).toString('utf8'),
  );
  return listing.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
}

const paths = await publicPaths();
console.log(`published files: ${paths.length}`);
for (const path of paths) console.log(`  ${path}`);

const patterns = [
  ['OpenAI-style key', /sk-[A-Za-z0-9_-]{16,}/],
  ['GitHub token', /gh[opusr]_[A-Za-z0-9]{20,}/],
  ['Bearer header', /Bearer\s+[A-Za-z0-9._-]{16,}/],
  ['api key assignment', /(api[_-]?key|apikey|secret|password|passwd|token)\s*[:=]\s*["'][^"']{8,}["']/i],
  ['provider key env var', /\b[A-Z][A-Z0-9_]{2,}_API_KEY\b/],
  ['absolute Windows path', /[A-Za-z]:\\+Users/i],
  ['absolute POSIX home path', /\/(?:home|Users)\/[A-Za-z0-9._-]+\//],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['private-service hostname', /https?:\/\/(?!github\.com|raw\.githubusercontent\.com|codeload\.github\.com|api\.github\.com|www\.w3\.org|localhost|127\.0\.0\.1)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['local home segment', new RegExp(HOME_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
  ['local user name', new RegExp(LOCAL_USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
];

let findings = 0;
let scanned = 0;
for (const path of paths) {
  const bytes = await fetchBuffer(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`);
  const text = bytes.toString('utf8');
  scanned += 1;
  for (const [label, pattern] of patterns) {
    const match = text.match(pattern);
    if (match !== null) {
      findings += 1;
      console.log(`LEAK? ${path}: ${label} -> ${JSON.stringify(match[0].slice(0, 60))}`);
    }
  }
}

console.log(`scanned ${scanned}/${paths.length} published files`);
console.log(findings === 0 ? 'leak audit: CLEAN (no credentials or private data)' : `leak audit: ${findings} FINDING(S)`);
process.exitCode = findings === 0 ? 0 : 1;
