#!/usr/bin/env node
// PreToolUse guard (project-setup v6.0). Exit 2 = block (stderr goes to Claude). Exit 0 = allow.
// - Never: force push, hard reset, deploys, publishing packages, live database, opening PRs, printing secrets.
// - Push: only when Kim's current message says "I authorize".
// - Protected toolkit files: only with "I authorize" or during a /project-setup run.
// - Git identity: may only be set to Kim's own (.claude/identity.json), except during a /project-setup run.
// - Deleting: never rm. A plain rm/rmdir/unlink becomes `node scripts/trash.mjs` (no approval prompt, undoable until the next commit).
// Wrapped commands (bash -c, eval, env, timeout, xargs, /usr/bin/git, node -e or python -c running a shell) are
// checked inside too. The guard reads command text only; git's own hooks (push gate, identity, secret scan) are the hard locks.
// Reads are never blocked except secrets. Run `node .claude/tools/test-hooks.mjs` after any change to this file.
const fs = require('fs');
const path = require('path');
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const block = what => { console.error(`BLOCKED by project guard: ${what}`); process.exit(2); };
  const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return {}; } };

  // Unlocks written by prompt.js (Kim's own messages only), one file per session.
  const sid = String(input.session_id || '').replace(/[^\w-]/g, '_') || 'none';
  let auth = readJson(`.claude/state/auth/${sid}.json`);
  if (!auth.session) { // hooks before v5.1 kept one shared file
    auth = readJson('.claude/state/auth.json');
    if (auth.at && auth.edit && !auth.setupAt) auth = { session: auth.session, setupAt: auth.at }; // v3.0 format
  }
  const sameSession = auth.session === input.session_id;
  const within = (t, min) => typeof t === 'number' && Date.now() - t < min * 60 * 1000;
  const canPush = sameSession && within(auth.authorizeAt, 30);
  const canSetup = sameSession && within(auth.setupAt, 120);
  const canEditProtected = canPush || canSetup;
  const id = readJson('.claude/identity.json');

  const PROTECTED = [/(^|\/)\.claude\/hooks\//, /(^|\/)\.claude\/settings(\.local)?\.json$/, /(^|\/)\.claude\/state(\/|$)/,
    /(^|\/)\.claude\/(identity|git|kit)\.json$/, /(^|\/)quality-baseline\.json$/,
    /(^|\/)scripts\/(quality-ratchet|commit-identity|secret-scan|check|trash|swarm|learned-checks|push-gate|floor-guard|report)\.mjs$/,
    /(^|\/)scripts\/learned-checks\.json$/, /(^|\/)\.husky(\/|$)/, /(^|\/)\.githooks(\/|$)/];
  const isProtected = p => PROTECTED.some(re => re.test(String(p).replace(/\\/g, '/').replace(/^['"]|['"]$/g, '')));
  const lockedMsg = 'Kim unlocks it with "I authorize" or /project-setup.';
  const ENV_FILE = /(^|[\s'"=:(,\/])\.env(?!\.example\b)(\.[\w*.-]*|\*)?(?=$|[\s'"),;|&])/;
  const isEnvPath = p => /^\.env(?!\.example$)/.test(String(p).replace(/\\/g, '/').split('/').pop());

  if (tool !== 'Bash') {
    const p = ti.file_path || ti.notebook_path || ti.path || '';
    if (/^(Read|Grep|Glob|NotebookRead)$/.test(tool)) { // reads: only secrets are off limits
      if ([p, ti.glob, tool === 'Glob' ? ti.pattern : ''].some(x => x && isEnvPath(x)))
        block('reading secrets (.env files). Ask Kim for what you need, or read .env.example.');
      process.exit(0);
    }
    if (p && isProtected(p) && !canEditProtected) block(`editing a protected file (${p}). ${lockedMsg}`);
    process.exit(0);
  }

  // Commands hidden inside other commands: bash -c '...', eval '...', and the strings a node/python/perl one-liner runs.
  const innerCommands = text => {
    const out = [];
    for (const m of text.matchAll(/\b(?:bash|sh|zsh|dash|ksh|fish)\s+(?:-[a-zA-Z]+\s+)*?-[a-zA-Z]*c[a-zA-Z]*\s+(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) out.push(m[2]);
    for (const m of text.matchAll(/\beval\s+(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) out.push(m[2]);
    if (/(child_process|exec(Sync|File|FileSync)?\s*\(|spawn(Sync)?\s*\(|os\.system|subprocess|popen|system\s*\(|\$\(|`)/.test(text))
      for (const m of text.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) if (/\s/.test(m[2])) out.push(m[2]);
    return out;
  };
  // Wrappers that only run the command after them (timeout 60 git push, env git push, /usr/bin/git push, xargs git ...).
  const WRAP = /^(?:\S+=\S*\s+|(?:sudo|doas)(?:\s+-\S+)*\s+|env(?:\s+-[iu0]\S*(?:\s+(?![-\w]+=)[^\s-]\S*)?|\s+-\S+)*\s+(?=\S)|(?:command|builtin|exec|nohup|time|eval|caffeinate|stdbuf|nice|ionice|chronic|unbuffer)(?:\s+-\S+(?:\s+\d+)?)*\s+|timeout(?:\s+-\S+(?:\s+\S+)?)*\s+\S+\s+|watch(?:\s+-\S+(?:\s+\S+)?)*\s+|xargs(?:\s+-\S+(?:\s+\S+)?)*\s+)/;
  const unwrap = seg => {
    let s = seg, prev;
    do { prev = s; s = s.replace(WRAP, '').replace(/^\\/, '').replace(/^(?:\.?\/)?(?:[\w.-]+\/)*(?=[\w.-]+(\s|$))/, m => (m.includes('/') ? '' : m)); } while (s !== prev);
    return s;
  };
  const checkBash = (cmd, depth) => {
  if (depth > 3) block('a command nested more than three levels deep. Run it as one plain command.');
  // Heredoc bodies and quoted strings are text, not commands: drop them before matching command rules.
  const noHeredoc = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, '<<HEREDOC');
  for (const inner of innerCommands(noHeredoc)) checkBash(inner, depth + 1);
  const bare = noHeredoc.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const split0 = s => s.split(/\|\||&&|[;|\n`]|\$\(/).map(x => x.replace(/^[({\s]+/, '').replace(/[)}\s&]+$/, '').trim()).filter(Boolean);
  const split = s => split0(s).map(unwrap).filter(Boolean);
  const rawSegments = split0(bare);
  const segments = split(bare);
  const words = s => s.split(/\s+/).filter(Boolean);
  const isGit = s => /^(\S+=\S*\s+)*git\b/.test(s);
  const gitSub = s => (words(s.replace(/^(\S+=\S*\s+)*git\s+/, '').replace(/^((-c|-C)\s+\S+\s+|--\S+\s+)*/, ''))[0] || '');

  // 1) Never allowed.
  if (/--no-verify\b/.test(noHeredoc)) block('skipping the git hooks (--no-verify). Kim does this himself.');
  if (!canSetup && /core\.hooks[pP]ath/.test(noHeredoc) && /\bgit\b/.test(noHeredoc)) block('changing where git looks for its hooks. Kim does this himself.');
  if (/\bCLAUDECODE\s*=|\bunset\s[^;&|\n]*\bCLAUDECODE\b|-u\s*CLAUDECODE\b|process\.env\.CLAUDECODE\s*=|delete\s+process\.env\.CLAUDECODE|environ\[['"]CLAUDECODE/.test(noHeredoc))
    block('changing CLAUDECODE (the git hooks use it to know a command came from Claude).');
  if (/\bgit\b[^;&|\n]*(\s-c\s*['"]?alias\.|\bconfig\b[^;&|\n]*\balias\.)/i.test(noHeredoc)) block('defining a git alias (an alias hides the real command from the guard).');
  if (/\b(curl|wget|http|https|xh)\b[^;&|\n]*api\.github\.com[^;&|\n]*\/pulls\b/.test(noHeredoc)) block('opening a pull request through the GitHub API. This workflow has no PRs.');
  for (const s of segments) {
    if (isGit(s) && gitSub(s) === 'push' && /\s(-f|--force|--force-with-lease|--force-if-includes|--mirror|--delete|-d|--prune)\b|\s\+\S+|\s:\S+/.test(s))
      block('force push, mirror or deleting remote branches (never allowed). Kim does this himself.');
    if (isGit(s) && gitSub(s) === 'reset' && /--hard\b/.test(s)) block('git reset --hard. Kim does this himself.');
    if (isGit(s) && gitSub(s) === 'clean' && /\s-\w*f/.test(s)) block('git clean -f. Kim does this himself.');
    if (isGit(s) && gitSub(s) === 'branch' && /\s-D\b/.test(s)) block('git branch -D. Kim does this himself.');
    if (isGit(s) && /^(checkout|restore)$/.test(gitSub(s)) && /\s(--\s+)?\.(\s|$)/.test(s)) block('discarding all changes. Kim does this himself.');
    if (/--no-verify\b/.test(s) || (isGit(s) && gitSub(s) === 'commit' && /\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(s)))
      block('skipping the git hooks (commit checks). Kim does this himself.');
    if (/^(?:(?:npx|bunx|pnpx)(?:\s+-\S+)*\s+|(?:pnpm|yarn|npm)\s+(?:dlx|exec)\s+)?vercel(@\S*)?\b/.test(s) && /(--prod\b|\bdeploy\b|\bpromote\b|\brollback\b|\b(rm|remove)\b|\benv\s+(add|rm|pull)\b)/.test(s))
      block('Vercel deploys, deletes or env changes. Kim does this himself.');
    if (/^(?:(?:npx|bunx|pnpx)(?:\s+-\S+)*\s+|(?:pnpm|yarn|npm)\s+(?:dlx|exec)\s+)?supabase(@\S*)?\b/.test(s) && /(\bdb\s+push\b|--linked\b|\bprojects\s+delete\b|\bsecrets\s+set\b)/.test(s))
      block('changing the live Supabase project. Kim does this himself.');
    if (/^gh\s+pr\s+(create|merge|ready|reopen|edit)\b/.test(s) || /^gh\s+api\b.*\bpulls\b/.test(s))
      block('opening or merging a pull request. This workflow has no PRs: commit, then push on "I authorize".');
    if (/^rm\s+-\w*r\w*\s+(\/|~\/?|\$HOME\/?)(\s|$)/.test(s)) block('deleting the root or home folder.');
    if (/^(cargo(\s+\+\S+)?\s+(publish|yank|owner)\b(?!.*--dry-run)|(npm|pnpm)\s+(publish|unpublish|deprecate|dist-tag)\b(?!.*--dry-run)|yarn\s+(npm\s+)?publish\b|twine\s+upload\b|(uv|poetry|flit|hatch)\s+publish\b|gh\s+release\s+(create|upload|delete|edit)\b)/.test(s))
      block('publishing a package or a release. Kim does this himself.');
  }

  // 2) Secrets: no .env reads, no printing secret variables, no environment dumps.
  if (split(noHeredoc).some(s => ENV_FILE.test(` ${s}`) && !/^(git\s+(check-ignore|ls-files|status)|ls|test\s+-[ef]|\[\s+-[ef])\b/.test(s)))
    block('touching a secrets file (.env). Ask Kim for the value you need, or use .env.example.');
  for (const s of segments) {
    const w = words(s);
    const recursive = (w[0] === 'grep' || w[0] === 'egrep') && w.some(a => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
    const rgAll = w[0] === 'rg' && w.some(a => /^-[a-zA-Z]*u|^--(no-ignore|hidden)\b/.test(a));
    const paths = w.slice(1).filter(a => !a.startsWith('-'));
    const wide = paths.length < 2 || paths.slice(1).some(a => /^(\.|\.\/|\*|\.\.|~|\$PWD|\/)$/.test(a.replace(/['"]/g, '')));
    if ((recursive || rgAll) && (wide || rgAll) && !/exclude[^\s]*\.env|!\.env|-g\s*['"]?!/.test(s))
      block('a recursive search of the whole repo also reads .env files. Use the Grep tool (it skips gitignored files) or search a folder like src/.');
  }
  if (/\$\{?\w*(SECRET|TOKEN|PASSWORD|PASSWD|SERVICE_ROLE|PRIVATE_KEY|API_KEY)\w*/i.test(noHeredoc) && /\b(echo|printf|print|console\.log|cat)\b/.test(noHeredoc))
    block('printing a secret variable.');
  for (const s of segments) {
    if (/^(env|printenv|export\s+-p|set)$/.test(s)) block('dumping environment variables (they hold secrets).');
    if (/^printenv\s+\w*(SECRET|TOKEN|PASS|KEY|SERVICE_ROLE)/i.test(s)) block('printing a secret variable.');
  }

  // 3) Git identity: Kim is the only author.
  if (!canSetup) {
    for (const s of segments) {
      if (isGit(s) && gitSub(s) === 'commit' && /--author\b/.test(s)) block("committing under another author. Commits are always Kim's.");
      if (isGit(s) && /\s-c\s+(user\.|author\.|committer\.|commit\.gpgsign|core\.hookspath)/i.test(s))
        block('overriding the git identity or hooks for one command.');
    }
    for (const s of rawSegments)
      if (/(^|\s)(GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)|HUSKY)=/.test(s)) block('overriding the git identity or turning git hooks off.');
    for (const s of split(noHeredoc)) {
      if (!isGit(s) || gitSub(s) !== 'config' || /--(get|get-all|get-regexp|list|show-origin)\b|\s-l\b/.test(s)) continue;
      const m = s.match(/\s(user\.name|user\.email|author\.\w+|committer\.\w+|core\.hookspath)\s+(.+)$/i);
      if (!m) continue;
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      const ok = (/^user\.email$/i.test(m[1]) && id.email && value === id.email) || (/^user\.name$/i.test(m[1]) && id.name && value === id.name);
      if (!ok) block(`setting ${m[1]} to something other than Kim's identity (.claude/identity.json).`);
    }
  }

  // 4) Push needs "I authorize" in Kim's current message. One exception, only if Kim turned it on
  //    (.claude/git.json {"cloudBackupPush": true}): in a cloud session, pushing the session's own claude/... branch
  //    as a backup, so a reclaimed cloud VM never loses work. Never main, never force.
  const pushes = segments.filter(s => isGit(s) && gitSub(s) === 'push');
  if (pushes.length && !canPush) {
    const backupOk = process.env.CLAUDE_CODE_REMOTE === 'true' && readJson('.claude/git.json').cloudBackupPush === true
      && pushes.every(s => {
        const args = words(s.replace(/^(\S+=\S*\s+)*git\s+push\s*/, '')).filter(a => !/^(-u|--set-upstream)$/.test(a));
        if (args.some(a => a.startsWith('-')) || args.length > 2) return false;
        let ref = (args[1] || 'HEAD').replace(/^HEAD:/, '').replace(/^refs\/heads\//, '');
        if (ref === 'HEAD') ref = String(require('child_process').spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout).trim();
        return /^claude\/[\w.\/-]+$/.test(ref) && !ref.includes('..');
      });
    if (!backupOk) block('git push. Kim pushes, or says "I authorize" in his message to let you push this once.');
  }

  // 5) Protected files: block shell commands that WRITE them (reading is always fine).
  if (!canEditProtected) {
    // The kit's installer writes every protected file at once (hooks, guard, scripts): only during a setup or update run.
    if (/(^|[\s'"\/])tools\/install\.mjs\b/.test(noHeredoc) && !/\s--(dry-run|check)\b/.test(noHeredoc))
      block(`running the kit installer outside /project-setup. ${lockedMsg}`);
    const fail = f => block(`changing a protected toolkit file from the shell (${f}). ${lockedMsg}`);
    for (const m of noHeredoc.matchAll(/(?:^|[^<>\d&])(?:&|\d)?>{1,2}\|?\s*(?!&)(['"]?)([^\s;&|'"<>]+)\1/g)) if (isProtected(m[2])) fail(m[2]);
    const writesAny = /(^|[^<>&\d=])>{1,2}(?!&)|\b(tee|cp|mv|ln|install|rsync|touch|truncate|chmod|chown|dd|unlink|rm|shred)\b|\s-[a-zA-Z]*i(\s|$)|writeFile|appendFile|\.write\(/.test(noHeredoc);
    for (const s of split(noHeredoc)) {
      const m = s.match(/^(?:cd|pushd)\s+(['"]?)(.+?)\1$/);
      const dir = m && m[2].replace(/\\/g, '/').replace(/\/+$/, '');
      if (dir && writesAny && /(^|\/)(\.claude|\.husky|\.githooks|scripts)(\/|$)/.test(dir)) fail(`${dir} (cd into a kit folder, then write)`);
    }
    for (const s of split(noHeredoc)) {
      const w = words(s.replace(/^(sudo\s+|\S+=\S*\s+)*/, ''));
      const [c] = w;
      const args = w.slice(1).filter(a => !a.startsWith('-'));
      const hit = list => list.find(isProtected);
      if (/^(rm|unlink|truncate|touch|chmod|chown|shred|tee)$/.test(c) && hit(args)) fail(hit(args));
      if (/^(cp|install|rsync)$/.test(c) && args.length >= 2 && isProtected(args[args.length - 1])) fail(args[args.length - 1]);
      if (c === 'ln' && hit(args)) fail(hit(args));
      if (c === 'mv' && hit(args)) fail(hit(args));
      if ((c === 'sed' || c === 'perl') && w.some(a => /^-[a-zA-Z]*i/.test(a)) && hit(args)) fail(hit(args));
      if (c === 'dd') { const of = w.find(a => a.startsWith('of=')); if (of && isProtected(of.slice(3))) fail(of.slice(3)); }
      if (c === 'git' && /^(checkout|restore|rm|mv|apply)$/.test(w[1] || '') && hit(args.slice(1))) fail(hit(args.slice(1)));
      if (c === 'node' && /(^|\/)scripts\/trash\.mjs$/.test(w[1] || '') && hit(args.slice(1))) fail(hit(args.slice(1)));
      if (/^(node|python3?|ruby|perl|deno|bun)$/.test(c) && /\s(-e|-c|-p|--eval)\s/.test(` ${s} `)
        && /(writeFile|appendFile|unlink|rmSync|renameSync|copyFile|createWriteStream|open\([^)]*['"][wa]\+?['"]|\.write\()/.test(s)) {
        const target = s.split(/[\s'"`(),]+/).find(isProtected);
        if (target) fail(target);
      }
    }
  }

  // 6) Deleting goes through the trash script: rm asks Kim for approval (in every mode when a variable is involved)
  //    and cannot be undone. One plain rm/rmdir/unlink is rewritten to the script; anything fancier is blocked with the fix.
  const delWord = s => (words(s.replace(/^(sudo\s+|\S+=\S*\s+)*/, ''))[0] || '');
  const findDelete = s => /^(find|fd)\b/.test(s) && /\s(-delete|-exec(dir)?\s+(rm|rmdir|unlink|shred))\b/.test(s);
  const xargsDelete = s => /^xargs\b.*\s(rm|rmdir|unlink|shred)\b/.test(s);
  if (segments.some(s => /^(rm|rmdir|unlink|shred)$/.test(delWord(s)) || findDelete(s) || xargsDelete(s))) {
    const trashJs = path.join(root, 'scripts', 'trash.mjs');
    const how = 'Delete with `node scripts/trash.mjs <path>...` as its own command (no cd, no variables, no find -delete): '
      + 'gitignored build and test output is deleted at once, anything else goes to .trash/ until the next commit.';
    if (!fs.existsSync(trashJs)) block(`rm without the trash script (scripts/trash.mjs is missing). Tell Kim to run /project-setup update. ${how}`);
    if (depth > 0 || rawSegments.some(s => /^(sudo|doas)\b/.test(s))) block(`deleting inside a wrapped command or with sudo. ${how}`);
    const one = split(noHeredoc);
    const simple = one.length === 1 && segments.length === 1 && /^(rm|rmdir|unlink)$/.test(words(one[0])[0] || '')
      && !/[`$<>(){}]/.test(one[0].replace(/'[^']*'/g, "''"));
    if (!simple) block(`deleting with rm, find -delete or xargs rm. ${how}`);
    const tokens = (one[0].match(/'[^']*'|"(?:[^"\\]|\\.)*"|\S+/g) || []).slice(1);
    let flagsDone = false;
    const targets = tokens.filter(t => { if (!flagsDone && t === '--') { flagsDone = true; return false; } return flagsDone || !t.startsWith('-'); });
    if (!targets.length) block(`rm with no paths. ${how}`);
    const command = `node ${JSON.stringify(trashJs)} ${targets.join(' ')}`;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
      permissionDecisionReason: 'project guard: rm runs as the trash script (undoable until the next commit)',
      updatedInput: { ...ti, command } } }));
    process.exit(0);
  }
  };
  checkBash(String(ti.command || ''), 0);
  process.exit(0);
});
