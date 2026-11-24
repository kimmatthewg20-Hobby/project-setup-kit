#!/usr/bin/env node
// SessionStart hook (project-setup v6.0). Runs on Kim's Mac and in cloud sessions.
// 1) Every commit in this repo is authored by Kim (.claude/identity.json), never by Claude.
// 2) Session lock: notes this session in .claude/state/sessions/ and warns when another Claude session is open
//    on the same folder. `session.js --end` (SessionEnd hook) removes the note again.
// 3) Git hooks in .githooks/ (repos without Husky): point git at them on every machine; a fresh clone has them off.
// 4) Cloud only: install what the repo needs (npm packages, Rust crates, Go modules, git hooks, Playwright browser). Safe to re-run.
// Whatever it prints becomes context for Claude at the start of the session.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
const out = [];
const ACTIVE_MS = 3 * 60 * 60 * 1000; // a session quiet for 3 hours (or one that crashed) no longer counts
const sessionsDir = path.join(root, '.claude/state/sessions');
const sidFile = sid => path.join(sessionsDir, `${String(sid).replace(/[^\w-]/g, '_')}.json`);

// The hook input (session id) comes on stdin. Run by hand there is none: never wait for it longer than a second.
let raw = '', started = false;
const begin = () => { if (started) return; started = true; let input = {}; try { input = JSON.parse(raw); } catch {} main(input); };
if (process.stdin.isTTY) begin();
else { process.stdin.on('data', d => (raw += d)).on('end', begin).on('error', begin); setTimeout(begin, 1000).unref(); }

function main(input) {
const sid = input.session_id || '';
if (process.argv.includes('--end')) { // SessionEnd: this session is gone, drop its note
  if (sid) try { fs.rmSync(sidFile(sid), { force: true }); } catch {}
  process.exit(0);
}
const run = (cmd, args, timeout = 300000) =>
  spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
const has = f => fs.existsSync(path.join(root, f));

// 1) Identity. Local repo config only (wins over the global one, e.g. the cloud default "Claude").
let id = null;
try { id = JSON.parse(fs.readFileSync(path.join(root, '.claude/identity.json'), 'utf8')); } catch {}
if (id && id.name && id.email) {
  run('git', ['config', 'user.name', id.name]);
  run('git', ['config', 'user.email', id.email]);
  // Cloud sessions sign commits with Claude's key; a signature that is not Kim's would mark his commits Unverified.
  if (cloud) run('git', ['config', 'commit.gpgsign', 'false']);
  out.push(`Git author for this repo: ${id.name} <${id.email}>. Commit and PR text: no Co-Authored-By, Claude-Session or "Generated with" lines.`);
} else {
  out.push('WARNING: .claude/identity.json missing, so commits may not be authored by Kim. Tell Kim to run /project-setup update.');
}

// 1a) Kit version: on a machine with the kit installed (~/.claude/skills/project-setup), say when this repo's kit is behind.
//     Only a notice: the repo changes when Kim runs /project-setup update, never in the middle of a session's work.
if (!cloud) {
  try {
    const installed = fs.readFileSync(path.join(require('os').homedir(), '.claude/skills/project-setup/VERSION'), 'utf8').trim();
    let here = '';
    try { here = String(JSON.parse(fs.readFileSync(path.join(root, '.claude/kit.json'), 'utf8')).version || ''); } catch {}
    const num = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
    const older = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
    if (installed && (!here || older(here, installed)))
      out.push(`Kit ${here ? `v${here}` : '(older than v6)'} here, v${installed} installed: tell Kim in one line to run /project-setup update when he is ready (never update the kit yourself).`);
  } catch {}
}

// 1b) Trash: drop items older than a day (sessions without a commit, e.g. a grill or spec in local mode). Shell rules.
if (has('scripts/trash.mjs')) run('node', ['scripts/trash.mjs', '--empty', '--older-than', '24', '--quiet'], 60000);
out.push('Shell: one plain command per call from the project root (no cd prefix, no $VAR or $(...), no ; or && chains with rm). Delete with `node scripts/trash.mjs <paths>` (never rm; test and build output is deleted at once, nothing to ask). Checks: `node scripts/check.mjs` (--fast, --fix, --e2e [spec], --only <step>). Scratch files: .trash/tmp/, never /tmp or $TMPDIR.');

// 2) Cloud mode (toolkit tracked by git): plans and notes must be committed, or the other machine never sees them.
const tracked = String(run('git', ['ls-files', '.claude/memory']).stdout).trim() !== '';
if (tracked) {
  const pending = String(run('git', ['status', '--porcelain', '--untracked-files=all', '--', '.scratch', '.claude/memory',
    'CLAUDE.md', 'GLOSSARY.md', 'docs/adr', 'docs/agents']).stdout).trim().split('\n').filter(Boolean);
  if (pending.length) out.push(`Uncommitted plans/notes (${pending.length}): ${pending.slice(0, 8).map(l => l.slice(3)).join(', ')}${pending.length > 8 ? ', ...' : ''}. Commit them before other work: \`git add .scratch .claude/memory CLAUDE.md GLOSSARY.md docs/adr docs/agents\` (only paths that exist), then \`git commit -m "plan: save plans and notes"\`.`);
}

// 3) .githooks/ is the kit's hook folder in repos without Husky. core.hooksPath is local config, so every clone needs it set.
if (has('.githooks') && !has('.husky')) {
  const cur = String(run('git', ['config', '--get', 'core.hooksPath']).stdout).trim();
  if (cur !== '.githooks') {
    run('git', ['config', 'core.hooksPath', '.githooks']);
    out.push(`Git hooks: turned on (.githooks/${cur ? `, was ${cur}` : ''}).`);
  }
}

// 4) Cloud: dependencies, git hooks, Playwright browser.
if (cloud) {
  if (has('package.json')) {
    const pm = has('pnpm-lock.yaml') ? ['pnpm', ['install', '--frozen-lockfile']]
      : has('yarn.lock') ? ['yarn', ['install', '--frozen-lockfile']]
      : has('package-lock.json') ? ['npm', ['ci', '--no-audit', '--no-fund']]
      : ['npm', ['install', '--no-audit', '--no-fund']];
    if (!has('node_modules')) {
      const r = run(pm[0], pm[1], 480000);
      out.push(r.status === 0 ? `Cloud: installed dependencies (${pm[0]}).`
        : `Cloud: dependency install FAILED (${pm[0]} exit ${r.status}). Run it yourself and read the error: ${String(r.stderr).slice(-300)}`);
    } else {
      out.push('Cloud: dependencies already installed.');
    }
    // Husky sets core.hooksPath in "prepare"; without it the commit checks (ratchet, secret scan, author check) would not run.
    if (has('.husky') && !String(run('git', ['config', '--get', 'core.hooksPath']).stdout).trim()) {
      run('npx', ['--no-install', 'husky'], 60000);
    }
  }
  // Rust: fetch the crates now, so the first check does not stall on downloads.
  const cargoToml = has('Cargo.toml') ? 'Cargo.toml' : has('src-tauri/Cargo.toml') ? 'src-tauri/Cargo.toml' : null;
  if (cargoToml) {
    const v = run('cargo', ['--version'], 30000);
    if (v.error || v.status !== 0) out.push('Cloud: cargo NOT found, so the Rust checks cannot run. Kim adds to the environment setup script: curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal -c clippy,rustfmt');
    else {
      const r = run('cargo', ['fetch', '--manifest-path', cargoToml], 480000);
      out.push(r.status === 0 ? `Cloud: Rust crates fetched (${String(v.stdout).trim()}).`
        : `Cloud: cargo fetch FAILED. Likely the network allowlist: crates.io, index.crates.io, static.crates.io. ${String(r.stderr).slice(-200)}`);
    }
  }
  if (has('go.mod')) {
    const r = run('go', ['mod', 'download'], 480000);
    out.push(r.status === 0 ? 'Cloud: Go modules downloaded.' : `Cloud: go mod download FAILED (or go is missing): ${String(r.stderr || r.error || '').slice(-200)}`);
  }
  const hooksPath = String(run('git', ['config', '--get', 'core.hooksPath']).stdout).trim();
  out.push(hooksPath ? `Cloud: git hooks active (${hooksPath}).` : `Cloud: git hooks NOT active. Run ${has('.husky') ? '`npx husky`' : 'the setup update (/project-setup update)'} before committing.`);
  if (has('node_modules/@playwright/test')) {
    const r = run('npx', ['--no-install', 'playwright', 'install', 'chromium'], 240000);
    out.push(r.status === 0 ? 'Cloud: Playwright Chromium ready.'
      : 'Cloud: Playwright browser download FAILED. Likely the environment network allowlist: Kim adds cdn.playwright.dev, playwright.download.prss.microsoft.com and playwright.azureedge.net (Custom access + default list). Until then skip e2e and say so in the end report.');
  }
  out.push('Cloud: no .env files here. Test settings come from the cloud environment variables (dev database and fake test account only).');
  const branch = String(run('git', ['symbolic-ref', '--short', 'HEAD']).stdout).trim();
  let backup = false;
  try { backup = JSON.parse(fs.readFileSync(path.join(root, '.claude/git.json'), 'utf8')).cloudBackupPush === true; } catch {}
  out.push(`Cloud branch: ${branch || 'unknown'}. Commit here (no PRs). ${backup ? 'After each commit, push this branch as a backup (allowed without asking).' : 'Do not push until Kim says "I authorize"; unpushed work is lost if this VM is reclaimed, so remind Kim at the end.'} When Kim says "ship it, I authorize": git fetch origin main && git rebase origin/main && git push origin HEAD:main (rebase conflict: stop and tell Kim).`);
}

// 2) Session lock: two Claude sessions in one folder edit the same files and mix their commits.
//    Cloud sessions each have their own clone, so they never share a folder with the Mac.
if (sid) {
  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const now = Date.now(), others = [];
    for (const f of fs.readdirSync(sessionsDir)) {
      const p = path.join(sessionsDir, f);
      let s = {};
      try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      if (s.session === sid) continue;
      if (!s.session || now - (s.seenAt || 0) > ACTIVE_MS) { fs.rmSync(p, { force: true }); continue; }
      others.push(s);
    }
    let mine = {};
    try { mine = JSON.parse(fs.readFileSync(sidFile(sid), 'utf8')); } catch {}
    fs.writeFileSync(sidFile(sid), JSON.stringify({ ...mine, session: sid, startedAt: mine.startedAt || now, seenAt: now,
      warned: others.map(o => o.session) }));
    if (others.length) {
      const ago = Math.round((now - Math.max(...others.map(o => o.seenAt))) / 60000);
      out.push(`Session lock: ${others.length} other Claude session(s) open on this folder (last active ${ago} min ago). Before other work, tell Kim in one line: two sessions in one folder edit the same files and mix their commits; close the other one, or say "go anyway". /deliver, /feature and /fix wait for that answer.`);
    }
  } catch {}
}

console.log(out.join('\n'));
process.exit(0);
}
