# Claude Code kit guide (project-setup v6.1)

What this repo's Claude Code kit does, how to use it, and where its limits are. Ask "what can the kit do?" or run `/project-setup help` to see this guide. Claude answers from this file and checks it against the repo's real state.

## 1. Overview

| Part | What it is |
|---|---|
| Way of working | Matt Pocock's flow (grill, spec, tickets, test-first build, two-axis review) with Lauren Tan's finish (proven on the real app, a mistake made twice becomes a check) and Addy Osmani's guards (doubt review, docs over memory, floor guard, small tickets) |
| Two flows | `/feature`: you answer the grill questions; spec, tickets, build, checks, review and commits run by themselves. `/fix`: you describe the bug; cause, failing test, fix and commit run by themselves |
| Router | Every message gets the right helper: Claude itself, a Haiku scout that only reads, or a worker tier sized to the task |
| Normal or swarm | Normal: one ticket at a time. Swarm: up to 5 workers at once, each on the model the task needs, each in its own copy of the repo (git worktree). Chosen at setup or update. Swarm drops to normal by itself when plan usage runs low |
| Proof | A check written before the build fails, then passes after it; for screens, `verify-<app>` drives the real app and keeps evidence. /deliver creates `verify-<app>` by itself the first time |
| Quality | Lauren Tan's and Matt Pocock's principles in CLAUDE.md; lint, typecheck, tests and learned checks block a bad commit; the floor guard refuses a commit that silences a check or makes a test easier; risky tickets get a fresh-eyes doubt review; the ratchet reports the trend |
| Safety | The guard blocks dangerous commands (also inside `bash -c`, `timeout`, one-line scripts); git's push gate lets Claude push only after "I authorize"; secret scan; Mac sandbox |
| Only you on GitHub | Every commit is yours; AI lines are stripped; the push gate refuses any commit by someone else; no pull requests |
| No prompts | Routine commands are pre-approved, deletes go through the trash script, checks are one command, /deliver runs in one turn |
| Mac, Windows, cloud | The kit, specs, tickets and notes are committed, so every machine and cloud session has them |
| One session per folder | A second Claude session on the same folder is announced; /deliver, /feature and /fix wait until you close one or say "go anyway" |
| Report | `/report`: one page on what shipped, what is blocked and how the debt moved |
| Kit home and updates | The kit lives on your computer in `~/.claude/skills/project-setup` (a clone of your private `project-setup-kit` repo). Every `/project-setup` run pulls the latest kit first; a session in this repo tells you when its kit is behind, and `/project-setup update` brings it up to date. The version is in `.claude/kit.json` |

## 2. Commands you type

| Command | What it does | Model |
|---|---|---|
| `/feature <idea>` | The whole flow: grill, spec, tickets, /deliver. Add `swarm` or `normal` to override the mode once | Opus, then workers |
| `/fix <bug>` | Bug to committed fix: finds the cause, writes a test that fails because of the bug, fixes it through /deliver | Opus high, then workers |
| `/report` (`/report week`) | One page: shipped, blocked, debt, commits waiting for your push. Read-only | Sonnet low |
| `/webperf` | Speed audit of your pages; numbers only when measured (Lighthouse on a local production build, or a report you give) | Sonnet |
| `/grill-with-docs` | Only the interview, when you want to think before building | Opus |
| `/wayfinder` | Maps huge work into slices before any spec (/feature runs it for huge work) | Fable (Opus when Fable is off) |
| `/to-spec`, `/to-tickets` | Spec, then tickets with a `Verify by:` check each | Sonnet |
| `/deliver .scratch/<feature>/` | Builds every open ticket, fully automatic (`swarm` / `normal` to override) | Sonnet + workers |
| `/verify-ticket <ticket>` | Checks one ticket: red before, green after, app evidence | Sonnet |
| `/create-verification-skill` | Writes `verify-<app>` (/deliver does this by itself the first time) | Opus |
| `/maintain-verification-skill` | Re-checks the verify map (/deliver runs it for changed features) | Sonnet |
| `/reflect` | Turns lessons from a hard session into checks; skill changes wait for your "apply reflect" | Sonnet |
| `/diagnosing-bugs` | Only finds the cause of a bug, no fix (`/fix` uses it) | Opus |
| `/improve-codebase-architecture` | Looks for deeper, simpler structure | Opus |
| `/wait-what` | Re-explains the last reply in plain words | Sonnet |
| `/research`, `/prototype` | Quick research or a throwaway prototype | Sonnet |
| `/tdd`, `/code-review`, `/implement` | Used inside /deliver; `/implement` suits one small change you are watching | Sonnet |
| `/project-setup check` | Health check of the kit (read-only) | session |
| `/project-setup update` | Updates skills and kit files; `update swarm` or `update normal` switches the mode | session |
| `/project-setup cloud-env` | Prints the paste-ready cloud environment variables | session |
| `/project-setup help` | Shows this guide | session |

## 3. Words that unlock things

| You say | What it allows | How long |
|---|---|---|
| "push it, I authorize" | Claude may push (never force) and edit protected kit files | This message only (at most 30 minutes) |
| "ship it, I authorize" (cloud) | Rebase the cloud branch on `main` and push it to `main` | This message only (at most 30 minutes) |
| "apply reflect" | Apply the skill changes waiting in `.claude/memory/reflect-proposals.md` | This message |
| "go anyway" | /deliver, /feature and /fix run although another Claude session is open on this folder | This session |
| `/project-setup ...` | Edits to protected kit files, your git identity and the mode; never a push | 2 hours, this session |

## 4. Everyday flows

**New feature:** new session, `/feature <idea>`, answer the questions. Everything else runs by itself to the end report. Test the short "TEST IT YOURSELF" list, then "push it, I authorize" (cloud: "ship it, I authorize"). Vercel deploys from `main`.

**Bug:** `/fix <what happens, what should happen, where>`. It reproduces the bug, proves it with a failing test, fixes the cause, and commits. Bug and feature at once: `/fix` first, then `/feature`.

**Small change or question:** just ask. **Several independent jobs in one message (swarm mode):** they run at the same time. **End of the day:** `/report`. **Another machine:** push on one ("I authorize"), `git pull` on the other.

## 5. Models, swarm and cost

- Each task starts on the tier it needs: Sonnet low (mechanical), Sonnet medium (normal and UI), Opus medium (risky or large), Opus high (risky and unclear), Fable (architecture across modules). One tier up only after an unexpected failure. The run log teaches where each ticket type should start.
- **Swarm mode:** up to 5 tickets (or 5 parts of one big task) at once, each on its own tier and in its own worktree; their work comes home one ticket at a time, checked, reviewed and committed as you. Tickets that touch shared setup (migrations, packages, config) run alone. Faster, but it spends usage faster: 5 workers at once use your plan's limits about 5 times as fast.
- **Usage guard (swarm):** the status line shows your plan usage and saves it; before each batch /deliver reads it and runs 2 at once from 60% of the 5-hour limit, one at a time from 80% (or 90% of the weekly limit). Where no status line runs (some desktop and cloud sessions) it cannot see usage; then a worker that stops on a usage limit switches the rest of the run to normal. Numbers in `.claude/kit.json` (`usageGuard`).
- **Doubt review:** tier 3+ and risky tickets get one more Opus review in a fresh context that sees only the diff and the acceptance criteria. It costs one Opus call per risky ticket.
- Haiku only reads (wide searches, logs). Fable not available: Opus xhigh stands in, remembered in `.claude/models.json`. Overloaded models fall back to Opus, then Sonnet.

## 6. What it CAN do

- Take a feature from idea to committed, checked code after one interview, and a bug from report to a committed fix with a test that proves it.
- Check framework code against the official docs for your installed versions, and say what it could not verify.
- Refuse a commit that silences a check (`@ts-ignore`, `eslint-disable`, `as any`, `.skip`, an empty `catch`, strict mode off; Rust `#[allow]`, `#[ignore]`, lints set to allow in Cargo.toml; Python `noqa`, `type: ignore`, `pytest.skip`; Go `nolint`, `t.Skip`) unless the message says why.
- Check any stack: TypeScript/JavaScript, Rust (fmt, clippy with warnings as errors, test, build; Tauri's `src-tauri/` too), Python and Go are found by themselves; anything else runs from `checks` in `.claude/kit.json`. `node scripts/check.mjs --list` shows what this repo runs. A run with nothing to check fails.
- Build several tickets at once in swarm mode, each on the right model.
- Write each check before the code, and refuse to call a ticket done until it passes on the real app.
- Create and maintain its own `verify-<app>` skill that drives your app like a user and keeps evidence.
- Turn a mistake made twice into a lint rule, a test or a learned check.
- Delete comments that only narrate, keep notes (architecture, roadmap, debt, code map, learned rules) and pay down debt.
- Keep you the only author on GitHub, from commit to push to CI.
- Run the same way on the Mac, Windows and in cloud sessions.

## 7. What it CANNOT or WILL NOT do

| It will not | Why | Who does it |
|---|---|---|
| Deploy, promote or roll back on Vercel | Production is yours | You (or Vercel on push to `main`) |
| Push to the live Supabase database or run live migrations | Production data | You apply migration files |
| Push without "I authorize", or force-push ever | Your rule; git's push gate enforces it | You |
| Open or merge pull requests | No-PR workflow | Nobody |
| Read `.env` files or print secrets | Secrets never pass through Claude | You paste keys into forms |
| Commit or push anything not authored by you | You are the only contributor | |
| Use real people's data (beneficiaries, minors) | Privacy | Fake seed data only |
| Rewrite old git history | Needs a force-push | You, with section 11 |
| Work around a guard block | A block is final | Claude stops and tells you |
| Stop a script Claude wrote from doing something the guard cannot see | The guard reads command text | The git hooks, CI and the Mac sandbox are the hard locks |
| Judge looks, wording or feel | Needs a human | You, from the TEST IT YOURSELF list |
| Answer the grill for you | The interview is where your intent comes from | You, once per feature |
| Stop a second session from opening | The session lock warns and makes /deliver, /feature and /fix wait; it cannot close a session | You close one |
| Give speed numbers from reading code | Only a measurement is a number; code reading gives "potential impact" | `/webperf` with a production build or your Lighthouse report |
| Catch every way to fake green | The floor guard reads the diff with patterns; a determined change can hide | Review, the doubt review and CI |
| Guess checks for a stack it does not know (Java, .NET, Swift, Dart...) | `check.mjs` knows package.json, Rust, Python and Go | You or setup name them in `.claude/kit.json` `checks` |
| Drive a Tauri window on the Mac | No WebDriver for the macOS webview | Playwright covers the web part; you check the window |
| Publish a crate or package, or make a GitHub release | Public and permanent | You |

## 8. Automatic checks

| When | What runs |
|---|---|
| Every session start | Sets you as git author; warns about another Claude session on the same folder; in the cloud also installs packages, git hooks and Playwright |
| Every message | Router reminder (with the swarm note when it is on); "I authorize" and setup unlocks |
| Every command and file read Claude does | The guard, including inside wrappers and one-line scripts |
| Every ticket | Check red before the build, green after, fast checks, app evidence for screens, review; risky ones also the doubt review |
| Every commit | Format, lint, typecheck or tests for the stack (Husky in JS/TS repos, `.githooks/` elsewhere), secret scan, learned checks, author check (AI lines stripped), floor guard |
| Every push | Push gate (Claude needs "I authorize"; every pushed commit must be yours), then all checks |
| Every push on GitHub | CI repeats the checks per stack, plus e2e, `npm audit` or `cargo audit`, and the author check; the ratchet reports |

## 9. Files

| Path | What |
|---|---|
| `CLAUDE.md` | Rules, how code is written, router, learned rules |
| `.claude/kit.json` | Normal or swarm, and the agent limit (protected) |
| `.claude/memory/` | health.md, codemap.md, runs.log, reflect-proposals.md |
| `.claude/state/` | Local only: unlocks, open sessions, plan usage, saved reports (protected, never committed) |
| `.scratch/<feature>/` | spec.md, issues/NN-*.md, wayfinder map.md (`.scratch/fixes/<date>-<slug>/` for /fix) |
| `.claude/skills/` | Matt Pocock's skills, `feature`, `fix`, `deliver`, `verify-ticket`, `report`, `webperf`, Lauren Tan's verification skills and `reflect`, and `verify-<app>` |
| `.claude/agents/` | 5 worker tiers, the `Explore` scout and the `doubter` |
| `.claude/hooks/` | guard.js, prompt.js, session.js, statusline.js (protected) |
| `scripts/` | check, trash, swarm, push-gate, learned-checks, floor-guard, report, quality-ratchet, secret-scan, commit-identity (protected) |
| `.trash/` | Deleted files until the next commit, check logs, evidence, swarm patches |

## 10. When something goes wrong

| Problem | Fix |
|---|---|
| Setup or update says the unlock was lost | Another Claude session on this repo cleared it (kits before v5.1). Pause the other session, then send the command again with `I authorize` at the end |
| "Kit hooks cannot run: Node.js was not found" | Install Node (`brew install node` or the nodejs.org installer), check `which node`, restart `claude`. Until then the guard blocks every tool on purpose |
| "BLOCKED by project guard" on something harmless | Tell Claude to stop; run `/project-setup check`. A wrong block is a bug in the skill |
| "Push gate:" when Claude pushes | You did not say "I authorize" in the last 30 minutes. Say it, or push yourself |
| "Push gate:" listing commits by someone else or AI lines | Those commits stay local; fix them with section 11 before pushing |
| "swarm: CONFLICT" | Two workers touched the same lines; /deliver rebuilds that ticket alone. Nothing to do |
| "swarm off: no worktrees" | This session cannot make worktrees; /deliver ran one ticket at a time. Nothing breaks |
| Usage runs out fast in swarm mode | The usage guard drops to normal by itself where the status line runs. Always normal: `/project-setup update normal`, or `/deliver <folder> normal` for one run |
| "Session lock: another Claude session is open" | Close the other session on this folder (or wait until it ends), or say "go anyway". A crashed session stops counting after 3 hours |
| "floor-guard: Commit refused" | The change silences a check or makes a test easier. Claude fixes the code; if it is right on purpose, the commit message gets a `Floor-exception: <rule> <path> - <reason>` line, and the end report and `/report` list it |
| "usage unknown" from the usage guard | No status line numbers here (desktop app, cloud, or a plan that does not send them). Swarm still runs; a usage-limit stop switches to normal |
| A learned check fails | The code repeats an old mistake; the message says the fix. To drop a rule: "I authorize", then ask Claude to remove it |
| Fable not available | Automatic: Opus stands in. Back on: `node .claude/tools/apply-models.mjs --fable` |
| Cloud session misses your work or a variable | Push first ("I authorize"); `/project-setup cloud-env` for new variables |
| "Allow Claude to run this command?" | An old `ask` rule in a settings file. Run update (it removes them), then a new session |
| A prompt for an `rm` command | Claude Code always asks for an `rm` built on a variable. Deny it and say "use trash.mjs" |

## 11. GitHub shows only you

New work: the hooks keep every commit yours, and the push gate refuses to send anyone else's. Old history keeps its authors and co-author lines until you rewrite it, and GitHub's contributor list counts them. To clean an existing repo (you run this, once; it rewrites history and needs a force-push):
1. Check: `/project-setup check` lists every author and AI line in the history.
2. Back up: `git clone --mirror <repo url> ../<repo>-backup.git`.
3. Install git-filter-repo (`brew install git-filter-repo` on the Mac, `pip install git-filter-repo` on Windows), then in a fresh clone write `mailmap.txt` with one line per other author: `Your Name <your-noreply-email> <their-email>`.
4. Run: `git filter-repo --mailmap mailmap.txt --message-callback "import re; return re.sub(rb'(?im)^(co-authored-by:.*(claude|anthropic).*|claude-session:.*|.*generated with \[?claude code.*|https://claude\.ai/code/session_\S*)\n?', b'', message)"`
5. Push yourself: `git push --force --all` and `git push --force --tags`. Re-clone on your other machines. GitHub updates the contributor list within a day.
