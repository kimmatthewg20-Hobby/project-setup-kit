---
name: webperf
description: Web performance audit of this app's pages (after Addy Osmani's web-performance-auditor) - Core Web Vitals, loading, rendering and network, with a metric-honesty rule - quick mode reads the code, deep mode measures a production build with Lighthouse or reads a report Kim gives. Findings go on the Debt list; nothing is changed. Use for /webperf, or when Kim asks why a page is slow or how fast the app is.
allowed-tools: Bash Read Glob Grep Agent Edit Write
model: sonnet
effort: medium
---

# Web performance audit

Web apps only (pages a browser loads). Not for libraries, CLIs or server-only code. Read-only on product code: it writes findings, never fixes.

## Metric honesty (the one hard rule)

Reading code cannot measure LCP, INP or CLS. No measurement: the scorecard says `not measured` and every finding is `potential impact`. With data, every number names its source: `Field (CrUX)`, `Lab (Lighthouse, local production build, 1 run)`, `Lab (PageSpeed)`. Field and lab numbers are never mixed or averaged. A made-up number is worse than no scorecard.

## Mode

- **Deep:** Kim gives a Lighthouse or PageSpeed Insights JSON (read it), or the app can run here: `node scripts/check.mjs --only build`, start the production server with the launch recipe in `.claude/skills/verify-<app>/` (it knows how this app starts and stops; no recipe: Quick mode, and say why), then one Lighthouse lab run per page: `npx -y lighthouse@12 http://localhost:<port>/<path> --only-categories=performance --output=json --output-path=.trash/perf/<page>.json --chrome-flags="--headless=new"`. No Chrome on the machine: get Playwright's with `node -e "console.log(require('@playwright/test').chromium.executablePath())"` and put `CHROME_PATH=<that path>` in front. Never measure the dev server (its numbers mean nothing); never point it at production.
- **Quick (default when Deep cannot run):** read the code. Read the stack and versions from package.json first: Next.js advice to a Next.js app only.

## What to look at (pages Kim named, else the 3 busiest routes)

1. **Core Web Vitals:** the LCP element (hero image or heading) is not lazy-loaded and gets priority (`next/image` with `priority`, or `fetchpriority="high"`); images, embeds and ads reserve their size; fonts through `next/font` (or `font-display: swap`); no long tasks in click handlers (INP).
2. **Loading:** first-load JavaScript per route (from the build output), code splitting for heavy widgets (`next/dynamic`), Server Components for data and static parts, no blocking third-party scripts (`next/script` with the right strategy), modern image formats.
3. **Rendering:** state kept where it is used, no `useMemo`/`useCallback` everywhere "just in case", no effect loops, long lists virtualized or paginated, animations on `transform`/`opacity`.
4. **Network and data:** no request waterfalls (independent awaits in `Promise.all`), no over-fetching (`select *`, unpaginated lists, missing indexes on filtered columns), cached static assets.

## Output

```
## Web performance · <date> · <Quick | Deep>
| Metric | Value | Source | Target | Status |
| LCP | <value or not measured> | <source or -> | ≤ 2.5 s | <Good/Needs work/Poor/-> |
| INP | ... | ≤ 200 ms (field data only: a lab run has no INP) |
| TBT | ... | ≤ 200 ms (lab stand-in for INP) |
| CLS | ... | ≤ 0.1 |
| Lighthouse performance | ... | ≥ 90 |
Measured: <JSON files used, or "none - code reading only"> · Stack: <framework and version>
Findings (worst first, at most 10): [Critical|High|Medium|Low] <title> - <file:line> - <why, with the number or "potential impact"> - <the fix in one line>
Good already: <1-3 lines>
```

Then: add each Critical and High finding to the Debt list in `.claude/memory/health.md` (`perf: <title>`, where, impact) and commit only that file (`chore: webperf findings`). Offer one next step: `/feature` for a performance slice, or `/fix` when a page got slower than it was. Stop the server with the recipe's stop step. Long build or Lighthouse output goes to `Explore`.
