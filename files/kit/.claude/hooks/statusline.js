#!/usr/bin/env node
// Status line (project-setup v6.0). Shows model, mode and plan usage, and saves the usage numbers to
// .claude/state/usage.json so /deliver's swarm usage guard can read them (scripts/swarm.mjs usage).
// Claude Code sends the numbers only on Pro and Max plans, after the first reply of a session. Where no status line
// runs (some desktop and cloud sessions) the file goes stale and the guard falls back to worker usage errors.
const fs = require('fs');
const path = require('path');
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const root = process.env.CLAUDE_PROJECT_DIR || (input.workspace && input.workspace.project_dir) || input.cwd || process.cwd();
  const pct = w => {
    const v = w && (w.used_percentage ?? w.utilization);
    return typeof v === 'number' && isFinite(v) ? Math.round(v) : null;
  };
  const rl = input.rate_limits || {};
  const five = pct(rl.five_hour), week = pct(rl.seven_day);
  if (five !== null || week !== null) {
    try {
      fs.mkdirSync(path.join(root, '.claude/state'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude/state/usage.json'), JSON.stringify({
        at: Date.now(), fiveHour: five, sevenDay: week,
        fiveHourResets: (rl.five_hour && rl.five_hour.resets_at) || null, sevenDayResets: (rl.seven_day && rl.seven_day.resets_at) || null,
      }));
    } catch {}
  }
  let kit = {};
  try { kit = JSON.parse(fs.readFileSync(path.join(root, '.claude/kit.json'), 'utf8')); } catch {}
  const model = (input.model && (input.model.display_name || input.model.id)) || 'Claude';
  const parts = [model, kit.swarm === true ? `swarm ${kit.maxAgents || 5}` : 'normal'];
  if (five !== null) parts.push(`5h ${five}%`);
  if (week !== null) parts.push(`7d ${week}%`);
  console.log(parts.join(' · '));
});
