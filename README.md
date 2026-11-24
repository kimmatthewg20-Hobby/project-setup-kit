# project-setup kit

Kim's Claude Code toolkit skill, `project-setup` (v5.3).

It sets up, updates, checks or explains one repo's toolkit, for any stack (TypeScript, Rust, Python, Go, or commands named in `.claude/kit.json`): the Matt Pocock and Lauren Tan way of working plus Addy Osmani's guards, `/feature` and `/fix` flows, `/deliver` (the ticket builder; renamed from `/ship` in v5.3 because Claude Code now has its own `/ship`), `/report`, `/webperf`, swarm mode, the floor guard, session lock, secret scan and hooks.

## Files

- `SKILL.md` — the whole skill. Every file it installs into a repo is written out inside it.

## Install

In Claude, add `SKILL.md` as a skill named `project-setup`, then in a repo run `/project-setup:project-setup` (or `update`, `check`, `explain`).

## Versions

Each kit version is one commit, tagged `vX.Y`.
