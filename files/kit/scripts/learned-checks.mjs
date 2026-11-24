#!/usr/bin/env node
// Learned checks (project-setup v3.6): a mistake made twice becomes a check that fails the build, not a note.
//   node scripts/learned-checks.mjs                 run every rule (pre-commit, check.mjs, CI); a file that is clean now
//                                                   leaves its rule's exception list (exceptions only shrink)
//   node scripts/learned-checks.mjs --add '<json>'  add a rule: {"id","why","files":["src/**/*.tsx"],"pattern","message"}
//                                                   optional: "flags" (regex flags), "unless" (skip a file containing this regex)
//                                                   existing hits fail the add; with --grandfather they become exceptions
//   node scripts/learned-checks.mjs --list          show the rules
// Rules live in scripts/learned-checks.json. Rules are only ever added here: the guard blocks editing the file, so
// removing or loosening a rule takes Kim ("I authorize"). Prefer the linter's own rule or a test when one fits;
// this is for the patterns they cannot express.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'scripts/learned-checks.json';
const args = process.argv.slice(2);
const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { rules: [] };
const save = () => writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
const globRe = g => new RegExp(`^${g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]*)\}/g, (_, a) => `(?:${a.split(',').join('|')})`)
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?')}$`);
let all;
const repoFiles = () => all ??= execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(f => f && existsSync(f));
const hitsOf = rule => {
  const res = rule.files.map(globRe), re = new RegExp(rule.pattern, (rule.flags || '').replace('g', '')), unless = rule.unless && new RegExp(rule.unless);
  const hits = [];
  for (const f of repoFiles()) {
    if (!res.some(r => r.test(f))) continue;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (unless && unless.test(text)) continue;
    text.split('\n').forEach((l, i) => { if (re.test(l)) hits.push({ f, line: i + 1, text: l.trim().slice(0, 100) }); });
  }
  return hits;
};

if (args[0] === '--list') {
  for (const r of data.rules) console.log(`learned/${r.id}: ${r.message}  [${r.files.join(', ')}]${r.exceptions?.length ? `  (${r.exceptions.length} grandfathered)` : ''}`);
  if (!data.rules.length) console.log('no learned checks yet');
  process.exit(0);
}

if (args[0] === '--add') {
  let rule;
  try { rule = JSON.parse(args[1]); } catch { console.error('learned: --add needs one JSON argument in single quotes'); process.exit(2); }
  for (const k of ['id', 'why', 'files', 'pattern', 'message']) if (!rule[k]) { console.error(`learned: rule needs "${k}"`); process.exit(2); }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) { console.error('learned: id must be kebab-case'); process.exit(2); }
  if (data.rules.some(r => r.id === rule.id)) { console.error(`learned: ${rule.id} already exists (rules are never replaced; add a new id)`); process.exit(2); }
  if (!Array.isArray(rule.files)) rule.files = [rule.files];
  try { new RegExp(rule.pattern, (rule.flags || '').replace('g', '')); if (rule.unless) new RegExp(rule.unless); } catch (e) { console.error(`learned: bad regex: ${e.message}`); process.exit(2); }
  const hits = hitsOf(rule);
  const files = [...new Set(hits.map(h => h.f))];
  if (hits.length && !args.includes('--grandfather')) {
    console.log(`learned: ${rule.id} already has ${hits.length} hit(s). Fix them first, or add with --grandfather to list those files as exceptions:`);
    hits.slice(0, 20).forEach(h => console.log(`  ${h.f}:${h.line}  ${h.text}`));
    process.exit(1);
  }
  data.rules.push({ id: rule.id, added: new Date().toISOString().slice(0, 10), why: rule.why, files: rule.files, pattern: rule.pattern,
    ...(rule.flags ? { flags: rule.flags } : {}), ...(rule.unless ? { unless: rule.unless } : {}), message: rule.message, exceptions: files });
  save();
  console.log(`learned: added learned/${rule.id}${files.length ? ` (${files.length} file(s) grandfathered)` : ''}`);
  process.exit(0);
}

let failed = 0, tightened = false;
for (const rule of data.rules) {
  const ex = new Set(rule.exceptions || []);
  const hits = hitsOf(rule);
  const hitFiles = new Set(hits.map(h => h.f));
  const clean = [...ex].filter(f => !hitFiles.has(f));
  if (clean.length) { rule.exceptions = [...ex].filter(f => hitFiles.has(f)); tightened = true; }
  for (const h of hits.filter(h => !ex.has(h.f))) { failed++; console.log(`learned/${rule.id} ${h.f}:${h.line}  ${rule.message}\n    ${h.text}`); }
}
if (tightened) { save(); console.log('learned: exceptions that are clean now were removed'); }
if (failed) { console.log(`learned checks: ${failed} hit(s). Fix the code; never loosen a rule.`); process.exit(1); }
console.log(`learned checks: ${data.rules.length} rule(s), all clean`);
