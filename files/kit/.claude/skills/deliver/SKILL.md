---
name: deliver
description: Build one ticket or a whole feature's tickets, fully automatic - writes each ticket's check first (red), builds it on the worker tier the task needs (Sonnet low up to Fable), or up to 5 tickets at once in swarm mode (fewer when plan usage runs low), proves it green on the real app (verify-ticket), reviews it (plus a fresh-eyes doubt review on risky tickets), commits as Kim, then updates the notes, the verify map and the learned checks. Use when Kim runs /deliver with a ticket file or a .scratch folder, or when /feature or /fix hands over its tickets.
allowed-tools: Bash Edit Write MultiEdit NotebookEdit Read Glob Grep Agent Skill TodoWrite
model: sonnet
effort: medium
---

# Ship

Matt Pocock's loop (check first, small steps, test-first build, two-axis review) with Lauren Tan's finish (done means proven on the real app; a mistake made twice becomes a check). One orchestrator: you.

**Runs unattended, in one turn:** this skill pre-approves its tools for the whole /deliver turn (`allowed-tools`), so Kim gets no approval prompts; the guard still blocks every dangerous command. The approval lasts only for this turn, so never end the turn to wait: dispatch every agent in the foreground (`run_in_background: false`; in swarm mode several foreground calls in ONE message run at the same time) and run every command in the foreground, then go straight on to the next step and the next ticket until the end report. Follow the Shell commands rules in CLAUDE.md (one plain command per call, delete with `node scripts/trash.mjs`, checks with `node scripts/check.mjs`): Claude Code's own rm check asks Kim for any `rm` built on a variable, in every mode.

**Mode:** read `.claude/kit.json`. `"swarm": true` = Swarm mode (section below) with up to `maxAgents` (default 5) workers at once; otherwise one ticket at a time. Kim can override one run: `/deliver <folder> swarm` or `/deliver <folder> normal`.

Input: a ticket (`.scratch/<feature>/issues/NN-<slug>.md`) or a feature folder (`.scratch/<feature>/`, or `.scratch/fixes/<date>-<slug>/` from /fix): then every ticket not `Status: done`, in number order, skipping any whose "Blocked by" tickets are not done. Note the starting commit (`git rev-parse HEAD`) for the end steps. A ticket marked done with no commit starting `<NN>:` (`git log --oneline --grep "^<NN>:"`) stopped before its commit: rerun its check and commit it.

## Start

0. **Session lock:** this session was told another Claude session is open on this folder (a `Session lock:` line) and Kim has not said "go anyway": stop and tell him in one line. Two sessions in one folder edit the same files and mix their commits.
1. Commit any uncommitted files under `.scratch/<feature>/` (`plan: <feature> spec and tickets`), so a crash or another machine never loses the plan.
2. Read once: CLAUDE.md, `.claude/memory/health.md`, `.claude/memory/codemap.md`, `.scratch/<feature>/spec.md`, and the sections of `docs/agents/notes.md` for the areas the feature touches. Wide searches, long logs and long test output go to the `Explore` agent (Haiku, read-only); you keep the judgment calls.
3. **Verify skill, automatically:** a web app (a Playwright config or a dev-server script) or a runnable program (a CLI or desktop binary: `src/main.rs`, `src/bin/`, `[[bin]]`, `src-tauri/`) with no `.claude/skills/verify-*/` folder: follow `.claude/skills/create-verification-skill/SKILL.md` now, once, before the first ticket (it commits `verify-<app>`). If the app cannot start here (missing env values, local database down), skip it, use plain Playwright checks, and say so in the end report.

## Routing: the tier the task needs

Score each ticket on risk, size, unclear approach and UI (codemap and a quick look only), then pick the tier. First match from the bottom up:

| Tier | Agent | Model · effort | Start here when |
|---|---|---|---|
| 1 | `worker-sonnet-low` | Sonnet · low | mechanical: copy, docs, config, renames, styling; no logic |
| 2 | `worker-sonnet` | Sonnet · medium | normal feature, UI, tests, a fix with a known cause, up to 5 files |
| 3 | `worker-opus` | Opus · medium | risky (auth, permissions/RLS, personal data, payments, migrations, secrets) or 6+ files |
| 4 | `worker-opus-high` | Opus · high | risky AND the approach is unclear |
| 5 | `worker-fable` | Fable · medium (Opus · xhigh when Fable is off) | a change across modules or to the architecture |

UI work that is also risky goes by its risk. A `## Learned rules` line in CLAUDE.md that says where a ticket type starts beats this table. Pick the fit, not the cheapest: a ticket started too low burns a failed round.

**Moving up:** only after an **unexpected** failure (the check fails for a reason the worker could not have seen coming, or review finds a BLOCKER), one tier at a time. A failure the findings explain goes back to the **same** tier with the findings. Fable also takes over after two failed rounds at tier 4.
**Fable catcher:** if `worker-fable` cannot start, says the model is not available, has no access or needs usage credits, or Kim declines the credit prompt: run `node .claude/tools/apply-models.mjs --no-fable` (tier 5 becomes Opus xhigh, remembered in `.claude/models.json`), dispatch `worker-fable` again, and say "Fable off: Opus xhigh stood in" in the end report. Any other worker that cannot start: use the next tier up and say so.

## Per ticket

1. **Read** the ticket. List the files it will likely touch (codemap first, quick look only).
2. **Route:** one line, e.g. `03 Export CSV → tier 2 worker-sonnet (normal feature, UI, 3 files)`.
3. **Check first (red):** follow `.claude/skills/verify-ticket/SKILL.md`, "Before the build". You write the check, never the builder. Note the check file's hash.
4. **Build:** dispatch the tier's agent, in the foreground:
   ```
   JOB: build ticket <path>   Title: <title>
   What to build: <from the ticket>
   Acceptance criteria: <verbatim>
   Verify file: <path or command> (make it pass; never edit it)
   Spec: .scratch/<feature>/spec.md   Likely files: <list>
   Debt to avoid / area notes: <from health.md, if the ticket touches a listed area>
   Docs: <framework and version the ticket leans on, e.g. Next.js 15 App Router, Supabase JS 2; or none>
   Retry only - fix ONLY these findings: <list>
   ```
   Never run checks while a worker is still building: the check is red on purpose until the worker is done.
5. **Green:** follow verify-ticket, "After the build" (same check unchanged and passing, `node scripts/check.mjs --fast`, and for anything a user touches one drive of `verify-<app>` with evidence). Long output goes to `Explore` for the failing lines. Any failure = a fix round. **Flaky tests:** never call a run green "apart from the flaky ones". A test that fails and then passes on a rerun with no code change is flaky: rerun only that test once, alone; if it passes, add `flaky: <test file>` as a High item on the Debt list and carry on.
6. **Review** (on the tier the ticket ran on, Sonnet at least): follow `.claude/skills/code-review/SKILL.md` on the uncommitted changes (fixed point: HEAD) against the ticket, plus a third axis, **long-term**: module boundaries, duplication, reuse of what the codemap lists, drift from the target architecture in health.md. Check `## How code is written` in CLAUDE.md: a wrapper with one caller, a speculative guard, a test pinned to internals, a symptom fix instead of the root cause = MAJOR. Tier 3+ tickets: every protected action has a test proving it is denied. **Comments:** delete every comment in the diff that only narrates what the code does (keep license headers, outside-library quirks, public API docs, issue links). Give each BLOCKER/MAJOR a short kebab-case tag (`missing-input-validation`, `duplicate-helper`). **Floor:** a `NOTE floor` line from check.mjs is a MAJOR (`silenced-check`) unless the reason is outside the code's control (a library's wrong types, generated code): then keep it and add `Floor-exception: <rule> <path> - <reason>` to the commit message in step 8. **Docs:** an `UNVERIFIED:` item from the worker in auth, data or payments code: check it against the official docs yourself, or it is a MAJOR. **Size:** a diff over about 500 changed lines (`git diff --shortstat HEAD`) is a MINOR `too-big` (the ticket should have been split) and gets reviewed file group by file group.
6b. **Doubt** (Addy Osmani's doubt-driven development), only for tier 3+ tickets, tickets touching auth, permissions/RLS, personal data, payments, migrations or secrets, and any commit with a Floor-exception: once review is clean, dispatch the `doubter` agent (foreground) with the CHANGE (`git diff HEAD -- <ticket files>`) and the CONTRACT (the acceptance criteria verbatim, plus the CLAUDE.md Rules and Safety lines that apply). Never pass the worker's report, its DONE or your review: a fresh reader is the point. Sort each finding: **actionable** (it breaks the contract: a fix round on the same tier, then doubt again), **contract misread** (the doubter read the contract wrongly: drop it, but tighten the ticket's wording if a reader could misread it), **trade-off** (a choice the spec made on purpose: name it in the end report), **noise** (no proof in the code: drop it). At most 3 doubt cycles; still actionable after that = `Status: blocked`. No cross-model check: the doubter runs on Opus high and the end report says `doubt: Opus, fresh context`.
7. **Fix round:** BLOCKER or MAJOR findings, or a failed check, go back with the findings only: same tier when the findings explain the failure, one tier up when it was unexpected. After 3 fix rounds (or tier 5 failing): set the ticket `Status: blocked` with the reason, restore its files (`git checkout -- <files>`), continue with tickets that don't depend on it.
8. **Commit** on the current branch: verify-ticket already set `Status: done` and its `Verified:` line. `git add` the ticket's files, its check file and the ticket file explicitly, then `git commit -m "<NN>: <title>"`. Plain message: no Co-Authored-By, Claude-Session or "Generated with" lines (the commit-msg hook strips them and checks that Kim is the author), plus any `Floor-exception:` lines from review. Pre-commit runs format, typecheck, tests, the secret scan and the learned checks; commit-msg runs the floor guard. A failure is a fix round (put the ticket back to its old status until it passes); never answer a floor finding with an exception line the review did not agree to.
9. **Log:** append one line to `.claude/memory/runs.log`: `<date> | <feature> | <NN> | <type: chore/normal/risky/major> | start tier <n> → end tier <n> | rounds <n> | verify <pass/none> | <done/blocked> | tags <review tags and the ticket's `Cause tag:`, or -> | swarm <yes/no> | doubt <n findings, or skip>`.

## Swarm mode

Builds up to `maxAgents` tickets (default 5) at the same time, each on its own tier and in its own git worktree, so workers never edit the same files or run their tests in the same folder.

0. **Usage guard, before each batch:** `node scripts/swarm.mjs usage` prints the batch size: `batch 1` means normal (one ticket at a time) until a later batch reads lower usage; a smaller number caps the batch. Say any drop in the end report (`usage guard: normal from ticket 04 (5h 83%)`). `usage unknown` (no status line numbers, e.g. the desktop app or a cloud session) keeps `maxAgents`. A worker that stops on a usage limit (its reply or error says usage limit, rate limit or limit reached): start no new batch, collect what finished, run the rest one at a time; if this session hits the limit too, the end report says to run `/deliver` on the folder again later.
1. **Pick a batch:** open tickets whose "Blocked by" tickets are done and whose likely files do not overlap. A ticket that touches shared setup (migrations, `package.json`, lockfile, config, routing, shared types) goes alone, before the others. One big task instead of tickets: split it into up to `maxAgents` independent parts by module, each with its own acceptance criteria and check, and treat each part as a ticket.
2. **Checks first, in the main folder:** write each ticket's check and run it red (verify-ticket, one at a time). Note each check file's hash.
3. **Dispatch the batch in ONE message:** one Agent call per ticket, the tier's agent, `isolation: "worktree"`, foreground. The brief is the normal brief plus `WORKTREE: yes` and the check file's full content: the worktree starts from the last commit, so the uncommitted check is not there; the worker writes it unchanged at the same path.
4. **Bring the work home, one ticket at a time, in number order:** `node scripts/swarm.mjs collect <worktree path> --check <check file>`. It applies the worker's changes to the main folder, leaves your check file as you wrote it (it says if the worker changed its copy: treat that as a finding), and removes the worktree. A patch that does not apply cleanly is saved to `.trash/swarm/` and nothing changes: build that ticket again, alone, on top of the others.
5. Then steps 5 to 9 of "Per ticket" for that ticket in the main folder (green, review, fix rounds on the same tier without a worktree, commit), before collecting the next one. One commit per ticket, as Kim, through the normal hooks.
6. **No worktrees** (the Agent call rejects `isolation`, or a worktree fails to start): run the batch one ticket at a time and say "swarm off: no worktrees" in the end report. Leftover worktrees after a crash: `node scripts/swarm.mjs list`, then `collect` or `node scripts/swarm.mjs drop <path>`.

Workers in worktrees run only typecheck and the unit tests of their own files. e2e, `verify-<app>` and the full fast check run in the main folder, one at a time: parallel runs on one machine fight over ports and make timing tests flake.

## After the last ticket (codebase care)

1. **Health:** `node scripts/quality-ratchet.mjs --report`; append `<date> · <feature> · <report>` to the Health log in `.claude/memory/health.md` (report only: it never blocks).
2. **Debt list:** add every worker `Shortcuts:` item and unfixed MINOR finding (what, where, impact High/Med/Low). Mark items this feature paid off as done.
3. **Codemap:** dispatch `Explore`: "Read `git diff --stat <start>..HEAD` and the changed files. Reply with one line per new or changed module or shared component/helper (what, where, public entry)." Merge its lines into `.claude/memory/codemap.md` yourself; keep it under 150 lines.
4. **Learned checks (a mistake made twice becomes a check, not a note):** a repeat is the same review tag or the same `Cause tag` (from /fix) on 2+ tickets in runs.log, the same check failure twice, or Kim correcting the same thing twice. Fix each repeat at the highest level that works (Lauren Tan's order): structure or types when small (one owner per piece of state, a type that makes the bad state impossible); the linter's own rule (Biome or ESLint config); a test when the mistake is behavior; a learned check last, for a code pattern the linter cannot express: `node scripts/learned-checks.mjs --add '{"id":"<tag>","why":"<what went wrong, twice>","files":["src/**/*.tsx"],"pattern":"<regex>","message":"<the fix>"}'` (existing hits: fix them or add `--grandfather`). `node scripts/check.mjs --fast` must pass; commit as `chore: learned check <tag>`, then add one line under `## Learned rules` in CLAUDE.md naming what enforces it. A judgment call no check can catch stays a rule line only.
5. **Learned routing:** count runs.log lines per ticket type. A type with 4+ tickets where more than half ended above their start tier: add `Start <type> tickets at tier <n+1>.` under `## Learned rules`. A type with 4+ tickets that all passed on the first try at tier 3 or above: add `Try <type> tickets one tier lower.` One routing rule per type (replace, don't stack).
6. **Verify map:** `verify-<app>` exists and the feature added or changed something a user touches: follow `.claude/skills/maintain-verification-skill/SKILL.md` for those features only.
7. **Reflect:** a ticket needed 2+ fix rounds or got blocked: follow `.claude/skills/reflect/SKILL.md` for this run (checks and rule lines now; skill-text changes wait for Kim's "apply reflect").
8. **Save the notes:** what was built where, decisions, traps → `docs/agents/notes.md` under the area's heading (never CLAUDE.md, which only gets rule lines). Commit with explicit paths: `git add .claude/memory .scratch/<feature> CLAUDE.md` (plus `docs/agents/notes.md`, `GLOSSARY.md`, `docs/adr` if changed), `git commit -m "chore: update project notes (<feature>)"`.
9. **Next:** a High item on the Debt list: name it and suggest it as a ticket in the next feature. Flaky tests first: the fix is to wait for the condition (`expect.poll`, `findBy*`, fake timers), never a longer sleep or a retry.

Optional, only when Kim asks or the Vercel/Supabase connectors are on: production signals (last 7 days of runtime errors, Supabase advisors; read-only) onto the Debt list.

## End report (short)

One line per ticket (start → end tier, rounds, verify, doubt findings, committed or blocked; `swarm` when it ran in a batch), the health line, new debt items, new dependencies (name, why), new learned checks, every `Floor-exception` (rule, path, reason: the bar lowered on purpose), UNVERIFIED doc items left, any usage-guard drop, then **TEST IT YOURSELF**: only what a machine could not judge (looks right, reads right, feels fast), as checkboxes with what to open and click. List what was already machine-verified in one line. Close with: on the Mac "Then say `push it, I authorize` (pre-push checks run first)"; in a cloud session "Then say `ship it, I authorize` (rebases this branch on main and pushes it to main; no PR)", plus "not backed up yet" if the branch was never pushed. Never push, never open a pull request. Cut off by a usage limit: run `/deliver` on the folder again; done tickets are skipped.
