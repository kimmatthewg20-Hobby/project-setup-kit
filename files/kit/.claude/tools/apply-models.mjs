// project-setup v5.2: write the five worker tiers and give each installed skill its model and effort.
// Re-run after `npx skills update` (updates overwrite the model headers).
// Fable catcher: `--no-fable` turns Fable off (top tier becomes Opus xhigh, wayfinder Opus high), `--fable` turns it
// back on. The choice is saved in .claude/models.json, so later runs (and /project-setup update) keep it.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const STATE = '.claude/models.json';
let saved = { fable: true };
try { saved = { ...saved, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch {}
if (process.argv.includes('--no-fable')) saved.fable = false;
if (process.argv.includes('--fable')) saved.fable = true;
writeFileSync(STATE, JSON.stringify({ ...saved, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
const noFable = !saved.fable;
console.log(`fable: ${noFable ? 'off (Opus stands in)' : 'on'}`);

// Five tiers, picked by the router for what the task needs; one tier up only after an unexpected failure.
const LADDER = [
  ['worker-sonnet-low', 'sonnet', 'low', 'Tier 1. Mechanical changes with no logic (copy, docs, config, renames, styling).'],
  ['worker-sonnet', 'sonnet', 'medium', 'Tier 2. Normal features, UI, tests and fixes with a known cause.'],
  ['worker-opus', 'opus', 'medium', 'Tier 3. Risky or large work: auth, permissions and RLS, personal data, payments, migrations, secrets, or 6+ files.'],
  ['worker-opus-high', 'opus', 'high', 'Tier 4. Risky work with an unclear approach, or a tier-3 job that failed unexpectedly.'],
  noFable
    ? ['worker-fable', 'opus', 'xhigh', 'Tier 5 (no Fable on this account: Opus xhigh). Cross-module architecture changes, or a job two Opus rounds could not finish.']
    : ['worker-fable', 'fable', 'medium', 'Tier 5. Cross-module architecture changes, or a job two Opus rounds could not finish.'],
];
const body = readFileSync('.claude/tools/worker-body.md', 'utf8');
mkdirSync('.claude/agents', { recursive: true });
for (const f of readdirSync('.claude/agents')) if (/^worker-.*\.md$/.test(f)) rmSync(`.claude/agents/${f}`);
for (const [name, model, effort, desc] of LADDER) {
  writeFileSync(`.claude/agents/${name}.md`,
    `---\nname: ${name}\ndescription: ${desc} Gets one self-contained job from the router or /deliver.\n` +
    `tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch\nmodel: ${model}\neffort: ${effort}\n---\n\n${body}`);
}
console.log(`workers written: ${LADDER.length}`);

// Skill models: judgment and planning on Opus, scoped and repeated work on Sonnet.
const fableOr = (m, e) => (noFable ? ['opus', 'high'] : [m, e]);
const map = {
  'grill-with-docs': ['opus', 'medium'], grilling: ['opus', 'medium'], 'domain-modeling': ['opus', 'medium'],
  'improve-codebase-architecture': ['opus', 'medium'], 'codebase-design': ['opus', 'medium'],
  wayfinder: fableOr('fable', 'medium'),
  'diagnosing-bugs': ['opus', 'high'],
  'to-spec': ['sonnet', 'medium'], 'to-tickets': ['sonnet', 'medium'], implement: ['sonnet', 'medium'],
  tdd: ['sonnet', 'medium'], 'code-review': ['sonnet', 'medium'], 'setup-matt-pocock-skills': ['sonnet', 'medium'],
  research: ['sonnet', 'low'], prototype: ['sonnet', 'low'], deliver: ['sonnet', 'medium'], 'verify-ticket': ['sonnet', 'medium'],
  'wait-what': ['sonnet', 'low'], 'writing-for-agents': ['sonnet', 'medium'], 'create-verification-skill': ['opus', 'medium'],
  'maintain-verification-skill': ['sonnet', 'medium'], reflect: ['sonnet', 'medium'], feature: ['opus', 'medium'],
  fix: ['opus', 'high'], report: ['sonnet', 'low'], webperf: ['sonnet', 'medium'],
};
let done = 0;
for (const [name, [model, effort]] of Object.entries(map)) {
  const f = `.claude/skills/${name}/SKILL.md`;
  if (!existsSync(f)) { console.log(`missing: ${name}`); continue; }
  const text = readFileSync(f, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { console.log(`no frontmatter: ${name}`); continue; }
  const lines = m[1].split('\n').filter(l => !/^(model|effort):/.test(l));
  lines.push(`model: ${model}`, `effort: ${effort}`);
  writeFileSync(f, `---\n${lines.join('\n')}\n---\n` + text.slice(m[0].length));
  done++;
}
console.log(`models set on ${done} skills`);
