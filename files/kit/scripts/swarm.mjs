#!/usr/bin/env node
// Swarm (project-setup v6.0). /deliver builds up to 5 tickets at once, each worker in its own git worktree.
//   node scripts/swarm.mjs prep                       run by a worker inside its worktree: links node_modules from the
//                                                      main folder (no second install), so typecheck and unit tests run
//   node scripts/swarm.mjs collect <worktree> [--check <file>]...
//                                                      run by /deliver in the main folder: copies the worker's changes
//                                                      (committed or not) into the main folder as unstaged edits, leaves each
//                                                      --check file as /deliver wrote it, then removes the worktree and its branch.
//                                                      A patch that does not apply cleanly changes nothing: it is saved to
//                                                      .trash/swarm/ and the worktree is kept, so /deliver rebuilds that ticket alone.
//   node scripts/swarm.mjs usage                      usage guard, run before each batch: reads the plan usage the status line
//                                                      saved (.claude/state/usage.json) and prints the batch size to use:
//                                                      "batch 1" (normal) when the 5-hour use is at 80%+ or the weekly at 90%+,
//                                                      2 from 60% (thresholds: .claude/kit.json "usageGuard"), else maxAgents
//   node scripts/swarm.mjs list                       worktrees left over (after a crash)
//   node scripts/swarm.mjs drop <worktree>            remove one without collecting it
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';

const [cmd, ...rest] = process.argv.slice(2);
const git = (args, cwd = '.') => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const stop = (msg, code = 1) => { console.log(`swarm: ${msg}`); process.exit(code); };
const worktrees = () => git(['worktree', 'list', '--porcelain']).split('\n\n').filter(Boolean).map(b => ({
  path: (b.match(/^worktree (.+)$/m) || [])[1], branch: ((b.match(/^branch (.+)$/m) || [])[1] || '').replace(/^refs\/heads\//, ''),
}));
const mainPath = () => worktrees()[0].path;
const NO_NODE_MODULES = [':(exclude,glob)**/node_modules', ':(exclude)node_modules'];

if (cmd === 'prep') {
  const main = mainPath(), here = git(['rev-parse', '--show-toplevel']).trim();
  if (resolve(main) === resolve(here)) stop('prep runs inside a worker worktree, not the main folder');
  let linked = 0;
  const walk = (rel, depth) => {
    const src = join(main, rel);
    if (existsSync(join(src, 'node_modules')) && existsSync(join(here, rel)) && !existsSync(join(here, rel, 'node_modules'))) {
      symlinkSync(join(src, 'node_modules'), join(here, rel, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      linked++;
    }
    if (depth >= 3) return;
    for (const d of readdirSync(src, { withFileTypes: true }))
      if (d.isDirectory() && !/^(node_modules|\.git|\.claude|\.trash|\.next|dist|build|coverage)$/.test(d.name) && !d.name.startsWith('.'))
        walk(join(rel, d.name), depth + 1);
  };
  walk('.', 0);
  console.log(`swarm: prep done (${linked} node_modules linked from the main folder). Run typecheck and your own unit tests only.`);
  process.exit(0);
}

if (cmd === 'usage') {
  const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
  const kit = readJson('.claude/kit.json');
  const max = Math.min(Math.max(Number(kit.maxAgents) || 5, 1), 5);
  const g = { normalAt5h: 80, normalAt7d: 90, smallAt5h: 60, smallBatch: 2, ...(kit.usageGuard || {}) };
  const u = readJson('.claude/state/usage.json');
  if (!(typeof u.at === 'number' && Date.now() - u.at < 15 * 60 * 1000))
    stop(`usage unknown (no status line numbers from the last 15 minutes) -> batch ${max}. A worker that stops on a usage limit switches the rest of this run to normal.`, 0);
  const five = u.fiveHour ?? 0, week = u.sevenDay ?? 0, seen = `5h ${u.fiveHour ?? '?'}% · 7d ${u.sevenDay ?? '?'}%`;
  if (five >= g.normalAt5h || week >= g.normalAt7d) stop(`usage ${seen} -> batch 1 (normal: one ticket at a time until usage drops)`, 0);
  if (five >= g.smallAt5h) stop(`usage ${seen} -> batch ${Math.min(g.smallBatch, max)}`, 0);
  stop(`usage ${seen} -> batch ${max}`, 0);
}

if (cmd === 'list') {
  const extra = worktrees().slice(1);
  console.log(extra.length ? extra.map(w => `${w.path}  (${w.branch || 'detached'})`).join('\n') : 'swarm: no worker worktrees');
  process.exit(0);
}

const findWorktree = p => {
  const want = resolve(p || '');
  const w = worktrees().slice(1).find(x => resolve(x.path) === want);
  if (!w) stop(`${p || '(none)'} is not a worker worktree of this repo. See: node scripts/swarm.mjs list`);
  return w;
};
const remove = w => {
  spawnSync('git', ['worktree', 'remove', '--force', w.path], { stdio: 'ignore' });
  if (w.branch && !/^(main|master)$/.test(w.branch) && !worktrees().some(x => x.branch === w.branch))
    spawnSync('git', ['branch', '-D', w.branch], { stdio: 'ignore' });
};

if (cmd === 'drop') {
  const w = findWorktree(rest[0]);
  remove(w);
  console.log(`swarm: dropped ${w.path}`);
  process.exit(0);
}

if (cmd === 'collect') {
  const w = findWorktree(rest[0]);
  const checks = rest.flatMap((a, i) => (rest[i - 1] === '--check' ? [a] : []));
  const base = git(['merge-base', 'HEAD', git(['rev-parse', 'HEAD'], w.path).trim()]).trim();
  git(['add', '-A', '--', '.', ...NO_NODE_MODULES], w.path);
  const changed = git(['diff', '--cached', '--name-only', base, '--', '.', ...NO_NODE_MODULES], w.path).split('\n').filter(Boolean);
  const notes = [];
  for (const c of checks) {
    const mine = existsSync(c) ? readFileSync(c) : null, theirs = existsSync(join(w.path, c)) ? readFileSync(join(w.path, c)) : null;
    if (theirs && mine && !mine.equals(theirs)) notes.push(`the worker changed its copy of ${c} (yours is kept): review why`);
  }
  const keep = changed.filter(f => !checks.includes(f));
  if (!keep.length) { remove(w); stop(`nothing to bring home from ${basename(w.path)} (worktree removed)${notes.length ? `; ${notes.join('; ')}` : ''}`, 0); }
  const patch = git(['diff', '--cached', '--binary', base, '--', ...keep], w.path);
  mkdirSync('.trash/swarm', { recursive: true });
  const file = join('.trash/swarm', `${basename(w.path)}.patch`);
  writeFileSync(file, patch);
  const ok = spawnSync('git', ['apply', '--check', file], { encoding: 'utf8' });
  if (ok.status !== 0) stop(`CONFLICT: ${basename(w.path)} does not apply on the main folder (nothing changed). Patch kept at ${file}, worktree kept. Build this ticket again alone.\n${String(ok.stderr).trim().split('\n').slice(0, 8).join('\n')}`);
  execFileSync('git', ['apply', file]);
  remove(w);
  console.log(`swarm: brought home ${keep.length} file(s) from ${basename(w.path)}: ${keep.join(', ')}`);
  for (const n of notes) console.log(`swarm: NOTE ${n}`);
  process.exit(0);
}

stop('usage: node scripts/swarm.mjs prep | collect <worktree> [--check <file>]... | usage | list | drop <worktree>', 2);
