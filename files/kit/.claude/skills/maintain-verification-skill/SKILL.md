---
name: maintain-verification-skill
description: Keep verify-<app> and its feature map honest after the app changed - read each mapped feature in the source, drive every one live once, fix drift in the skill only, and report real product bugs instead of hiding them. Use for /maintain-verification-skill, after /deliver changes or adds a user-facing feature, or when a verify-<app> step no longer matches the app.
model: sonnet
effort: medium
---

# Maintain the verification skill

Adapted from pstack by Lauren Tan (cursor/plugins, MIT). A feature map rots the moment the app changes. Scope: the whole map, or only the features Kim or /deliver names.

## Outcomes (say which)
- **clean:** every feature in scope was read in the source and driven live; nothing to change.
- **changed:** proven corrections to the skill or map, committed as `chore: update verify-<app>`.
- **blocked:** coverage could not finish; say exactly why.

## Edit scope
Edit only `.claude/skills/verify-<app>/` (its SKILL.md, features/ and helper scripts). Never product code. A behavior the map describes that the app no longer has is either map drift (fix the map) or a product bug (put it on the Debt list as High and in the report; never paper over it in the docs).

## Pass
1. **Index:** the features README matches the feature files (no missing, extra or dead entries).
2. **Source read:** one `Explore` agent (Haiku, read-only) per feature in scope, at the same time. Each returns: how the feature works now, its source entry points, likely drift with file references, and one live recipe.
3. **Reconcile:** merge the recipes into as few app states as possible. Look for user-facing features added since the map was written (cite the source path before calling one missing).
4. **Live pass (always, even when the source looks clean):** you drive, in the foreground, one feature at a time: doctor before the first drive and after any failure, evidence kept, everything this run started stopped at the end. A feature that cannot be reached is `unreachable` only with the exact missing precondition.
5. **Triage:** wrong description = drift, fix it. Working behavior the harness cannot drive = harness gap, fix it and drive it again. Broken behavior = product bug, report it.
6. **Finish:** for changed, re-read every changed file, commit as Kim (no AI lines, no PR, no push). Report outcome, features covered, drift fixed, bugs found.
