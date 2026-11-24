#!/usr/bin/env node
// Push gate (project-setup v5.1), first line of .husky/pre-push. Git runs it however a push was typed, so it is the hard lock:
// 1) A push started by Claude Code (CLAUDECODE=1 in its commands) needs Kim's "I authorize" from the last 30 minutes
//    (.claude/state/auth/<session>.json, written only by the prompt hook from Kim's own message). Exception, only if Kim turned it on:
//    a cloud session pushing its own claude/... branch as a backup (.claude/git.json {"cloudBackupPush": true}).
// 2) Every commit being pushed is authored AND committed by Kim (.claude/identity.json) and carries no AI attribution line,
//    so GitHub lists Kim as the only contributor. This applies to Kim's own pushes too.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
const fail = msg => { console.error(`Push gate: ${msg}`); process.exit(1); };
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch {}
const refs = stdin.split('\n').filter(Boolean).map(l => l.split(' ')); // <local ref> <local sha> <remote ref> <remote sha>
const ZERO = /^0+$/;

if (process.env.CLAUDECODE === '1') {
  const auths = [readJson('.claude/state/auth.json')];
  try { for (const f of readdirSync('.claude/state/auth')) auths.push(readJson(join('.claude/state/auth', f))); } catch {}
  const authorized = auths.some(a => typeof a.authorizeAt === 'number' && Date.now() - a.authorizeAt < 30 * 60 * 1000);
  const backup = process.env.CLAUDE_CODE_REMOTE === 'true' && readJson('.claude/git.json').cloudBackupPush === true
    && refs.length > 0 && refs.every(([, , remoteRef]) => /^refs\/heads\/claude\/[\w.\/-]+$/.test(remoteRef || ''));
  if (!authorized && !backup) fail('Claude may push only after Kim says "I authorize" (in the last 30 minutes). Kim can always push himself.');
}

const id = readJson('.claude/identity.json');
const AI = /co-authored-by:.*(anthropic\.com|\bclaude\b)|^\s*claude-session:|generated with \[?claude code|claude\.ai\/code\/session_/im;
const log = range => execFileSync('git', ['log', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e', ...range],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const problems = [];
for (const [, localSha, , remoteSha] of refs) {
  if (!localSha || ZERO.test(localSha)) continue; // deleting a remote ref (the guard blocks that for Claude)
  let out = '';
  try { out = log(ZERO.test(remoteSha || '0') ? [localSha, '--not', '--remotes'] : [`${remoteSha}..${localSha}`]); }
  catch { try { out = log([localSha, '--not', '--remotes']); } catch { continue; } }
  for (const rec of out.split('\x1e').map(r => r.trim()).filter(Boolean)) {
    const [sha, an, ae, cn, ce, body] = rec.split('\x1f');
    const short = sha.slice(0, 7);
    if (id.email && ae.toLowerCase() !== id.email.toLowerCase()) problems.push(`${short} author is ${an} <${ae}>`);
    if (id.email && ce.toLowerCase() !== id.email.toLowerCase()) problems.push(`${short} committer is ${cn} <${ce}>`);
    if (AI.test(body || '')) problems.push(`${short} has an AI attribution line`);
  }
}
if (problems.length)
  fail(`only Kim (${id.email}) may appear on GitHub, so these commits stay local:\n  - ${[...new Set(problems)].slice(0, 20).join('\n  - ')}\n`
    + 'Claude: stop and tell Kim. Kim: fix them with /project-setup help, "GitHub shows only you".');
