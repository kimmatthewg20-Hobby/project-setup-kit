#!/usr/bin/env node
// project-setup v6: copy the kit files into a repo, byte for byte. The skill runs it from the repo root:
//   node <KIT>/tools/install.mjs .                     copy every file in files/kit/ (new or changed ones only)
//   node <KIT>/tools/install.mjs . --dry-run           list what would change, write nothing
//   node <KIT>/tools/install.mjs . --only a,b          only paths under these prefixes (e.g. .claude/hooks,scripts)
//   node <KIT>/tools/install.mjs . --check             exit 1 if any kit file in the repo differs from the kit (Check mode)
// Never touches settings (the skill merges files/merge/), CLAUDE.md or notes. Keeps an existing scripts/learned-checks.json
// (its rules are the repo's own). Makes the hooks executable. Writes the kit version into .claude/kit.json.
// Prints one line per file (NEW, UPDATED, SAME, KEPT) and a summary. Exit 2 = could not run (never read as done).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const listArg = f => (flag(f) ? String(argv[argv.indexOf(f) + 1] || '').split(',').filter(Boolean) : []);
const target = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only') || '.');
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(KIT, 'files', 'kit');
const bail = m => { console.error(`install: ${m}`); process.exit(2); };
if (!existsSync(SRC)) bail(`kit files missing at ${SRC} (broken install: clone the kit again)`);
if (!existsSync(join(target, '.git'))) bail(`${target} is not the root of a git repo`);
if (resolve(target) === resolve(KIT)) bail('refusing to install the kit into itself');
const version = readFileSync(join(KIT, 'VERSION'), 'utf8').trim();
const only = listArg('--only').map(p => p.replace(/\\/g, '/').replace(/\/$/, ''));
const dry = flag('--dry-run'), check = flag('--check');
const KEEP_IF_PRESENT = new Set(['scripts/learned-checks.json']);
const EXECUTABLE = /^\.claude\/hooks\/[^/]+\.js$/;

const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(SRC).map(p => relative(SRC, p).split(sep).join('/')).sort()
  .filter(r => !only.length || only.some(o => r === o || r.startsWith(`${o}/`)));
if (!files.length) bail(`no kit files match --only ${only.join(',')}`);

const count = { NEW: 0, UPDATED: 0, SAME: 0, KEPT: 0 };
for (const rel of files) {
  const from = join(SRC, rel), to = join(target, rel);
  const data = readFileSync(from);
  let state;
  if (!existsSync(to)) state = 'NEW';
  else if (KEEP_IF_PRESENT.has(rel)) state = 'KEPT';
  else state = Buffer.compare(readFileSync(to), data) === 0 ? 'SAME' : 'UPDATED';
  count[state]++;
  if (state !== 'SAME') console.log(`${state.padEnd(7)} ${rel}`);
  if (dry || check || state === 'SAME' || state === 'KEPT') continue;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, data);
  if (EXECUTABLE.test(rel)) chmodSync(to, 0o755);
}
if (!dry && !check) {
  for (const rel of files) if (EXECUTABLE.test(rel) && existsSync(join(target, rel))) chmodSync(join(target, rel), 0o755);
  if (!only.length) { // record the kit version this repo now has
    const kitJson = join(target, '.claude', 'kit.json');
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(kitJson, 'utf8')); } catch {}
    if (cfg.version !== version) { cfg.version = version; mkdirSync(dirname(kitJson), { recursive: true }); writeFileSync(kitJson, JSON.stringify(cfg, null, 2) + '\n'); }
  }
}
const changed = count.NEW + count.UPDATED;
console.log(`install: kit v${version} · ${count.NEW} new · ${count.UPDATED} updated · ${count.SAME} same · ${count.KEPT} kept${dry ? ' (dry run)' : ''}${check ? ' (check only)' : ''}`);
process.exit(check && changed ? 1 : 0);
