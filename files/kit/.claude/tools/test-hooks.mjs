// project-setup v6.1: prove the guard, prompt, session and status line hooks. Runs in a throwaway copy, so it never touches this
// session's real unlock (.claude/state/auth/). Setup, Update and Check run it; it must print "all N passed".
//   node .claude/tools/test-hooks.mjs            run every case
//   node .claude/tools/test-hooks.mjs --verbose  also list passing cases
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const verbose = process.argv.includes('--verbose');
const dir = mkdtempSync(join(tmpdir(), 'hooks-test-'));
mkdirSync(join(dir, '.claude'), { recursive: true });
cpSync('.claude/hooks', join(dir, '.claude/hooks'), { recursive: true });
writeFileSync(join(dir, 'package.json'), '{"type": "module"}\n'); // hooks must still load in an ES-module repo
mkdirSync(join(dir, 'scripts'), { recursive: true });
writeFileSync(join(dir, 'scripts/trash.mjs'), '// stand-in: the guard only checks that it exists\n');
writeFileSync(join(dir, '.claude/identity.json'), JSON.stringify({ name: 'Kim Test', email: '1+kim@users.noreply.github.com' }));
const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_REMOTE: '' }; // as on Kim's Mac
const prompt = (session, text) => spawnSync('node', [join(dir, '.claude/hooks/prompt.js')], { input: JSON.stringify({ session_id: session, prompt: text }), env });
const guard = (session, tool, input) => spawnSync('node', [join(dir, '.claude/hooks/guard.js')], { input: JSON.stringify({ session_id: session, tool_name: tool, tool_input: input }), env }).status;
const bash = (session, command) => guard(session, 'Bash', { command });
const rewritten = (session, command) => { // the command the guard turns a plain rm into ('' = not rewritten)
  const r = spawnSync('node', [join(dir, '.claude/hooks/guard.js')], { input: JSON.stringify({ session_id: session, tool_name: 'Bash', tool_input: { command, description: 'd' } }), env, encoding: 'utf8' });
  try { const o = JSON.parse(r.stdout).hookSpecificOutput; return r.status === 0 && o.permissionDecision === 'allow' && o.updatedInput.description === 'd' ? o.updatedInput.command : ''; } catch { return ''; }
};
const trashCmd = targets => `node ${JSON.stringify(join(dir, 'scripts', 'trash.mjs'))} ${targets}`;
const write = (session, file_path) => guard(session, 'Write', { file_path });

mkdirSync(join(dir, '.claude/state'), { recursive: true });
for (const h of ['guard.js', 'prompt.js', 'session.js', 'statusline.js']) { // a hook that crashes on load blocks nothing: stop here
  const r = spawnSync('node', [join(dir, '.claude/hooks', h)], { input: JSON.stringify({ session_id: 's0', prompt: 'hi', tool_name: 'Bash', tool_input: { command: 'git status' } }), env, encoding: 'utf8', cwd: dir });
  if (r.status !== 0) { console.log(`FAIL ${h} does not load (exit ${r.status}): ${String(r.stderr).split('\n').find(l => /Error/.test(l)) || r.stderr}\nIs .claude/hooks/package.json ({"type": "commonjs"}) missing?`); process.exit(1); }
}
let pass = 0; const fails = [];
const expect = (label, got, want) => { if (got === want) { pass++; if (verbose) console.log(`ok   ${label}`); } else fails.push(`FAIL ${label} (got ${got}, want ${want})`); };

// Launcher (run.sh): finds Node, and with no Node the guard fails CLOSED while the other hooks only warn.
if (existsSync(join(dir, '.claude/hooks/run.sh'))) {
  const viaRun = (hook, node, args = [], input = { session_id: 'sr', tool_name: 'Bash', tool_input: { command: 'git status' } }) =>
    spawnSync('sh', [join(dir, '.claude/hooks/run.sh'), hook, ...args], { input: JSON.stringify(input), env: { ...env, KIT_HOOK_NODE: node }, encoding: 'utf8', cwd: dir });
  const real = process.execPath, none = join(dir, 'no-node-here');
  expect('launcher: guard runs through run.sh', viaRun('guard.js', real).status, 0);
  expect('launcher: guard still blocks through run.sh', viaRun('guard.js', real, [], { session_id: 'sr', tool_name: 'Bash', tool_input: { command: 'git push --force' } }).status, 2);
  const closed = viaRun('guard.js', none);
  expect('launcher: no Node = guard blocks (fail closed)', closed.status, 2);
  expect('launcher: no Node = guard says how to fix', /Node\.js was not found/.test(closed.stderr), true);
  const p = viaRun('prompt.js', none, [], { session_id: 'sr', prompt: 'hi' });
  expect('launcher: no Node = prompt warns, does not block', p.status === 0 && /brew install node/.test(p.stdout), true);
  expect('launcher: no Node = session start warns', /Node\.js was not found/.test(viaRun('session.js', none, [], { session_id: 'sr' }).stdout), true);
  expect('launcher: no Node = session end quiet', viaRun('session.js', none, ['--end'], { session_id: 'sr' }).stdout, '');
  expect('launcher: no Node = status line shows it', /Node missing/.test(viaRun('statusline.js', none, [], {}).stdout), true);
  expect('launcher: hooks run with a bare PATH', spawnSync('sh', [join(dir, '.claude/hooks/run.sh'), 'guard.js'], { input: JSON.stringify({ session_id: 'sr', tool_name: 'Bash', tool_input: { command: 'git status' } }), env: { ...env, PATH: '/usr/bin:/bin', KIT_HOOK_NODE: '' }, encoding: 'utf8', cwd: dir }).status === 0 || !existsSync('/usr/bin/node') && !existsSync('/usr/local/bin/node') && !existsSync('/opt/homebrew/bin/node'), true);
}
const allow = (s, c) => expect(`allow: ${c}`, bash(s, c), 0);
const deny = (s, c) => expect(`block: ${c}`, bash(s, c), 2);

// A) Normal message: reading anything (except secrets) and ordinary work must pass.
prompt('s1', 'add a filter to the list page');
[
  'git status --porcelain', 'git diff --stat', 'git log --oneline -5 --grep=push', 'git add src/a.ts e2e/a.spec.ts',
  "git commit -m 'fix push button and force layout'", 'git commit -m "03: Export CSV"', 'git switch main && git pull --ff-only',
  'git config user.email', 'git config --get user.name', 'git rev-parse HEAD', 'git hash-object e2e/x.spec.ts',
  'git checkout -- src/features/a/x.ts', 'git reset --soft HEAD~1',
  'ls .claude .claude/hooks .claude/agents 2>&1 | head -60; ls scripts/quality-ratchet.mjs quality-baseline.json',
  'cat .claude/hooks/guard.js > /dev/null', 'cp .claude/hooks/guard.js /tmp/guard.bak', 'diff .claude/hooks/guard.js /tmp/guard.bak',
  'grep -n "AI tooling" .gitignore', 'cat .husky/pre-commit', 'ls -la .env*', 'cat .env.example',
  `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`,
  'node scripts/quality-ratchet.mjs --check 2>&1 | tail -5', 'node .claude/tools/apply-models.mjs --no-fable',
  'npm test -- --run src/a.test.ts', 'npx playwright test e2e/a.spec.ts', 'npm ci', 'npx skills@latest update -p -y',
  "cat > notes.md <<'EOF'\ngit status then git push --force later\nEOF", 'echo hello > /tmp/out.txt',
  'printf "%s" "$SUPABASE_URL"', 'set -e', 'rm -rf node_modules', 'supabase start', 'supabase db reset',
  'vercel env ls', 'gh pr list', 'gh issue view 3',
].forEach(c => allow('s1', c));

// B) Never allowed, even with "I authorize".
prompt('s1', 'push it, I authorize');
[
  'git push --force', 'git push -f origin main', 'git push --force-with-lease', 'git push origin +main', 'git push origin :old',
  'git push --delete origin x', 'git reset --hard HEAD~1', 'git clean -fd', 'git branch -D x', 'git checkout .',
  'git restore .', 'git commit --no-verify -m x', 'git commit -nm x', 'vercel --prod', 'npx vercel deploy', 'vercel promote x',
  'vercel env add X', 'supabase db push', 'supabase migration up --linked', 'gh pr create --fill', 'gh pr merge 3',
  'rm -rf ~', 'rm -rf /', 'cat .env', 'cat .env.local', 'grep KEY .env.production', 'source .env.local',
  'echo $SUPABASE_SERVICE_ROLE_KEY', 'printf "%s" "$OPENAI_API_KEY"', 'env', 'printenv', 'printenv STRIPE_SECRET_KEY',
].forEach(c => deny('s1', c));

// C) Push: only with "I authorize" in the current message, same session.
allow('s1', 'git push -u origin main');
expect('push from another session is blocked', bash('s2', 'git push'), 2);
prompt('s1', 'thanks');
deny('s1', 'git push');
deny('s1', 'git commit -m x && git push origin main');
prompt('s1', 'I do not authorize a push yet');
deny('s1', 'git push');
prompt('s1', 'I authorise it, push');
allow('s1', 'git push origin main');

// D) Protected files: writes blocked on a normal message, allowed with an unlock.
prompt('s1', 'clean up the header');
for (const f of ['.claude/hooks/guard.js', '.claude/settings.json', '.claude/settings.local.json', '.claude/state/auth.json',
  '.claude/identity.json', 'quality-baseline.json', 'scripts/quality-ratchet.mjs', 'scripts/secret-scan.mjs',
  'scripts/commit-identity.mjs', 'scripts/check.mjs', 'scripts/trash.mjs', 'scripts/swarm.mjs', '.claude/kit.json',
  'scripts/learned-checks.mjs', 'scripts/learned-checks.json', '.husky/pre-commit', '.githooks/pre-push', 'scripts/floor-guard.mjs', 'scripts/report.mjs',
  '.claude/hooks/statusline.js', '.claude/state/sessions/s1.json', '.claude/state/usage.json']) expect(`Write blocked: ${f}`, write('s1', f), 2);
expect('Write allowed: src/app/page.tsx', write('s1', 'src/app/page.tsx'), 0);
expect('Write allowed: .claude/memory/health.md', write('s1', '.claude/memory/health.md'), 0);
expect('Write allowed: CLAUDE.md', write('s1', 'CLAUDE.md'), 0);
[
  'echo x > .claude/hooks/guard.js', 'echo x >> quality-baseline.json', "echo x >'.claude/settings.json'", 'echo x &> .husky/pre-push',
  'rm .claude/hooks/guard.js', 'chmod -x .claude/hooks/guard.js', 'tee .husky/pre-commit < /tmp/x', 'cp /tmp/x .claude/hooks/guard.js',
  'mv .claude/hooks/guard.js /tmp/', 'sed -i "s/a/b/" scripts/quality-ratchet.mjs', 'git checkout -- quality-baseline.json',
  'git rm .husky/pre-commit', `node -e "require('fs').writeFileSync('.claude/settings.json','{}')"`, 'truncate -s0 scripts/secret-scan.mjs',
  "cat > .husky/pre-commit <<'EOF'\nnpm test\nEOF",
].forEach(c => deny('s1', c));

// E) Git identity: only Kim's own identity, except during setup.
[
  "git commit --author='X <x@y.z>' -m x", 'git config user.email x@y.z', 'git config --local user.name "Someone Else"',
  'git config core.hooksPath /dev/null', 'git -c user.email=x@y.z commit -m x', 'GIT_AUTHOR_EMAIL=x@y.z git commit -m x', 'HUSKY=0 git commit -m x',
].forEach(c => deny('s1', c));
allow('s1', 'git config user.email 1+kim@users.noreply.github.com');
allow('s1', 'git config user.name "Kim Test"');

// F) Setup run: unlock survives Kim's answers, covers identity, never push, ends with a new session.
prompt('s3', '/anthropic-skills:project-setup update');
prompt('s3', 'yes, use the noreply email');
prompt('s3', 'b) default yes');
allow('s3', 'echo x > .husky/pre-commit');
allow('s3', 'chmod +x .claude/hooks/guard.js .claude/hooks/prompt.js .claude/hooks/session.js');
allow('s3', 'git config user.email new@users.noreply.github.com');
deny('s3', 'git push');
deny('s3', 'git push --force');
expect('Write allowed during setup: .claude/settings.json', write('s3', '.claude/settings.json'), 0);
expect('setup unlock does not carry to a new session', write('s4', '.claude/settings.json'), 2);
expect('setup run: kit installer allowed', bash('s3', 'node /Users/kim/.claude/skills/project-setup/tools/install.mjs .'), 0);
expect('kit installer blocked in a new session', bash('s4', 'node /Users/kim/.claude/skills/project-setup/tools/install.mjs .'), 2);
prompt('s5', '<command-name>/project-setup</command-name> check');
expect('expanded slash command unlocks setup', write('s5', '.husky/pre-commit'), 0);
prompt('s6', 'please run /project-setup later');
expect('mentioning /project-setup mid-sentence does not unlock', write('s6', '.husky/pre-commit'), 2);

// H) Cloud: optional backup push of the session's own claude/... branch (Kim turns it on in .claude/git.json).
const cloudEnv = { ...env, CLAUDE_CODE_REMOTE: 'true' };
const cloudBash = (s, command) => spawnSync('node', [join(dir, '.claude/hooks/guard.js')], { input: JSON.stringify({ session_id: s, tool_name: 'Bash', tool_input: { command } }), env: cloudEnv }).status;
spawnSync('git', ['init', '-q', '-b', 'claude/fix-header-x1'], { cwd: dir });
prompt('s8', 'fix the header');
expect('cloud backup push blocked while switched off', cloudBash('s8', 'git push -u origin claude/fix-header-x1'), 2);
expect('Write blocked: .claude/git.json', write('s8', '.claude/git.json'), 2);
writeFileSync(join(dir, '.claude/git.json'), JSON.stringify({ cloudBackupPush: true }));
expect('cloud backup push of claude/ branch allowed', cloudBash('s8', 'git push -u origin claude/fix-header-x1'), 0);
expect('cloud backup push of current branch allowed', cloudBash('s8', 'git push -u origin HEAD'), 0);
expect('cloud backup push with no ref (current claude/ branch) allowed', cloudBash('s8', 'git push'), 0);
expect('cloud push to main still needs I authorize', cloudBash('s8', 'git push origin HEAD:main'), 2);
expect('cloud push to another branch still needs I authorize', cloudBash('s8', 'git push origin feature/x'), 2);
expect('cloud force push of claude/ branch blocked', cloudBash('s8', 'git push -f origin claude/fix-header-x1'), 2);
expect('backup push never works on the Mac', bash('s8', 'git push -u origin claude/fix-header-x1'), 2);
prompt('s8', 'ship it to main, I authorize');
expect('ship to main with I authorize', cloudBash('s8', 'git fetch origin main && git rebase origin/main && git push origin HEAD:main'), 0);
rmSync(join(dir, '.claude/git.json'));

// I) Deleting: a plain rm becomes the trash script (no prompt, undoable); anything fancier is blocked with the fix.
prompt('s9', 'remove the old export helper and the test results');
for (const [c, t] of [['rm -rf test-results', 'test-results'], ['rm src/old.ts "my file.txt"', 'src/old.ts "my file.txt"'],
  ['rm -f -- -odd.ts', '-odd.ts'], ['rmdir empty-dir', 'empty-dir'], ['unlink src/a.ts', 'src/a.ts'], ["rm -r 'e2e/old flow'", "'e2e/old flow'"],
  ['rm -rf playwright-report test-results coverage', 'playwright-report test-results coverage']])
  expect(`rm rewritten: ${c}`, rewritten('s9', c), trashCmd(t));
[
  'rm -rf "$TMPDIR"/pw-*', 'rm -rf $HOME/x', 'rm -rf $(ls -d build*)', 'cd src && rm a.ts', 'rm a.ts; ls', 'ls && rm -rf dist',
  'find . -name "*.tmp" -delete', 'find e2e -type f -exec rm {} +', 'git ls-files -d | xargs rm', 'shred -u notes.txt', 'rm -rf', 'sudo rm x',
  'node scripts/trash.mjs .claude/hooks/guard.js', 'node scripts/trash.mjs scripts/quality-ratchet.mjs', 'echo x > scripts/floor-guard.mjs',
  'node scripts/trash.mjs scripts/floor-guard.mjs', "sed -i 's/a/b/' .claude/hooks/statusline.js",
].forEach(c => deny('s9', c));
[
  'node scripts/trash.mjs test-results src/old.ts', 'node scripts/trash.mjs --empty', 'node scripts/check.mjs --e2e e2e/a.spec.ts',
  'node scripts/check.mjs --fast', 'git rm src/old.ts', 'git commit -m "rm old helper"', 'echo "rm -rf x"', 'mv src/a.ts src/b.ts',
  "git commit -F- <<'EOF'\nremove: rm -rf old dir\nEOF",
].forEach(c => allow('s9', c));
expect('rm not rewritten during a normal message for a protected file', rewritten('s9', 'rm .claude/hooks/guard.js'), '');
prompt('s10', '/anthropic-skills:project-setup update');
expect('setup run: old kit file goes to the trash', rewritten('s10', 'rm .claude/hooks/route.sh'), trashCmd('.claude/hooks/route.sh'));
rmSync(join(dir, 'scripts/trash.mjs'));
expect('no trash script: rm is blocked, not run', bash('s9', 'rm -rf test-results'), 2);

// K) Wrapped and disguised commands are checked inside; everyday commands still pass.
prompt('s13', 'run the tests and fix the export');
[
  "bash -c 'git push origin main'", 'sh -c "git push"', 'eval "git push"', '/usr/bin/git push', '\\git push', 'env git push', 'command git push',
  'nohup git push', 'timeout 60 git push', 'echo main | xargs git push origin', 'git -c alias.p=push p origin main', 'git config alias.p push',
  `node -e "require('child_process').execSync('git push')"`, `python3 -c "import os; os.system('git push')"`, "bash -c 'git push --force'",
  'git -c core.hooksPath=/dev/null commit -m x', 'git config core.hooksPath /tmp/none', "bash -c 'git commit --no-verify -m x'", 'export HUSKY=0',
  'CLAUDECODE= git push', 'env -u CLAUDECODE git push', 'unset CLAUDECODE',
  'grep -r SECRET .', 'grep -rn KEY', 'rg --hidden SECRET', 'cat .env.loc*', `node -e "console.log(require('fs').readFileSync('.env.local','utf8'))"`,
  `python3 -c "print(open('.env.local').read())"`, 'base64 .env.local', 'cp .env.local notes.txt', 'git show :.env.local', 'tar cf - .env.local', '. ./.env.local',
  "bash -c 'echo x > .claude/hooks/guard.js'", 'cd .claude/hooks && echo x > guard.js', 'ln -s .claude/state/auth.json a.json',
  "python3 -c \"open('.claude/state/auth.json','w').write('{}')\"", 'cd scripts && echo x > push-gate.mjs',
  'npx vercel deploy --prod', 'npx vercel@latest --prod', 'pnpm dlx vercel deploy', 'npx supabase db push', "bash -c 'vercel --prod'", 'supabase db reset --linked',
  'gh api repos/kim/app/pulls -f title=x -f head=a -f base=main', 'curl -X POST https://api.github.com/repos/kim/app/pulls -d {}', 'gh pr create --fill',
  'export GIT_AUTHOR_NAME=Claude', "bash -c 'git commit --author=\"Claude <c@x>\" -m x'", 'git commit --amend --author="Bot <b@x>" --no-edit',
  'sudo rm -rf build', "bash -c 'rm -rf src'", '(git push)', 'echo $(git push)',
  'cargo publish', 'cargo +stable publish', 'cargo yank --version 1.0.0', 'npm publish', 'pnpm publish --access public', 'twine upload dist/*',
  'uv publish', 'gh release create v1.0.0', "bash -c 'cargo publish'", 'echo x > .githooks/pre-commit', 'cd .githooks && echo x > pre-push',
  'chmod -x .githooks/pre-push', 'rm .githooks/commit-msg',
  'node /Users/kim/.claude/skills/project-setup/tools/install.mjs .', 'node ~/.claude/skills/project-setup/tools/install.mjs . --only scripts',
].forEach(c => deny('s13', c));
[
  'timeout 120 npm test', 'env NODE_ENV=test npm test', "bash -c 'npm run build'", 'npx playwright test e2e/a.spec.ts', `node -e "console.log(process.env.NODE_ENV)"`,
  'grep -rn "useAuth" src/', 'rg useAuth', 'rg -n "x" apps/web/src', 'git check-ignore -q .env.local', 'ls -la', 'git log --oneline -5',
  'git commit -m "fix: timeout in env loader"', 'git status', 'node scripts/check.mjs --fast', 'pnpm --filter @dps/web test', 'cat package.json',
  `python3 -c "print(1)"`, `node -e "require('child_process').execSync('npm test')"`, 'git diff HEAD~1', 'cat .env.example', 'supabase start', 'npx supabase status',
  'gh pr list', 'vercel logs', 'git fetch origin', 'cd apps/web && npm test', '(cd apps/web && npm run lint)', 'grep -n "x" README.md',
  'node scripts/swarm.mjs prep', 'node scripts/swarm.mjs collect .claude/worktrees/agent-a1 --check e2e/export/03-csv.spec.ts', 'node scripts/swarm.mjs list',
  'git worktree list', 'git apply --check .trash/swarm/agent-a1.patch', 'node scripts/learned-checks.mjs --list',
  'node scripts/swarm.mjs usage', 'node scripts/report.mjs', 'node scripts/report.mjs --days 7 --save', 'node scripts/floor-guard.mjs --worktree',
  'cargo test', 'cargo test --test cli export_csv', 'cargo clippy --workspace --all-targets -- -D warnings', 'cargo fmt --all', 'cargo build --release',
  'cargo add serde --features derive', 'cargo publish --dry-run', 'cargo run -- --help', 'go test ./...', 'python3 -m pytest -q', 'ruff check .',
  'node scripts/check.mjs --only format,lint', 'node scripts/check.mjs --list', 'cat .githooks/pre-commit', 'ls .githooks',
  'node /Users/kim/.claude/skills/project-setup/tools/install.mjs . --check', 'node /Users/kim/.claude/skills/project-setup/tools/install.mjs . --dry-run',
  'git -C /Users/kim/.claude/skills/project-setup pull --ff-only',
].forEach(c => allow('s13', c));
expect('Read tool: .env.local', guard('s13', 'Read', { file_path: '.env.local' }), 2);
expect('Read tool: .env.example', guard('s13', 'Read', { file_path: '.env.example' }), 0);
expect('Grep tool on .env', guard('s13', 'Grep', { pattern: 'KEY', path: '.env.production' }), 2);
expect('Grep tool on src', guard('s13', 'Grep', { pattern: 'KEY', path: 'src' }), 0);
expect('Read tool: a protected kit file', guard('s13', 'Read', { file_path: '.claude/hooks/guard.js' }), 0);
expect('Glob tool: .env*', guard('s13', 'Glob', { pattern: '.env*' }), 2);
expect('Glob tool: src/**/*.ts', guard('s13', 'Glob', { pattern: 'src/**/*.ts' }), 0);
expect('Edit in a worker worktree: source file', guard('s13', 'Edit', { file_path: '.claude/worktrees/agent-a1/src/a.ts', old_string: 'a', new_string: 'b' }), 0);
expect('Edit in a worker worktree: guard copy', guard('s13', 'Edit', { file_path: '.claude/worktrees/agent-a1/.claude/hooks/guard.js', old_string: 'a', new_string: 'b' }), 2);

// G) Legacy unlock (v3.0 hooks wrote {session, at, push, edit}) keeps an update run working.
writeFileSync(join(dir, '.claude/state/auth.json'), JSON.stringify({ session: 's7', at: Date.now(), push: true, edit: true }));
expect('legacy unlock: protected write allowed', write('s7', '.claude/hooks/guard.js'), 0);
expect('legacy unlock: push still blocked', bash('s7', 'git push'), 2);
prompt('s7', 'yes');
expect('legacy unlock survives an answer', write('s7', '.claude/hooks/prompt.js'), 0);

// H) Two Claude sessions on one repo: a message in one never clears or lends the other's unlock.
prompt('s20', '/project-setup:project-setup update');
prompt('s21', 'fix the typo on the login page');
expect('other session message keeps the setup unlock', write('s20', '.claude/hooks/guard.js'), 0);
expect('other session has no unlock of its own', write('s21', '.claude/hooks/guard.js'), 2);
prompt('s21', 'push it, I authorize');
expect("one session's I authorize lets that session push", bash('s21', 'git push'), 0);
expect("one session's I authorize does not unlock another's push", bash('s20', 'git push'), 2);
prompt('s20', 'swarm');
expect('setup unlock survives an answer while another session works', write('s20', '.claude/hooks/prompt.js'), 0);

// L) Session lock: a second Claude session on the same folder is announced once; /deliver, /feature and /fix wait for "go anyway".
const sdir = join(dir, '.claude/state/sessions');
rmSync(sdir, { recursive: true, force: true });
const start = s => { const t = Date.now(); const r = spawnSync('node', [join(dir, '.claude/hooks/session.js')], { input: JSON.stringify({ session_id: s, source: 'startup' }), env, encoding: 'utf8', cwd: dir }); return { out: String(r.stdout), ms: Date.now() - t, status: r.status }; };
const said = (s, text) => String(spawnSync('node', [join(dir, '.claude/hooks/prompt.js')], { input: JSON.stringify({ session_id: s, prompt: text }), env, encoding: 'utf8' }).stdout);
const lockLine = out => /Session lock:/.test(out);
const stopLine = out => /Do not start deliver, feature or fix/.test(out);
expect('first session: no lock warning', lockLine(start('s30').out), false);
const second = start('s31');
expect('second session on the folder: warned at start', lockLine(second.out), true);
expect('session start exits 0', second.status, 0);
expect('second session: not warned again on a normal message', lockLine(said('s31', 'what does the export do?')), false);
expect('second session: /deliver waits', stopLine(said('s31', '/deliver .scratch/export/')), true);
expect('second session: expanded /fix waits', stopLine(said('s31', '<command-name>/fix</command-name> login fails')), true);
expect('second session: "fix the typo" is not a build command', stopLine(said('s31', 'fix the typo on the login page')), false);
expect('"go anyway" lets it run', lockLine(said('s31', '/deliver .scratch/export/ go anyway')), false);
expect('"go anyway" sticks for that session', lockLine(said('s31', '/feature csv import')), false);
expect('first session: told once about the newcomer', lockLine(said('s30', 'hello')), true);
expect('first session: /feature waits', stopLine(said('s30', '/feature csv import')), true);
spawnSync('node', [join(dir, '.claude/hooks/session.js'), '--end'], { input: JSON.stringify({ session_id: 's31', reason: 'exit' }), env, cwd: dir });
expect('session end removes its note', existsSync(join(sdir, 's31.json')), false);
expect('after the other session ended: /deliver runs', lockLine(said('s30', '/deliver .scratch/export/')), false);
writeFileSync(join(sdir, 'old.json'), JSON.stringify({ session: 'old', seenAt: Date.now() - 4 * 60 * 60 * 1000 }));
expect('a session quiet for 4 hours does not count', lockLine(said('s30', '/deliver .scratch/export/')), false);
const manual = spawnSync('node', [join(dir, '.claude/hooks/session.js')], { env, encoding: 'utf8', cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
expect('session.js run by hand (no input) finishes', manual.status, 0);

// M) Status line: saves plan usage for the swarm usage guard.
const sl = spawnSync('node', [join(dir, '.claude/hooks/statusline.js')], { input: JSON.stringify({ model: { display_name: 'Sonnet' }, rate_limits: { five_hour: { used_percentage: 42.4, resets_at: 1 }, seven_day: { used_percentage: 18 } } }), env, encoding: 'utf8' });
let usage = {};
try { usage = JSON.parse(readFileSync(join(dir, '.claude/state/usage.json'), 'utf8')); } catch {}
expect('status line shows usage', /5h 42% · 7d 18%/.test(String(sl.stdout)), true);
expect('status line saves usage.json', `${usage.fiveHour}/${usage.sevenDay}`, '42/18');

rmSync(dir, { recursive: true, force: true });
if (fails.length) { console.log(fails.join('\n')); console.log(`${fails.length} failed, ${pass} passed`); process.exit(1); }
console.log(`hooks: all ${pass} passed`);
