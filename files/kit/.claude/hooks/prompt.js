#!/usr/bin/env node
// UserPromptSubmit hook (project-setup v6.0): runs only on Kim's own messages, never on tool output.
// Writes .claude/state/auth/<session>.json, which the guard reads. One file per session, so a message in another
// Claude session on this repo (a second desktop session, a cloud session) never clears this session's unlock:
//   authorizeAt - Kim's CURRENT message says "I authorize": push + protected edits, this message only (cleared by the next one)
//   setupAt     - Kim started /project-setup: protected edits + identity setup for 2 hours in this session, so his
//                 answers to setup questions do not cancel it
// Session lock: refreshes this session's note in .claude/state/sessions/ and, while another Claude session is open on
// this folder, says so once and makes /deliver, /feature and /fix wait until Kim says "go anyway".
// Then prints the one-line Router reminder.
const fs = require('fs');
const path = require('path');
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const text = String(input.prompt || input.user_prompt || '');
  const session = input.session_id || '';
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const dir = path.join(root, '.claude/state/auth');
  const file = path.join(dir, `${String(session).replace(/[^\w-]/g, '_') || 'none'}.json`);
  const legacyFile = path.join(root, '.claude/state/auth.json');

  const authorize = /\bi\s+authori[sz]e\b/i.test(text) && !/\b(not|n't|never)\s+authori[sz]e\b/i.test(text);
  // Typed (/project-setup, /anthropic-skills:project-setup) or expanded (<command-name>...project-setup</command-name>).
  const setup = /(^\s*|<command-name>\s*)\/?(?:[\w-]+:)?project-setup\b/i.test(text);

  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let prev = readJson(file) || {};
  const legacy = readJson(legacyFile); // hooks before v5.1 kept one shared file: this session takes its own over
  if (legacy && legacy.session === session) {
    prev = legacy.at && legacy.edit && !legacy.setupAt ? { setupAt: legacy.at } : legacy; // v3.0 format {session, at, edit}
    try { fs.rmSync(legacyFile, { force: true }); } catch {}
  }
  const next = { session, setupAt: setup ? Date.now() : prev.setupAt || null, authorizeAt: authorize ? Date.now() : null };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (next.setupAt || next.authorizeAt) fs.writeFileSync(file, JSON.stringify(next));
    else fs.rmSync(file, { force: true });
    for (const f of fs.readdirSync(dir)) { // other sessions' unlocks expire by time; drop files older than 3 hours
      const p = path.join(dir, f);
      if (p !== file && Date.now() - fs.statSync(p).mtimeMs > 3 * 60 * 60 * 1000) fs.rmSync(p, { force: true });
    }
  } catch {}

  const lock = [];
  try { // session lock (session.js writes the first note; this keeps it fresh)
    const sdir = path.join(root, '.claude/state/sessions');
    const mineFile = path.join(sdir, `${String(session).replace(/[^\w-]/g, '_') || 'none'}.json`);
    fs.mkdirSync(sdir, { recursive: true });
    const now = Date.now();
    const mine = readJson(mineFile) || { session, startedAt: now, warned: [] };
    const others = fs.readdirSync(sdir).map(f => readJson(path.join(sdir, f)) || {})
      .filter(s => s.session && s.session !== session && now - (s.seenAt || 0) < 3 * 60 * 60 * 1000);
    if (/\bgo anyway\b/i.test(text)) mine.goAnyway = true;
    const fresh = others.filter(o => !(mine.warned || []).includes(o.session));
    const build = /(^\s*\/(?:[\w-]+:)?|<command-name>\s*\/?(?:[\w-]+:)?)(deliver|feature|fix)\b/i.test(text);
    if (others.length && !mine.goAnyway && (fresh.length || build))
      lock.push(`Session lock: another Claude session is open on this folder. ${build ? 'Do not start deliver, feature or fix: ' : ''}Tell Kim in one line to close the other session, or to say "go anyway" (two sessions in one folder edit the same files and mix commits).`);
    mine.warned = [...new Set([...(mine.warned || []), ...others.map(o => o.session)])];
    fs.writeFileSync(mineFile, JSON.stringify({ ...mine, session, seenAt: now }));
  } catch {}

  let kit = {};
  try { kit = JSON.parse(fs.readFileSync(path.join(root, '.claude/kit.json'), 'utf8')); } catch {}
  const swarm = kit.swarm === true ? ` Swarm mode: independent jobs run on up to ${kit.maxAgents || 5} workers at once, each in its own worktree (deliver skill > Swarm mode).` : '';
  const lines = [...lock, `Router: pick the route for this prompt from CLAUDE.md > Router (the tier the task needs; big reads go to Explore; a new feature goes to the feature skill, a bug to the fix skill; move up a tier only after an unexpected failure). State it in one line.${swarm}`];
  if (authorize) lines.push('Kim authorized git push (no force) and protected-file edits for this message only.');
  if (setup) lines.push('Protected toolkit files are unlocked for this /project-setup run (2 hours, this session). Never push during setup.');
  console.log(lines.join('\n'));
});
