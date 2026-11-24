#!/usr/bin/env node
// Check (project-setup v6.0): every check in ONE plain command, so Claude never builds long shell chains
// (variables, $(...), cd, ; chains make Claude Code ask for approval on every run).
//   node scripts/check.mjs                 format, lint, typecheck, tests, build, learned checks (any failure fails); ratchet and
//                                          floor guard on the uncommitted changes (report only: the commit-msg hook blocks)
//   node scripts/check.mjs --fast          same without build
//   node scripts/check.mjs --fix           format/auto-fix first (biome, prettier or the "format" script; cargo fmt; ruff; gofmt)
//   node scripts/check.mjs --e2e [spec...] also the end-to-end checks: Playwright (all specs, or the ones given; starts local
//                                          Supabase if it is down, installs the matching browser) or checks.e2e from .claude/kit.json
//   node scripts/check.mjs --only test     only these steps, comma list (format|lint|typecheck|test|build|learned|ratchet|floor|e2e);
//                                          "test" also runs "test:rust" and the like in a repo with more than one stack
//   node scripts/check.mjs --skip lint,build  leave steps out (the pre-push hook uses it for checks that were red before setup)
//   node scripts/check.mjs --list          print the steps this repo has and where each comes from, run nothing
// Stacks found by their manifest: package.json (its scripts), Cargo.toml or src-tauri/Cargo.toml (cargo fmt, clippy, test,
// build), pyproject.toml or requirements.txt (ruff, mypy or pyright, pytest), go.mod (gofmt, go vet, go test, go build).
// .claude/kit.json "checks" wins over what is found: {"test": "cargo test --features cli", "build": false, "e2e": "cargo test --test cli"}
// (a string is split on spaces, no shell; an array is used as is; false drops the step; "test:rust" names one stack's step).
// A full run with no format, lint, typecheck or test step FAILS: green with nothing checked is not green.
// Set "checks": {"allowNone": true} only for a repo with no code (docs, config).
// Prints one line per step; a failing step shows its last lines. Full logs: .trash/logs/<step>.log (gitignored; kept after commits, each run overwrites them).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const listArg = f => (flag(f) ? String(argv[argv.indexOf(f) + 1] || '').split(',').filter(Boolean) : []);
const only = listArg('--only');
const skip = listArg('--skip');
const specs = flag('--e2e') ? argv.slice(argv.indexOf('--e2e') + 1).filter((a, i, all) => !a.startsWith('--') && !['--only', '--skip'].includes(all[i - 1])) : [];
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
const read = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const onPath = c => !spawnSync(c, ['--version'], { stdio: 'ignore' }).error;
const custom = readJson('.claude/kit.json').checks || {};
const words = v => (Array.isArray(v) ? v.map(String) : String(v).trim().split(/\s+/).filter(Boolean));

// --- What this repo has, per stack. Each step: [name, command, from]. A command of null with a message = a step that fails
// (a tool the stack needs is missing), so a missing tool is never read as a pass.
const stacks = [];

if (existsSync('package.json')) {
  const pkg = readJson('package.json');
  const scripts = pkg.scripts || {};
  const pm = existsSync('pnpm-lock.yaml') ? 'pnpm' : existsSync('yarn.lock') ? 'yarn' : 'npm';
  const run = name => [pm, 'run', name];
  const s = { id: 'node', steps: [] };
  if (scripts.format) s.fix = run('format');
  else if (existsSync('biome.json') || existsSync('biome.jsonc')) s.fix = ['npx', '--no-install', 'biome', 'check', '--write', '.'];
  else if (pkg.devDependencies?.prettier || pkg.dependencies?.prettier) s.fix = ['npx', '--no-install', 'prettier', '--write', '.'];
  for (const n of ['lint', 'typecheck', 'test', 'build']) if (scripts[n]) s.steps.push([n, run(n), `package.json "${n}" script`]);
  stacks.push(s);
}

// Rust: the root crate or workspace, else a Tauri app's src-tauri/ crate.
const cargoManifest = existsSync('Cargo.toml') ? 'Cargo.toml' : existsSync('src-tauri/Cargo.toml') ? 'src-tauri/Cargo.toml' : null;
if (cargoManifest) {
  const s = { id: 'rust', steps: [] };
  const mp = ['--manifest-path', cargoManifest];
  if (!onPath('cargo')) s.steps.push(['test', null, 'cargo not found: install Rust with rustup (https://rustup.rs)']);
  else {
    const hasClippy = !spawnSync('cargo', ['clippy', '--version'], { stdio: 'ignore' }).status;
    const hasFmt = !spawnSync('cargo', ['fmt', '--version'], { stdio: 'ignore' }).status;
    s.fix = hasFmt ? ['cargo', 'fmt', '--all', ...mp] : null;
    s.steps.push(['format', hasFmt ? ['cargo', 'fmt', '--all', ...mp, '--', '--check'] : null, hasFmt ? cargoManifest : 'rustfmt missing: rustup component add rustfmt']);
    s.steps.push(['lint', hasClippy ? ['cargo', 'clippy', ...mp, '--workspace', '--all-targets', '--', '-D', 'warnings'] : null,
      hasClippy ? `${cargoManifest} (clippy, warnings are errors)` : 'clippy missing: rustup component add clippy']);
    s.steps.push(['test', ['cargo', 'test', ...mp, '--workspace'], cargoManifest]);
    s.steps.push(['build', ['cargo', 'build', ...mp, '--workspace'], cargoManifest]);
  }
  stacks.push(s);
}

if (existsSync('pyproject.toml') || existsSync('requirements.txt') || existsSync('setup.py')) {
  const s = { id: 'python', steps: [] };
  const pyproject = read('pyproject.toml');
  const prefix = existsSync('uv.lock') ? ['uv', 'run'] : existsSync('poetry.lock') ? ['poetry', 'run'] : [];
  const tool = (bin, configured) => configured && (prefix.length || onPath(bin));
  const deps = pyproject + read('requirements.txt') + read('requirements-dev.txt');
  const ruff = tool('ruff', /\[tool\.ruff/.test(pyproject) || existsSync('ruff.toml') || existsSync('.ruff.toml') || /\bruff\b/.test(deps));
  if (ruff) {
    s.fix = [...prefix, 'ruff', 'format', '.'];
    s.steps.push(['format', [...prefix, 'ruff', 'format', '--check', '.'], 'ruff']);
    s.steps.push(['lint', [...prefix, 'ruff', 'check', '.'], 'ruff']);
  }
  if (tool('mypy', /\[tool\.mypy/.test(pyproject) || existsSync('mypy.ini'))) s.steps.push(['typecheck', [...prefix, 'mypy', '.'], 'mypy']);
  else if (tool('pyright', /\[tool\.pyright/.test(pyproject) || existsSync('pyrightconfig.json'))) s.steps.push(['typecheck', [...prefix, 'pyright'], 'pyright']);
  const hasTests = existsSync('tests') || existsSync('test') || /\[tool\.pytest/.test(pyproject) || existsSync('pytest.ini')
    || readdirSync('.').some(f => /^test_.*\.py$|_test\.py$/.test(f));
  if (hasTests) s.steps.push(['test', prefix.length ? [...prefix, 'pytest'] : ['python3', '-m', 'pytest'], 'pytest']);
  stacks.push(s);
}

if (existsSync('go.mod')) {
  const s = { id: 'go', steps: [] };
  if (!onPath('go')) s.steps.push(['test', null, 'go not found: install Go (https://go.dev/dl)']);
  else {
    s.fix = ['gofmt', '-w', '.'];
    s.steps.push(['format', ['gofmt', '-l', '.'], 'gofmt (lists unformatted files)', 'emptyOutput']);
    s.steps.push(['lint', ['go', 'vet', './...'], 'go vet']);
    s.steps.push(['test', ['go', 'test', './...'], 'go test']);
    s.steps.push(['build', ['go', 'build', './...'], 'go build']);
  }
  stacks.push(s);
}

// One stack: plain step names (lint, test). Two or more (e.g. a Tauri app): the first keeps plain names, the others get a
// suffix (test:rust), and "--only test" runs all of them.
const ORDER = ['format', 'lint', 'typecheck', 'test', 'build'];
let steps = [];
stacks.forEach((s, i) => { for (const [n, c, from, mode] of s.steps) steps.push({ name: i === 0 ? n : `${n}:${s.id}`, base: n, cmd: c, from, mode }); });
steps.sort((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base));

// .claude/kit.json "checks" wins.
for (const [k, v] of Object.entries(custom)) {
  if (k === 'allowNone' || k === 'e2e' || k === 'fix') continue;
  steps = steps.filter(s => s.name !== k);
  if (v === false || v == null) continue;
  const base = k.split(':')[0];
  steps.push({ name: k, base, cmd: words(v), from: '.claude/kit.json checks' });
}
steps.sort((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base));

const fixes = custom.fix ? [words(custom.fix)] : stacks.map(s => s.fix).filter(Boolean);
const all = [];
if (flag('--fix')) fixes.forEach((c, i) => all.push({ name: i ? `fix:${i + 1}` : 'fix', base: 'fix', cmd: c, from: 'auto-fix' }));
for (const s of steps) if (!(flag('--fast') && s.base === 'build')) all.push(s);
if (existsSync('scripts/learned-checks.mjs')) all.push({ name: 'learned', base: 'learned', cmd: ['node', 'scripts/learned-checks.mjs'], from: 'kit' });
if (existsSync('scripts/quality-ratchet.mjs')) all.push({ name: 'ratchet', base: 'ratchet', cmd: ['node', 'scripts/quality-ratchet.mjs', '--check', '--why'], from: 'kit (report only)' });
if (existsSync('scripts/floor-guard.mjs')) all.push({ name: 'floor', base: 'floor', cmd: ['node', 'scripts/floor-guard.mjs', '--worktree'], from: 'kit (report only here)' });
const wantE2e = flag('--e2e') || only.includes('e2e');
const playwright = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(existsSync);
if (wantE2e) {
  if (custom.e2e) all.push({ name: 'e2e', base: 'e2e', cmd: [...words(custom.e2e), ...specs], from: '.claude/kit.json checks.e2e' });
  else if (playwright) {
    if (existsSync('supabase/config.toml')) all.push({ name: 'database', base: 'e2e', cmd: 'database', from: 'local Supabase' }); // local stack only, never a linked or remote project
    all.push({ name: 'browser', base: 'e2e', cmd: ['npx', '--no-install', 'playwright', 'install', 'chromium'], from: 'Playwright' }); // matches the installed Playwright version
    all.push({ name: 'e2e', base: 'e2e', cmd: ['npx', '--no-install', 'playwright', 'test', '--reporter=line', ...(specs.length ? ['--max-failures=1'] : []), ...specs], from: 'Playwright' });
  } else all.push({ name: 'e2e', base: 'e2e', cmd: null, from: 'no end-to-end checks here: add a Playwright config (web UI) or "e2e" to .claude/kit.json checks (e.g. "cargo test --test cli")' });
}

const real = steps.filter(s => ['format', 'lint', 'typecheck', 'test'].includes(s.base));
if (flag('--list')) {
  console.log(`stacks: ${stacks.map(s => s.id).join(', ') || 'none found'}`);
  for (const s of all) console.log(`${s.name.padEnd(16)} ${s.cmd ? (s.cmd === 'database' ? 'supabase status / start' : s.cmd.join(' ')) : 'MISSING'}  (${s.from})`);
  if (!real.length && !custom.allowNone) console.log('WARNING: no format, lint, typecheck or test step: a full run fails until .claude/kit.json "checks" names them');
  process.exit(0);
}

const picked = s => only.some(o => s.name === o || s.base === o || s.name.startsWith(`${o}:`));
const chosen = (only.length ? all.filter(picked) : all).filter(s => !skip.some(k => s.name === k || s.base === k));
let failed = 0;
if (!only.length && !real.length && !custom.allowNone) {
  failed++;
  console.log(`FAIL checks: no format, lint, typecheck or test step found (stacks: ${stacks.map(s => s.id).join(', ') || 'none'}). `
    + 'Name the commands in .claude/kit.json "checks" (e.g. {"test": "cargo test"}), or set "allowNone": true for a repo with no code.');
}
if (!chosen.length) { console.log(only.length ? `check: no step "${only.join(',')}" in this repo (see --list)` : `check: ${failed ? 'nothing checked' : 'nothing to run'}`); process.exit(only.length || failed ? 1 : 0); }
mkdirSync('.trash/logs', { recursive: true });
const exec = c => spawnSync(c[0], c.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', CARGO_TERM_COLOR: 'never', CI: process.env.CI || '' } });
for (const { name, cmd, from, mode } of chosen) {
  const t = Date.now();
  let r;
  if (!cmd) { failed++; console.log(`FAIL ${name}: ${from}`); continue; }
  if (cmd === 'database') { // local Supabase must be up for e2e: start it when `supabase status` says it is not
    const bin = spawnSync('supabase', ['--version']).error ? ['npx', '--no-install', 'supabase'] : ['supabase'];
    r = exec([...bin, 'status']);
    if (r.status !== 0) r = exec([...bin, 'start']);
  } else r = exec(cmd);
  if (r.error && r.status == null) r = { status: 127, stdout: '', stderr: `${cmd[0]}: ${r.error.code === 'ENOENT' ? 'command not found' : r.error.message}` };
  if (mode === 'emptyOutput' && r.status === 0 && String(r.stdout).trim()) r = { status: 1, stdout: `not formatted:\n${r.stdout}`, stderr: '' };
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  writeFileSync(`.trash/logs/${name.replace(/[^\w.-]/g, '_')}.log`, out);
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status === 0) { console.log(`PASS ${name} (${secs}s)`); continue; }
  if (name === 'ratchet') { console.log(`NOTE ratchet (report only, ${secs}s): a tracked number got worse; /deliver puts it on the Debt list. Details: .trash/logs/ratchet.log`); continue; }
  if (name === 'floor' && r.status === 1) { console.log(`NOTE floor (${secs}s): the change lowers the bar; the commit will be refused unless it is fixed or has a Floor-exception line:`); console.log(out.trim().split('\n').slice(0, 12).map(l => `  ${l}`).join('\n')); continue; }
  failed++;
  console.log(`FAIL ${name} (exit ${r.status ?? r.signal}, ${secs}s) - last lines, full log .trash/logs/${name.replace(/[^\w.-]/g, '_')}.log:`);
  console.log(out.trim().split('\n').slice(-15).map(l => `  ${l}`).join('\n'));
  if (name === 'browser' || name === 'database') break; // no browser or database, no e2e
}
console.log(failed ? `check: ${failed} step(s) failed` : 'check: all passed');
process.exit(failed ? 1 : 0);
