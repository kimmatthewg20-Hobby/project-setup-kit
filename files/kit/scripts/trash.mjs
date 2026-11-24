#!/usr/bin/env node
// Trash (project-setup v3.4): Claude deletes files with this instead of rm, so a delete never stops for approval.
//   node scripts/trash.mjs <path>...                 delete or trash files and folders (relative to the repo)
//   node scripts/trash.mjs --empty [--older-than H]  empty .trash/ (after every commit; at session start, items older than H hours)
// Build and test output that is gitignored (test-results, playwright-report, coverage, .next, dist, node_modules, logs...)
// is deleted at once: it is regenerated anyway. Anything else moves to .trash/ (gitignored), so a wrong delete can be
// undone until the next commit. A tracked file also stays in git history. Never touches .env files, .git or outside the repo.
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync, lstatSync, cpSync } from 'node:fs';
import { resolve, relative, basename, join, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

let root = process.cwd();
try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const trash = join(root, '.trash');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const say = msg => { if (!quiet) console.log(msg); };
const lstat = p => { try { return lstatSync(p); } catch { return null; } };

if (args[0] === '--empty') {
  const i = args.indexOf('--older-than');
  const hours = i > -1 ? Number(args[i + 1]) : 0;
  if (!existsSync(trash) || lstat(trash).isSymbolicLink()) process.exit(0);
  let n = 0;
  for (const name of readdirSync(trash).filter(n => n !== 'logs')) { // check logs stay for a look after a commit; each run overwrites them
    const p = join(trash, name);
    if (hours && Date.now() - lstat(p).mtimeMs < hours * 3600 * 1000) continue;
    rmSync(p, { recursive: true, force: true }); // removes links, never their targets
    n++;
  }
  if (n) say(`trash: emptied ${n} item(s)`);
  process.exit(0);
}

const paths = args.filter(a => a !== '--quiet');
if (!paths.length) { console.error('usage: node scripts/trash.mjs <path>... | --empty [--older-than <hours>]'); process.exit(2); }

const GENERATED = new Set(['test-results', 'playwright-report', 'blob-report', 'coverage', '.nyc_output', '.next', '.turbo',
  '.lighthouseci', '.cache', '.parcel-cache', '.svelte-kit', '.nuxt', '.output', 'dist', 'build', 'out', 'storybook-static',
  'node_modules', '.eslintcache', '.DS_Store']);
const generatedName = rel => rel.split(sep).some(part => GENERATED.has(part)) || /\.(log|tsbuildinfo)$/.test(rel);
const ignored = rel => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: root }).status === 0;
const tracked = rel => spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'ignore' }).status === 0;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let failed = 0;
for (const arg of paths) {
  const abs = resolve(arg);
  const rel = relative(root, abs);
  const top = rel.split(sep)[0];
  if (!rel || rel.startsWith('..') || top === '.git' || top === '.trash') {
    console.error(`trash: refused ${arg} (outside the repo, the repo itself, .git or .trash)`); failed++; continue;
  }
  if (/^\.env(?!\.example$)/.test(basename(rel))) { console.error(`trash: refused ${arg} (secrets: Kim handles .env files)`); failed++; continue; }
  if (!lstat(abs)) { say(`trash: ${rel} not found, nothing to do`); continue; }
  if (generatedName(rel) && ignored(rel) && !tracked(rel)) {
    rmSync(abs, { recursive: true, force: true });
    say(`trash: deleted ${rel} (generated output)`);
    continue;
  }
  mkdirSync(trash, { recursive: true });
  const dest = join(trash, `${stamp}-${rel.split(sep).join('__')}`);
  try { renameSync(abs, dest); }
  catch { cpSync(abs, dest, { recursive: true, verbatimSymlinks: true }); rmSync(abs, { recursive: true, force: true }); }
  say(`trash: ${rel} -> .trash/${basename(dest)} (emptied after the next commit)`);
}
process.exit(failed ? 1 : 0);
