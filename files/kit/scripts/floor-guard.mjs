#!/usr/bin/env node
// Floor guard (project-setup v5.3; after Addy Osmani's constraint-driven development). Catches the cheap roads to green
// in the change itself: a silenced checker, a test made easier, a weakened config, unfinished work.
//   node scripts/floor-guard.mjs <commit-msg-file>   .husky/commit-msg, after commit-identity: checks the staged diff, blocks
//   node scripts/floor-guard.mjs --worktree          check.mjs: checks uncommitted changes (tracked and new files), reports only
// A finding that is right on purpose (a library bug, generated code) passes with one line in the commit message:
//   Floor-exception: <rule> <path> - <reason>
// Allowed exceptions are printed loudly, stay in git history, and show up in /deliver's end report and the daily report.
// Exit 0 = clean (or every finding has an exception), 1 = floor violation, 2 = could not run (never read as clean).
// Regex-shallow on purpose: it catches the shortcuts agents take, not a person hiding a change.
import { readFileSync, existsSync } from 'node:fs';
// Rules cover TypeScript/JavaScript, Rust, Python and Go.
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const worktree = argv.includes('--worktree');
const msgFile = argv.find(a => !a.startsWith('--'));
const bail = msg => { console.error(`floor-guard: ${msg}`); process.exit(2); };
const git = (args, { diffExit = false } = {}) => {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return diffExit && e.status === 1 && typeof e.stdout === 'string' ? e.stdout : null; }
};
const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('not inside a git work tree');
process.chdir(top);

let diff;
if (worktree) {
  const hasHead = git(['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  diff = git(['diff', '-M', '--unified=0', '--no-color', '--no-ext-diff', ...(hasHead ? ['HEAD'] : ['--cached']), '--']);
  if (diff === null) bail('could not read the uncommitted changes');
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (untracked === null) bail('could not list new files');
  for (const f of untracked.split('\n').filter(Boolean)) {
    const d = git(['diff', '--no-index', '--unified=0', '--no-color', '/dev/null', f], { diffExit: true });
    if (d === null) bail(`could not read new file ${f}`);
    diff += `\n${d}`;
  }
} else {
  if (!msgFile) bail('usage: floor-guard.mjs <commit-msg-file> | --worktree');
  diff = git(['diff', '--cached', '-M', '--unified=0', '--no-color', '--no-ext-diff', '--']);
  if (diff === null) bail('could not read the staged changes');
}

// Walk the diff. `---`/`+++` are headers only between a file's `diff` line and its first hunk.
const added = [], removed = [], deleted = new Set(), files = new Set();
const pathOf = s => s.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
let file = '', oldFile = '', inHeader = false;
for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) { inHeader = true; continue; }
  if (line.startsWith('@@')) { inHeader = false; continue; }
  if (inHeader) {
    if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
    else if (line.startsWith('+++ ')) {
      const n = pathOf(line.slice(4));
      file = n === '/dev/null' ? oldFile : n;
      if (n === '/dev/null') deleted.add(file);
      files.add(file);
    }
    continue;
  }
  if (line.startsWith('+')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-')) removed.push({ file, text: line.slice(1) });
}

const SKIP = /(^|\/)(\.claude|\.scratch|\.trash|docs|node_modules|target)\/|\.(md|mdx|txt|lock|snap)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|CHANGELOG[^/]*)$|(^|\/)\.(husky|githooks)\/|(^|\/)scripts\/((quality-ratchet|commit-identity|secret-scan|check|trash|swarm|learned-checks|push-gate|floor-guard|report)\.mjs|learned-checks\.json)$/; // kit files: the guard protects them
const CODE = /\.(m?[jt]sx?|c[jt]s|py|go|rs|rb|java|kts?|swift|php|cs|vue|svelte|astro|sql|sh)$/;
const CONFIG = /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|\.?eslint[^/]*|biome\.jsonc?|\.oxlintrc[^/]*|(vitest|vite|jest|playwright)\.config\.[^/]+|package\.json|Cargo\.toml|\.?clippy\.toml|\.?rustfmt\.toml|\.cargo\/config(\.toml)?|pyproject\.toml|setup\.cfg|mypy\.ini|\.?ruff\.toml|pytest\.ini|tox\.ini|pyrightconfig\.json|\.golangci\.ya?ml|\.claude\/kit\.json)$/;
// Rust keeps unit tests inside the source file (#[cfg(test)]): such a file counts as a test file too.
const rustInline = f => f.endsWith('.rs') && existsSync(f) && /#\[(cfg\(test\)|test)\]/.test(readFileSync(f, 'utf8'));
const isTest = f => /(^|\/)(e2e|tests?|__tests__|benches)\/|\.(test|spec)\.|_test\.|(^|\/)test_/.test(f) || rustInline(f);
const scope = f => f === '.claude/kit.json' || (!SKIP.test(f) && (CODE.test(f) || CONFIG.test(f)));

const findings = [];
const flag = (rule, f, text) => findings.push({ rule, file: f, text: String(text).trim().slice(0, 120) });

const SILENCE = /@ts-(ignore|nocheck|expect-error)|eslint-disable|biome-ignore|oxlint-disable|#\s*noqa|#\s*type:\s*ignore|#\s*pyright:\s*ignore|#\s*pragma:\s*no\s*cover|(istanbul|c8|v8)\s+ignore|nosemgrep|gitleaks:allow|\bas\s+any\b|#!?\[allow\(|#\[cfg_attr\([^\]]*\ballow\(|#\[expect\(|\/\/\s*nolint\b/;
const EASIER = /\b(it|test|describe|suite)\.(skip|only|todo|fixme)\s*\(|\bx(it|describe|test)\s*\(|\btest\.fail\s*\(|@pytest\.mark\.(skip|xfail)|\bpytest\.skip\(|\bt\.(Skip|SkipNow)\(|#\[ignore\b|#\[cfg\(any\(\)\)\]/;
const STUB = /throw\s+new\s+\w*Error\s*\(\s*['"`][^'"`]*not\s+(yet\s+)?implemented|\bunimplemented!|\btodo!\(|\bpass\s*#\s*(stub|todo)|catch\s*(\([^)]*\))?\s*\{\s*\}/i;
const LOOSE = /\b(warnings|unsafe_code|clippy::\w+|missing_docs|unused\w*|dead_code)\s*=\s*("allow"|\{[^}]*level\s*=\s*"allow")|-A\s*warnings|--cap-lints|\b(ignore_errors|ignore_missing_imports)\s*=\s*[Tt]rue|\bstrict\s*=\s*(false|False)|\bdisable-all\s*:\s*true|"allowNone"\s*:\s*true|"(test|lint|typecheck|format)[\w:]*"\s*:\s*false|"strict"\s*:\s*false|"(noImplicitAny|strictNullChecks|noUncheckedIndexedAccess|noUnusedLocals|noUnusedParameters|noFallthroughCasesInSwitch)"\s*:\s*false|:\s*\[?\s*["'](off)["']|"level"\s*:\s*"off"|\bretries\s*:\s*[1-9]|passWithNoTests|\|\|\s*(true|exit 0)\b|--no-verify/;

const byFile = new Map();
for (const a of added) if (scope(a.file)) (byFile.get(a.file) || byFile.set(a.file, []).get(a.file)).push(a.text);
for (const [f, lines] of byFile) {
  const config = CONFIG.test(f);
  lines.forEach((t, i) => {
    if (!config && SILENCE.test(t)) flag('silenced-checker', f, t);
    if (!config && EASIER.test(t)) flag('test-made-easier', f, t);
    if (!config && STUB.test(t)) flag('unfinished-work', f, t);
    if (!config && /catch\s*(\([^)]*\))?\s*\{\s*$/.test(t) && /^\s*\}/.test(lines[i + 1] || '')) flag('unfinished-work', f, `${t.trim()} } (empty catch)`);
    if (config && LOOSE.test(t)) flag('config-loosened', f, t);
  });
}
for (const f of deleted) if (scope(f) && isTest(f)) flag('test-deleted', f, 'test file deleted (a rename is fine)');
const ASSERT = /\b(expect|assert\w*)!?\s*\(|\.should\b|\bt\.(is|deepEqual|true|false|throws|Error|Errorf|Fatal|Fatalf)\(|\b(assert|require)\.\w+\(|^\s*assert\s+[^=(]|\bdebug_assert\w*!\(/gm;
const count = list => list.reduce((n, l) => n + (l.text.match(ASSERT) || []).length, 0);
for (const f of files) {
  if (deleted.has(f) || !scope(f) || !isTest(f)) continue;
  const lost = count(removed.filter(r => r.file === f)) - count(added.filter(a => a.file === f));
  if (lost > 0) flag('assertion-removed', f, `${lost} fewer assertion(s) in a test that stays`);
}

const exceptions = [];
if (!worktree && existsSync(msgFile))
  for (const l of readFileSync(msgFile, 'utf8').split('\n')) {
    const m = l.match(/^Floor-exception:\s*([\w-]+)\s+(\S+)\s+-\s+(.{10,})$/i);
    if (m) exceptions.push({ rule: m[1].toLowerCase(), file: m[2], reason: m[3].trim() });
  }
const excused = f => exceptions.find(e => e.rule === f.rule && e.file === f.file);
const open = findings.filter(f => !excused(f));
for (const f of findings.filter(excused)) console.error(`floor-guard: EXCEPTION [${f.rule}] ${f.file} - ${excused(f).reason}`);
if (!open.length) { if (!findings.length && worktree) console.log('floor-guard: clean'); process.exit(0); }
console.error(`floor-guard: ${open.length} floor finding(s) - each lowers the bar:`);
for (const f of open) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
console.error(worktree
  ? 'Fix the code (type it, test it, handle the error), or, if one is right on purpose, give the commit message a line\n  Floor-exception: <rule> <path> - <reason>'
  : 'Commit refused. Fix the code, or add one line per finding that is right on purpose to the commit message:\n  Floor-exception: <rule> <path> - <reason (10+ characters)>');
process.exit(1);
