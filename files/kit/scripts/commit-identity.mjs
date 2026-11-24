#!/usr/bin/env node
// Commit identity (project-setup v3): Kim is the only author of every commit.
//   node scripts/commit-identity.mjs <msg-file>     commit-msg hook: strip AI attribution lines, check the author
//   node scripts/commit-identity.mjs --range A..B   CI: check every commit in a range
// Kim's identity comes from .claude/identity.json ({"name","email"}); without it only the attribution lines are checked.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const AI_LINE = [
  /^\s*co-authored-by:.*(anthropic\.com|\bclaude\b)/i,
  /^\s*claude-session:/i,
  /generated with \[?claude code/i,
  /^\s*https:\/\/claude\.ai\/code\/session_\S*\s*$/i,
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let id = null;
if (existsSync('.claude/identity.json')) {
  try { id = JSON.parse(readFileSync('.claude/identity.json', 'utf8')); } catch {}
}
const emailOf = ident => (ident.match(/<([^>]*)>/) || [])[1] || '';
const fail = lines => { console.error(['Commit identity check failed:', ...lines.map(l => `  - ${l}`)].join('\n')); process.exit(1); };

const args = process.argv.slice(2);
if (args[0] === '--range') {
  const range = args[1];
  const problems = [];
  const shas = git('rev-list', '--no-merges', range).split('\n').filter(Boolean);
  for (const sha of shas) {
    const [email, ...body] = git('show', '-s', '--format=%ae%n%B', sha).split('\n');
    if (id && email.toLowerCase() !== id.email.toLowerCase()) problems.push(`${sha.slice(0, 7)} author is ${email}, expected ${id.email}`);
    if (body.some(l => AI_LINE.some(re => re.test(l)))) problems.push(`${sha.slice(0, 7)} has an AI attribution line`);
  }
  if (problems.length) fail(problems);
  console.log(`commit identity ok (${shas.length} commits)`);
  process.exit(0);
}

const msgFile = args[0];
if (!msgFile) { console.error('usage: commit-identity.mjs <msg-file> | --range A..B'); process.exit(2); }
const before = readFileSync(msgFile, 'utf8');
const after = before.split('\n').filter(l => !AI_LINE.some(re => re.test(l))).join('\n')
  .replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
if (after !== before) writeFileSync(msgFile, after);
if (id) {
  const problems = [];
  const author = emailOf(git('var', 'GIT_AUTHOR_IDENT'));
  const committer = emailOf(git('var', 'GIT_COMMITTER_IDENT'));
  if (author.toLowerCase() !== id.email.toLowerCase()) problems.push(`author is ${author}, expected ${id.email}`);
  if (committer.toLowerCase() !== id.email.toLowerCase()) problems.push(`committer is ${committer}, expected ${id.email}`);
  if (problems.length) fail([...problems, `fix: git config user.name "${id.name}" && git config user.email "${id.email}"`]);
}
process.exit(0);
