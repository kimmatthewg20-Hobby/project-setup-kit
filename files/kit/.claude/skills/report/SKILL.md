---
name: report
description: One-page report of the repo - what shipped, what is blocked, how the debt moved, what waits for Kim (unpushed commits). Read-only. Use for /report (the last 24 hours) or /report week, or when Kim asks what happened today or this week.
allowed-tools: Bash Read
model: sonnet
effort: low
---

# Report

1. Run `node scripts/report.mjs` (`/report week`: `--days 7`; Kim names days: `--days <n>`). Add `--save` when Kim asks to keep it (saved under `.claude/state/reports/`, local only).
2. Show the page exactly as printed. It is the answer; do not retell it.
3. Under it, at most three lines headed **Next:** the blocked ticket to unblock first (and what it needs from Kim), the top High debt item as a ticket idea, and "push it, I authorize" when commits wait. Nothing else.

Read-only: never commit, edit a ticket or change the Debt list from here. Missing `scripts/report.mjs`: tell Kim to run `/project-setup update`.
A daily report on a schedule: a scheduled task in a cloud session can run `/report` each weekday; it sees only what was pushed.
