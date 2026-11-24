# Codebase health
Read before planning, ticketing and building. /deliver updates it. Kim may edit any line.

## Target architecture
<!-- 10-15 lines, written by /project-setup from the real code; the grill updates it when Kim decides. -->
- Layout: <folders and what lives where>
- Boundaries: features only talk through their index; shared UI has no data access; data access only in queries/actions.
- Data: <database, auth model, RLS approach>
- Direction: <where the code should move, e.g. "move old pages/ routes into src/features/">

## Roadmap
- Now: <current feature>
- Next: <1-3 items>
- Later: <ideas>

## Quality goals
- Ratchet numbers only go down (scripts/quality-ratchet.mjs). Page load: CLS < 0.1, LCP < 2.5 s.
- <app-specific goals>

## Debt list
| What | Where | Impact | Status |
|---|---|---|---|

## Health log
<!-- /deliver appends: date · feature · ratchet report -->
