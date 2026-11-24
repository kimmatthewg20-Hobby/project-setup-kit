---
name: create-verification-skill
description: Generate this repo's own verify-<app> skill - how to launch the app from an empty dev database, check it is healthy, drive features the way a user does, capture evidence (screenshots and the database rows that changed) and clean up - plus a feature map, then run it once end to end. Use for /create-verification-skill, when /deliver or project-setup finds no verify-<app> skill, or when Kim asks for a repeatable way to prove the app works.
model: opus
effort: medium
---

# Create a verification skill

Adapted from pstack by Lauren Tan (cursor/plugins, MIT). Tests prove code paths; this skill proves the real app does what a user expects. Write the output for the next agent, who reads it cold in the middle of a ticket and has never seen the app.

## 1. Interview the repo, not Kim

Answer from the code; ask Kim only what the code cannot show:
- **Surface:** what a user touches (web UI, API, CLI). Pick the main one; note the rest.
- **Launch:** the repo's own dev command (package scripts, README), port, local Supabase (`supabase start`, migrations, seed), the env files Playwright loads, the dev test account.
- **Drive:** the existing harness first (Playwright config, e2e helpers, sign-in fixture). Stable handles only: roles, labels, test ids, routes. Never coordinates. A CLI: build once (`cargo build`), then run the binary (`target/debug/<bin>`) with args and stdin in a temp dir. A Tauri app: Playwright on the web part's dev server with `invoke` mocked; the native window is a TEST IT YOURSELF item (no WebDriver for it on the Mac).
- **Observe:** screenshots, response bodies, a CLI's stdout, exit code and output files, and the database state a feature changes (read through local Supabase with the test account, or `supabase db` read-only queries on the local stack).
- **Isolate:** can two instances run at once (ports, data)? If not, say so: refuse to drive an instance someone else is using.
If the app does not build or start as it is, fix that first (or report it exactly). A skill written against a broken base teaches wrong steps.

## 2. Write `.claude/skills/verify-<app>/SKILL.md`

Frontmatter `name: verify-<app>` and a description naming the app, the surface and when to use it. Sections, every one grounded in what step 1 found (no placeholders):
- **Launch:** exact commands, from an empty local database (migrations and seed included) to a usable state, and how to tell it is ready (usable, not just "the port answers").
- **Doctor:** one read-only check: right build, port owned by this run, local Supabase up, test account can sign in. Run it first, and again after anything surprising.
- **Drive:** the recipe with this repo's real selectors and routes, through the real user path. Never internal setters, test-only endpoints or direct database writes to fake a state.
- **Evidence:** what to capture and where (`.trash/evidence/<ticket or feature>/`): the action, the resulting screen, and the side effect (the row written, the file produced). Mocks only where a real external system is already isolated.
- **Cleanup:** stop only what this run started, never by process name. Evidence survives cleanup.
- **Helpers:** any helper script lives in the skill folder, is runnable as `node .claude/skills/verify-<app>/<name>.mjs`, and is shown in the skill body.

## 3. Seed the feature map

`.claude/skills/verify-<app>/features/README.md` (index) plus one file per main user-facing feature (start with the top 3-5, from routes, menus and the spec). Each file has four sections: **Sub-features**, **How a user gets to it**, **Driving it** (exact steps), and **Gotchas**. A precondition the seed data lacks is a reported failure and a Gotcha, never a weaker journey.

## 4. Prove it before handing it over

Run it once end to end: launch, doctor, drive one mapped feature, capture evidence, clean up, then confirm the evidence still exists. Fix what fails and run cleanup after every failed attempt. A verification skill that never ran is a draft. Fake data only; dev or local database only.

## 5. Commit and hand over

Commit the skill folder as `chore: verify-<app> skill` (as Kim, no AI lines). Tell Kim in two lines what it covers, and that `/maintain-verification-skill` keeps the map current (/deliver runs it for features it changes).
