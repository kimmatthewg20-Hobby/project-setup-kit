---
name: fix
description: Take a bug from report to committed fix in one go - find the root cause (Matt Pocock's diagnosing-bugs), prove it with a test that fails because of the bug (Addy Osmani's Prove-It rule), then fix, check, review and commit as Kim through /deliver. Use for /fix, or when Kim reports something broken, an error, a wrong result or a regression.
allowed-tools: Bash Edit Write MultiEdit NotebookEdit Read Glob Grep Agent Skill TodoWrite WebFetch WebSearch
model: opus
effort: high
---

# Fix: bug to committed fix

Like /feature, but for something that used to work or should work. No fix without a test that fails because of the bug first: a fix nobody saw fail is a guess. Runs by itself after Kim's report; it asks only when the bug cannot be found from what he gave. `/fix <bug> swarm` or `normal` overrides the repo's mode for this run.

1. **Session lock:** this session was told another Claude session is open on this folder and Kim has not said "go anyway": stop and tell him in one line.
2. **Intake:** what happens, what should happen, where (page, action, account type), any error text. Real people's data in the report (a screenshot with names): never copy it into tests or notes; use fake data. Several separate bugs in one message: one ticket each (step 4).
3. **Diagnose:** follow `.claude/skills/diagnosing-bugs/SKILL.md`: reproduce it first (a test, a script or a `verify-<app>` drive), then narrow down to the cause. Long logs and wide searches go to `Explore`. Finish with one line: `Cause: <file:line> - <why it breaks> (symptom: <what Kim saw>)`. A symptom patch is not a cause; two fixes built on one idea failed: test the idea itself.
   - Cannot reproduce from the report and the code: ask Kim ONE question with your best guess first (`Is it the signed-in admin view, where...?`), then go on.
   - The cause is a design gap across modules, or the right fix is a new behavior: say so and hand over to the `feature` skill with the diagnosis as the idea.
4. **Ticket:** `.scratch/fixes/<YYYY-MM-DD>-<slug>/spec.md` (the report, the cause line, the chosen fix in two lines) and `issues/01-<slug>.md` in /to-tickets' format: what is broken (expected vs actual), `Cause:` line, `Cause tag: <kebab-case kind, e.g. missing-null-check>`, acceptance criteria (the bug is gone; nothing else changes; the same kind of input elsewhere is covered when it shares the code), `Verify by:` the regression test (a unit test at the public seam for logic, an e2e spec for a screen), likely files, and `The check must fail with: <the symptom>`. Under ~300 changed lines; bigger: split.
5. **Save the plan:** `git add .scratch/fixes/<folder>`, `git commit -m "plan: fix <slug>"`.
6. **Build:** invoke the `deliver` skill (Skill tool) on `.scratch/fixes/<folder>/`, with `swarm` or `normal` if Kim gave one. /deliver writes the regression test first and runs it red: it must fail with the symptom, not on setup. A check that cannot be made to fail means the cause is wrong: /deliver blocks the ticket; come back to step 3 once with what it found, then report BLOCKED with what was tried.
7. **Same bug twice:** /deliver's learned-check step uses the `Cause tag`: the same tag in runs.log twice becomes a lint rule, a learned check or a test, so the bug class cannot come back.
8. **Never push.** The end report tells Kim what to test and to say "push it, I authorize".

Bug and feature in one message: run /fix first (small, committed), then /feature, in that order.
