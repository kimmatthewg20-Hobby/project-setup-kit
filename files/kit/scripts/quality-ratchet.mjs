#!/usr/bin/env node
// Quality ratchet (project-setup v6.0). The numbers may only get better.
// Languages: TypeScript/JavaScript (all metrics), Rust, Python and Go (size, suppressions, escape hatches, TODOs, untested
// files; the import-graph rules are TypeScript only: Rust and Go forbid circular crates/packages by themselves).
//   node scripts/quality-ratchet.mjs          pre-commit: fail if worse; if better, tighten the baseline and stage it
//   node scripts/quality-ratchet.mjs --check  CI: fail if worse, never write
//   node scripts/quality-ratchet.mjs --init   write the baseline from the current code
//   node scripts/quality-ratchet.mjs --report one-line summary (for the health log)
//   add --why to list each architecture problem
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, dirname, join, normalize } from 'node:path';

const BASE = 'quality-baseline.json';
const mode = process.argv.slice(2).find(a => a !== '--why') || '--commit';
const cfg = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
const exclude = cfg.exclude || ['node_modules/', 'dist/', 'build/', '.next/', 'coverage/', 'public/', 'scripts/', 'e2e/', 'supabase/migrations/', 'target/', '.venv/', 'venv/', 'vendor/'];
const ALWAYS_OUT = ['node_modules/', 'target/', '.venv/', '__pycache__/', '.claude/', '.github/']; // build output, installed packages and kit files, even with an older exclude list
const maxLines = cfg.maxLines || 200;

const LANG = f => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) ? 'ts' : f.endsWith('.rs') ? 'rust' : f.endsWith('.py') ? 'python' : f.endsWith('.go') ? 'go' : null;
const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n')
  .filter(f => LANG(f) && !f.endsWith('.d.ts') && ![...exclude, ...ALWAYS_OUT].some(x => f.startsWith(x) || f.includes('/' + x)) && existsSync(f));
const tsFiles = files.filter(f => LANG(f) === 'ts');
const isTest = f => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.includes('__tests__/')
  || (LANG(f) === 'rust' && /(^|\/)(tests|benches)\//.test(f))
  || (LANG(f) === 'python' && (/(^|\/)tests?\//.test(f) || /(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$/.test(f)))
  || (LANG(f) === 'go' && f.endsWith('_test.go'));
const isConfig = f => /(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)\.[^/]+rc\.[cm]?js$|(^|\/)(build\.rs|setup\.py|conftest\.py|noxfile\.py)$/.test(f);
const NO_TEST_NEEDED = /(^|\/)(page|layout|loading|error|not-found|template|default|route|middleware|index|types|constants)\.[cm]?[jt]sx?$|(^|\/)(main|lib|mod|build)\.rs$|(^|\/)src\/bin\/|(^|\/)(__init__|__main__|main|types|constants|settings)\.py$|(^|\/)(main|doc|types|constants)\.go$/;

// Per language: what counts as a suppression and as an escape hatch (code that turns the type checker or error handling off).
const RULES = {
  ts: { suppress: /@ts-ignore|@ts-nocheck|eslint-disable/g, escape: /:\s*any\b|<any>|\bas\s+any\b|any\[\]/g, todo: /\b(TODO|FIXME|HACK|XXX)\b/g },
  rust: { suppress: /#!?\[allow\(|#\[cfg_attr\([^\]]*\ballow\(/g, escape: /\.unwrap\(\)|\.expect\(/g, unsafe: /\bunsafe\s*(\{|fn\b|impl\b)/g,
    todo: /\b(TODO|FIXME|HACK|XXX)\b|\btodo!\(|\bunimplemented!\(/g },
  python: { suppress: /#\s*noqa\b|#\s*type:\s*ignore|#\s*pragma:\s*no\s*cover|#\s*pyright:\s*ignore/g, escape: /(:|->)\s*Any\b|\bAny\]/g, todo: /\b(TODO|FIXME|HACK|XXX)\b/g },
  go: { suppress: /\/\/\s*nolint\b/g, escape: /\binterface\s*\{\s*\}/g, todo: /\b(TODO|FIXME|HACK|XXX)\b/g },
};
const m = { bigFiles: 0, anyTypes: 0, suppressions: 0, todos: 0, untested: 0, archViolations: 0, cycles: 0, unwraps: 0, unsafeBlocks: 0 };
const stem = f => { const b = basename(f).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, ''); return (/\.(py|go)$/.test(b) ? b.replace(/^test_|_test(?=\.)/, '') : b).replace(/\.\w+$/, ''); };
const tests = new Set(files.filter(isTest).map(stem));
const rustTestText = files.filter(f => LANG(f) === 'rust' && isTest(f)).map(f => readFileSync(f, 'utf8')).join('\n');
for (const f of files) {
  let text = readFileSync(f, 'utf8');
  if (/(^|\n)\s*(\/\/|#)\s*@generated\b|Code generated .* DO NOT EDIT/.test(text.slice(0, 400))) continue;
  const lang = LANG(f), r = RULES[lang], test = isTest(f);
  // Rust keeps unit tests in the same file, under #[cfg(test)]: they count as test code, not as the file's size or its unwraps.
  let inlineTests = false;
  if (lang === 'rust') { const at = text.search(/#\[cfg\(test\)\]/); inlineTests = at >= 0 || /#\[test\]/.test(text); if (at >= 0) text = text.slice(0, at); }
  if (!test && !isConfig(f) && text.split('\n').length > maxLines) m.bigFiles++;
  if (lang === 'ts' ? /\.tsx?$/.test(f) : !test) m.anyTypes += lang === 'rust' ? 0 : (text.match(r.escape) || []).length;
  if (lang === 'rust' && !test) { m.unwraps += (text.match(r.escape) || []).length; m.unsafeBlocks += (text.match(r.unsafe) || []).length; }
  m.suppressions += (text.match(r.suppress) || []).length;
  m.todos += (text.match(r.todo) || []).length;
  // Logic files need a test; UI files (.tsx/.jsx) are covered by the e2e checks. Rust: a #[test] in the file, or a tests/ file
  // that names the module.
  if (test || isConfig(f) || /\.[jt]sx$/.test(f) || NO_TEST_NEEDED.test(f)) continue;
  if (lang === 'rust') { if (!inlineTests && /\bfn\s+\w/.test(text) && !new RegExp(`\\b${stem(f)}\\b`).test(rustTestText)) m.untested++; }
  else if (!tests.has(stem(f))) m.untested++;
}
// Architecture rules (import graph, any TypeScript version, no packages):
//  feature internals are private (other features go through index), shared UI has no data access,
//  app code never imports tests, and no circular imports.
const fileSet = new Set(tsFiles);
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const resolve = (from, spec) => {
  let base;
  if (spec.startsWith('.')) base = normalize(join(dirname(from), spec));
  else if (spec.startsWith('@/')) base = 'src/' + spec.slice(2);
  else return null;
  for (const e of EXT) if (fileSet.has(base + e)) return base + e;
  return null;
};
const graph = new Map();
const feat = f => (/^src\/features\/([^/]+)\//.exec(f) || [])[1];
const archList = [];
for (const f of tsFiles) {
  const text = readFileSync(f, 'utf8');
  const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map(x => x[1]);
  const deps = [];
  for (const s of specs) {
    const to = resolve(f, s);
    if (to) deps.push(to);
    const tf = to && feat(to), ff = feat(f);
    if (to && tf && ff && tf !== ff && !/\/index\.[cm]?[jt]sx?$/.test(to)) archList.push(`${f} -> ${to} (feature internals are private)`);
    if (f.startsWith('src/components/ui/') && ((to && /^src\/(lib\/(db|supabase)|features\/[^/]+\/(actions|queries))/.test(to)) || s.startsWith('@supabase/')))
      archList.push(`${f} -> ${to || s} (shared UI has no data access)`);
    if (to && isTest(to) && !isTest(f)) archList.push(`${f} -> ${to} (app code imports a test)`);
  }
  graph.set(f, deps);
}
m.archViolations = archList.length;
// Files caught in import cycles (Tarjan's strongly connected components).
let idx = 0; const st = [], on = new Set(), num = new Map(), low = new Map();
const strong = v => {
  num.set(v, idx); low.set(v, idx++); st.push(v); on.add(v);
  for (const w of graph.get(v) || []) {
    if (!num.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), num.get(w)));
  }
  if (low.get(v) === num.get(v)) { const comp = []; let w; do { w = st.pop(); on.delete(w); comp.push(w); } while (w !== v);
    if (comp.length > 1) { m.cycles += comp.length; archList.push(`cycle: ${comp.join(' -> ')}`); } }
};
for (const f of tsFiles) if (!num.has(f)) strong(f);
if (process.argv.includes('--why')) console.log(archList.join('\n') || 'no architecture problems');

const cov = 'coverage/coverage-summary.json';
if (existsSync(cov)) { try { m.coverage = JSON.parse(readFileSync(cov, 'utf8')).total.lines.pct; } catch {} }
const HIGHER_IS_BETTER = new Set(['coverage']);
const LABEL = { bigFiles: `files over ${maxLines} lines`, anyTypes: '`any` types (Python Any, Go interface{})', suppressions: 'suppressions (ts-ignore, eslint-disable, #[allow], noqa, nolint)',
  unwraps: 'Rust .unwrap() / .expect() outside tests', unsafeBlocks: 'Rust unsafe blocks',
  todos: 'TODO/FIXME', untested: 'source files without a test', archViolations: 'architecture rule breaks (run with --why)',
  cycles: 'files in import cycles (run with --why)', coverage: 'line coverage %' };

const save = metrics => writeFileSync(BASE, JSON.stringify({ ...cfg, exclude, maxLines, metrics, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
if (mode === '--init') { save(m); console.log('quality baseline written:', JSON.stringify(m)); process.exit(0); }
const base = cfg.metrics;
if (!base) { console.error('No quality baseline. Run: node scripts/quality-ratchet.mjs --init'); process.exit(mode === '--check' ? 1 : 0); }
if (mode === '--report') { console.log(Object.entries(m).map(([k, v]) => `${k} ${v}${base[k] != null && base[k] !== v ? ` (was ${base[k]})` : ''}`).join(' · ')); process.exit(0); }

const worse = [], better = {};
for (const [k, v] of Object.entries(m)) {
  if (base[k] == null) { better[k] = v; continue; }
  const up = HIGHER_IS_BETTER.has(k);
  if (up ? v < base[k] - 0.5 : v > base[k]) worse.push(`  ${LABEL[k]}: ${base[k]} -> ${v}`);
  else if (up ? v > base[k] : v < base[k]) better[k] = v;
}
if (worse.length) {
  console.error('Quality ratchet: this change makes the codebase worse. Fix these before committing:\n' + worse.join('\n'));
  process.exit(1);
}
if (mode !== '--check' && Object.keys(better).length) {
  save({ ...base, ...better });
  try { execSync(`git add ${BASE}`); } catch {}
  console.log('Quality ratchet: improved, baseline tightened:', JSON.stringify(better));
}
process.exit(0);
