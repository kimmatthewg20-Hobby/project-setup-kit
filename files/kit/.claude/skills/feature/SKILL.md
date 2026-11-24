---
name: feature
description: Take a feature from idea to committed, verified code in one go - grill Kim with Matt Pocock's grill-with-docs (the only part that needs him), then write the spec and the tickets and run /deliver to the end without stopping. Use for /feature, or when Kim asks for a new feature, a big change, or anything not yet specified. A bug goes to the fix skill instead.
allowed-tools: Bash Edit Write MultiEdit NotebookEdit Read Glob Grep Agent Skill TodoWrite
model: opus
effort: medium
---

# Feature: idea to shipped

Matt Pocock's flow (grill, spec, tickets, test-first build) with Lauren Tan's finish (proven on the real app, lessons turned into checks). Kim answers the grill; everything after it runs by itself. Kim can stop it any time (Esc). `/feature <idea> swarm` or `normal` overrides the repo's mode for this run.

0. **Session lock:** this session was told another Claude session is open on this folder and Kim has not said "go anyway": stop and tell him in one line.
1. **Size:** a change across several features or modules, or weeks of work: follow `.claude/skills/wayfinder/SKILL.md` first and run the steps below for its first slice.
2. **Grill:** follow `.claude/skills/grill-with-docs/SKILL.md` with Kim, one question at a time, recommended answer first. It ends when no open question is left that would change the build; then say `Grill done: building <feature>.` and go on. Do not ask "should I build it?": the answers were the go.
3. **Spec:** follow `.claude/skills/to-spec/SKILL.md` → `.scratch/<feature>/spec.md`. Where it asks Kim to review or approve, decide yourself with the grill's answers and note the choice in the spec.
4. **Tickets:** follow `.claude/skills/to-tickets/SKILL.md` → `.scratch/<feature>/issues/NN-<slug>.md`, thin vertical slices, each with testable acceptance criteria and a `Verify by:` line. Size each one at about 100 changed lines, 300 at most; bigger: split it (Addy Osmani's change sizing: small diffs get reviewed properly). Same rule: decide, do not wait. Mark which tickets touch shared setup (migrations, `package.json`, config), so swarm mode runs those alone.
5. **Save the plan:** `git add .scratch/<feature> GLOSSARY.md docs/adr` (paths that exist), `git commit -m "plan: <feature> spec and tickets"`.
6. **Build:** invoke the `deliver` skill (Skill tool) on `.scratch/<feature>/`, with `swarm` or `normal` if Kim gave one. It runs to its end report.
7. **Never push.** The end report tells Kim to test the short list and say "push it, I authorize".
