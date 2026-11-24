#!/usr/bin/env node
// Daily report (project-setup v6.0): one page on what shipped, what is blocked and how the debt moved.
// Reads only: git history, runs.log, ticket files and the Debt list in .claude/memory/health.md. Changes nothing.
//   node scripts/report.mjs              the last 24 hours
//   node scripts/report.mjs --days 7     the last 7 days (a weekly look)
//   node scripts/report.mjs --save       also save it to .claude/state/reports/<date>.md (local, not committed)
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const days = argv.includes('--days') ? Math.max(Number(argv[argv.indexOf('--days') + 1]) || 1, 0.01) : 1;
const since = Date.now() - days * 24 * 60 * 60 * 1000;
const sinceDay = new Date(since).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const git = args => { try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const cap = (list, n = 8) => (list.length > n ? [...list.slice(0, n), `- ... and ${list.length - n} more`] : list);
if (git(['rev-parse', '--show-toplevel']) === null) { console.log('report: not a git repo'); process.exit(2); }

// Commits in the window.
const commits = (git(['log', `--since=@${Math.floor(since / 1000)}`, '--format=%h%x1f%s%x1f%b%x1e']) || '')
  .split('\x1e').map(r => r.trim()).filter(Boolean).map(r => { const [sha, subject, body] = r.split('\x1f'); return { sha, subject, body: body || '' }; });
const runs = read('.claude/memory/runs.log').split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p.length >= 8);
const run = (feature, nn) => runs.filter(p => p[1] === feature && p[2] === nn).pop();
const ticketFolder = (nn, title) => { // commit without its ticket file: find the ticket by number and title
  const hits = [];
  const walk = dir => { if (!existsSync(dir)) return; for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory() && d.name === 'issues') { for (const f of readdirSync(p)) if (f.startsWith(`${nn}-`) && read(join(p, f)).includes(title)) hits.push(dir.replace(/^\.scratch\//, '')); }
    else if (d.isDirectory()) walk(p);
  } };
  walk('.scratch');
  return hits.length === 1 ? hits[0] : '';
};
const tickets = [], learned = [], other = { chore: 0, plan: 0, other: 0 };
for (const c of commits) {
  const m = c.subject.match(/^(\d+):\s*(.+)$/);
  if (m) {
    const files = (git(['show', '--name-only', '--format=', c.sha]) || '').split('\n');
    const t = files.map(f => f.match(/^\.scratch\/(.+)\/issues\/\d+-[^/]+\.md$/)).find(Boolean);
    const feature = t ? t[1] : ticketFolder(m[1], m[2]);
    const r = run(feature, m[1]);
    tickets.push(`- ${feature ? `${feature} ` : ''}${m[1]} ${m[2]}${r ? ` · ${r[4].replace(/start tier (\d) → end tier (\d)/, (s, a, b) => (a === b ? `tier ${a}` : `tier ${a}→${b}`))} · ${r[5]} · ${r[6]}` : ''} (${c.sha})`);
  } else if (/^chore: learned check\s+/.test(c.subject)) learned.push(c.subject.replace(/^chore: learned check\s+/, ''));
  else if (/^chore/.test(c.subject)) other.chore++;
  else if (/^plan/.test(c.subject)) other.plan++;
  else other.other++;
}
const fixes = tickets.filter(t => /^- fixes\//.test(t)).length;

// Blocked tickets (any time), newest folders first.
const blocked = [];
const scan = dir => {
  if (!existsSync(dir)) return;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory() && d.name === 'issues') {
      for (const f of readdirSync(p).filter(x => x.endsWith('.md'))) {
        const text = read(join(p, f));
        const st = text.match(/^Status:\s*blocked\b(.*)$/im);
        if (st) blocked.push(`- ${dir.replace(/^\.scratch\//, '')}/${f.replace(/\.md$/, '')}: ${(st[1] || '').replace(/^[\s:(-]+|\)$/g, '') || 'no reason given'}`);
      }
    } else if (d.isDirectory()) scan(p);
  }
};
scan('.scratch');

// Debt list: now vs at the start of the window.
const debtRows = text => {
  const sec = (text.split(/^## Debt list\s*$/m)[1] || '').split(/^## /m)[0];
  return sec.split('\n').filter(l => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/^\|\s*What\s*\|/i.test(l))
    .map(l => l.split('|').slice(1, -1).map(x => x.trim())).filter(c => c.length >= 3 && c[0])
    .map(([what, where, impact, status = '']) => ({ key: `${what}|${where}`, what, where, impact, done: /done|paid|fixed/i.test(status) }));
};
const nowRows = debtRows(read('.claude/memory/health.md'));
const startRev = (git(['rev-list', '-1', `--before=@${Math.floor(since / 1000)}`, 'HEAD']) || '').trim();
const thenRows = startRev ? debtRows(git(['show', `${startRev}:.claude/memory/health.md`]) || '') : [];
const openOf = rows => rows.filter(r => !r.done);
const byImpact = rows => ['High', 'Med', 'Low'].map(i => `${i} ${rows.filter(r => r.impact.toLowerCase().startsWith(i.toLowerCase())).length}`).join(', ');
const thenKeys = new Map(thenRows.map(r => [r.key, r]));
const grew = openOf(nowRows).filter(r => !thenKeys.has(r.key) || thenKeys.get(r.key).done);
const paid = nowRows.filter(r => r.done && thenKeys.has(r.key) && !thenKeys.get(r.key).done);
const exceptions = commits.flatMap(c => c.body.split('\n').filter(l => /^Floor-exception:/i.test(l)).map(l => `- ${c.sha} ${l.replace(/^Floor-exception:\s*/i, '')}`));
const health = read('.claude/memory/health.md').split('\n').filter(l => /^\s*-?\s*\d{4}-\d{2}-\d{2}\s*·/.test(l) && l.replace(/^\s*-?\s*/, '').slice(0, 10) >= sinceDay).pop();

// Waiting on Kim.
const upstream = git(['rev-parse', '--abbrev-ref', '@{u}']);
const ahead = upstream ? Number((git(['rev-list', '--count', '@{u}..HEAD']) || '0').trim()) : null;
const dirty = (git(['status', '--porcelain']) || '').split('\n').filter(Boolean).length;

const out = [
  `# Report · ${today} (last ${days === 1 ? '24 hours' : `${days} days`})`,
  '',
  `## Shipped: ${tickets.length} ticket(s)${fixes ? `, ${fixes} of them fixes` : ''}`,
  ...(tickets.length ? cap(tickets) : ['- nothing committed as a ticket']),
  `- other commits: ${other.chore} chore, ${other.plan} plan, ${other.other} other${learned.length ? ` · new learned checks: ${learned.join(', ')}` : ''}`,
  '',
  `## Blocked: ${blocked.length}`,
  ...(blocked.length ? cap(blocked) : ['- none']),
  '',
  `## Debt: ${openOf(nowRows).length} open (${byImpact(openOf(nowRows))})${startRev ? `, was ${openOf(thenRows).length}` : ''}`,
  ...cap(grew.map(r => `- new: ${r.what} (${r.where}, ${r.impact || '?'})`)),
  ...cap(paid.map(r => `- paid off: ${r.what}`)),
  ...(exceptions.length ? [`- bar lowered on purpose (Floor-exception): ${exceptions.length}`, ...cap(exceptions)] : []),
  ...(health ? [`- health: ${health.replace(/^\s*-\s*/, '')}`] : []),
  '',
  '## Waiting on Kim',
  `- ${ahead === null ? 'no upstream branch' : `${ahead} commit(s) not pushed${ahead ? ' (say "push it, I authorize")' : ''}`} · ${dirty} uncommitted file(s)`,
];
const page = out.join('\n');
console.log(page);
if (argv.includes('--save')) {
  mkdirSync('.claude/state/reports', { recursive: true });
  writeFileSync(`.claude/state/reports/${today}.md`, `${page}\n`);
  console.log(`\n(saved: .claude/state/reports/${today}.md)`);
}
