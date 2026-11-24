# Update notes for repos on older kits

`/project-setup update` reads `.claude/kit.json` `"version"` (missing = v5.3 or older) and applies every section newer than that version, oldest first. Steps refer to the Setup and Update steps in `SKILL.md`; KIT is the kit folder.

## v5 clean-up (does the v4 one too)

   - Build mode: `update swarm` / `update normal` sets it; no `.claude/kit.json` yet: ask the Setup step 3b question. Add `.claude/worktrees/` to the `.gitignore` block.
   - The proof gate is gone: delete the `node scripts/proof-gate.mjs "$1"` line from `.husky/commit-msg` and the `node scripts/quality-ratchet.mjs` line from `.husky/pre-commit`, then `node scripts/trash.mjs scripts/prove.mjs scripts/proof-gate.mjs`. Old `## Proof` blocks and `→ proof:` notes in tickets stay; they do no harm.
   - Write the new kit files (`feature` skill, `swarm.mjs`, the new `deliver`, `verify-ticket` and KIT-GUIDE) and re-run `node .claude/tools/apply-models.mjs` (it also drops an old `worker-sonnet-high`; step 12 checks the skill count).
   - Matt skills `wait-what` or `writing-for-agents` missing: Setup step 7 with just those names. `lighthouserc.json` or a CI `performance` job the kit wrote: delete them (ask if Kim changed them).
   - CLAUDE.md: replace the kit-owned sections with the template's (`## How code is written`, `## Safety`, `## Shell commands`, `## Git`, `## Router`, `## Planning cares about the long term`, `## How we work`) and the ratchet part of `## Commands`; keep Kim's Stack, Commands, Structure, Rules, Learned rules and Domain words. An older kit line that says the ratchet may only improve or must never be weakened is kit text, not Kim's rule: replace it with `Never weaken lint, typecheck, tests or learned checks to get green; the ratchet reports the trend.` (Kim chose a report-only ratchet in v5; do not keep it blocking).
   - Check finds other authors or AI lines in history: point Kim to section 11 of the kit guide.

## v5.2 additions (Addy Osmani's ideas, copied, no plugin)

   - Write the `fix`, `report` and `webperf` skills, the `doubter` agent, the new `deliver`, `feature`, `worker-body.md`, `check.mjs` and KIT-GUIDE, then re-run `node .claude/tools/apply-models.mjs` (must print `models set on 26 skills`; workers now get WebFetch and WebSearch for the docs rule).
   - `.husky/commit-msg`: add `node scripts/floor-guard.mjs "$1"` after the commit-identity line (Setup step 13). Only new lines are checked, so existing suppressions never block; tell Kim in one line that a commit silencing a check now needs a `Floor-exception:` line.
   - Settings (step 19, last): the SessionEnd hook and `statusLine` from the template (Kim's own user status line: tell him the kit's one replaces it in this repo).
   - `.claude/kit.json`: add the `usageGuard` defaults from Setup step 3b if missing (keep `swarm` and `maxAgents`).
   - CLAUDE.md: replace the kit-owned sections with the template's again (Router has the `fix` row, `## How code is written` the docs and no-silencing lines, Planning the ticket size).

## v5.3 additions (any stack)

   - **`/ship` is now `/deliver`.** Anthropic added its own `/ship` to Claude Code (Claude Ship, November 2026: it pushes, opens a pull request, reviews and approves it). Built-in commands win a name clash, so the kit's ticket builder is renamed: write `.claude/skills/deliver/`, then `node scripts/trash.mjs .claude/skills/ship`, re-run `node .claude/tools/apply-models.mjs` (still 26 skills), and replace `/ship` with `/deliver` in CLAUDE.md and in `docs/agents/notes.md`. Tell Kim in one line: type `/deliver`, never `/ship`, in kit repos (Anthropic's `/ship` would try a push and a PR; the guard blocks both without "I authorize", and PRs always).
   - Write the new `check.mjs`, `quality-ratchet.mjs`, `floor-guard.mjs`, `guard.js`, `session.js`, `test-hooks.mjs`, `deliver`, `verify-ticket`, `create-verification-skill` and KIT-GUIDE; `node .claude/tools/test-hooks.mjs` must pass.
   - Setup step 3c: `node scripts/check.mjs --list`, then fill `.claude/kit.json` `checks` for anything it misses. A repo whose old `check.mjs` found nothing to run (a Rust, Python or Go repo) was passing with no checks at all: tell Kim in one line, run the full check, and put anything red on the Debt list as High (with `--skip` in pre-push until green, as in Setup step 13).
   - CI: an existing `ci.yml` with a job-level `if: ${{ hashFiles(...) }}` (older templates put one on the e2e job): GitHub does not offer hashFiles at job level, so the workflow fails to load. Remove that line and delete the jobs for stacks the repo lacks (Setup step 15). Say in one line if Kim's CI was broken by it.
   - Rust repos: Setup step 4 (`target/`), step 13 (`.githooks/` if there is no Husky), step 14 (CLI end-to-end tests), step 15 (the `rust` CI job). `node scripts/quality-ratchet.mjs --report` shows the new Rust numbers; the next tightening records them, nothing is reset.
   - Settings (step 19, last): add the new `permissions.allow` entries and sandbox domains and paths from the templates (merge, keep Kim's).
   - CLAUDE.md: replace `## How code is written` with the template's again (silencing line names `#[allow]` and `#[ignore]`); for a non-web repo, rewrite `## Structure` and `## Rules` for its stack (Setup step 6).

## v6.0 (split kit, installed by clone)

   - Kit files now come from `KIT/files/kit/` through `node KIT/tools/install.mjs .` (Update step 3); it also writes `"version"` into `.claude/kit.json`.
   - Settings (step 19, last): merge the new `settings.local.json` `excludedCommands` entry `git -C <KIT> pull --ff-only` with KIT's absolute path (Mac only), so Step 0's pull can use Kim's GitHub login outside the sandbox.
   - `session.js` now says at session start when this repo's kit is behind the installed one; nothing to do.
   - Tell Kim in one line, once: the kit now lives in `~/.claude/skills/project-setup` (a clone); the old account copy in claude.ai Settings → Skills can be deleted.
