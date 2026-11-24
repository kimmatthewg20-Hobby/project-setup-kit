#!/usr/bin/env node
// Secret scan (project-setup v3): pre-commit check on staged files. Blocks keys, tokens and .env files.
// AI notes (.claude/, .scratch/) are committed in cloud mode, so they are scanned like code.
// A line that is a known false alarm can end with the comment: secret-scan: allow
import { execFileSync } from 'node:child_process';

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bsk-(ant-|proj-|live-)?[A-Za-z0-9_-]{20,}/, 'API secret key (sk-...)'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{16,}/, 'Stripe live key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsbp_[a-f0-9]{30,}|\bsb_secret_[A-Za-z0-9_-]{20,}/, 'Supabase secret or access token'],
  [/service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/i, 'Supabase service role key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^\s:@/]+:[^\s@/]{6,}@/, 'database URL with a password'],
  [/\b(password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'hard-coded secret value'],
];
const BLOCKED_FILE = /(^|\/)\.env(\.(?!example$)[\w.-]+)?$|\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)$/;

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
const problems = [];
for (const file of staged) {
  if (BLOCKED_FILE.test(file)) { problems.push(`${file}: secret file must never be committed`); continue; }
  let text = '';
  try { text = execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); } catch { continue; }
  if (text.includes('\u0000')) continue; // binary
  text.split('\n').forEach((line, i) => {
    if (/secret-scan: allow/.test(line)) return;
    for (const [re, what] of RULES) if (re.test(line)) { problems.push(`${file}:${i + 1}: ${what}`); break; }
  });
}
if (problems.length) {
  console.error(['Secret scan blocked this commit (never print the value; move it to .env.local or the environment):',
    ...problems.map(p => `  - ${p}`)].join('\n'));
  process.exit(1);
}
process.exit(0);
