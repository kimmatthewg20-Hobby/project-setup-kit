---
name: verify-ticket
description: Prove one ticket works before it counts as done, the Matt Pocock and Lauren Tan way - a check written before the build that fails (red), the same check passing after it (green), the fast checks, and for anything a user touches one run of verify-<app> on the real app with evidence. Use inside /deliver for every ticket, or when Kim runs /verify-ticket on a ticket file.
model: sonnet
effort: medium
---

# Verify ticket

Done means proven on the real thing, not "the worker said DONE". No gate files: the orchestrator runs the checks itself and writes one `Verified:` line.

## Before the build: red

1. The ticket's `Verify by:` line names the check: a Playwright spec for UI (`e2e/<feature>/<NN>-<slug>.spec.ts`), a CLI test for a command-line program (Rust: a module in `tests/cli.rs` with `assert_cmd`), a test command for logic or an API, or `none (no behavior)` for docs and config. No line: derive one from the acceptance criteria and add it to the ticket.
2. Write the check yourself (the builder never writes its own acceptance test). Cover every acceptance criterion; give each test a title that names its criterion.
   - **UI:** visible labels and roles (`getByRole`, `getByLabel`), fake data, the dev test account. Learn the screen from its code first (labels, field order, fields that stay disabled until another is filled). At most one probe run of the live page, in the foreground, with `--timeout 15000`, then delete the probe with `node scripts/trash.mjs`. When `.claude/skills/verify-<app>/` exists, use its launch, doctor and drive recipes and assert the side effect too (the row written, the file produced), not only the screen.
   - **API / server action:** a test or a small script under `e2e/checks/` with the expected status and fields.
   - **CLI:** run the real binary with the ticket's args and stdin in a temp dir; check stdout, stderr, exit code and the files it writes (Rust: `assert_cmd` + `predicates` in `tests/cli.rs`; others: the stack's runner).
   - **Pure logic:** a unit test at the public seam (Rust: in the module's `#[cfg(test)] mod tests`, or `tests/` for the public API).
3. Run it once (UI: `node scripts/check.mjs --e2e <spec>`; Rust: `cargo test --test cli <name>` or `cargo test <name>`; otherwise its command). It must fail, and on the missing behavior, not on a selector, a login or a server that is down. A check that passes already proves nothing: make it test the new behavior.
4. Note the check file's hash (`git hash-object <file>`). The builder may not change it.

## After the build: green

5. The hash is unchanged. Changed: find out why; a check weakened to pass is a BLOCKER.
6. Run the same check, then `node scripts/check.mjs --fast` (format, lint, typecheck, tests, learned checks for every stack; the ratchet only reports).
7. Something a user touches and `verify-<app>` exists: drive the feature once through its recipe and keep the evidence in `.trash/evidence/<NN>/` (the screen and the side effect).
8. All green: set `Status: done` and add one line under it: `Verified: <check> PASS · fast checks PASS · app evidence <path or "n/a"> (<date>)`. Anything red is a fix-round finding, word for word (full logs in `.trash/logs/`).
9. The check itself turns out wrong after the build: `git stash push -- <changed source files>`, fix the check, run it red again, `git stash pop`, run it green, and say so in the end report.

## Rules

- Never call a ticket done on "tests pass except the flaky ones", "checked by hand" or "worked in my run".
- Never weaken a test, a lint rule or a learned check to get green.
- One check run at a time, in the foreground: parallel runs make timing tests flake.
