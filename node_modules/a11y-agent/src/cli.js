#!/usr/bin/env node
import { runAudit } from './audit.js';
import { runFixAgent } from './fix-agent.js';
import { spawnSync } from 'child_process';

const command = process.argv[2];

const args = Object.fromEntries(
  process.argv.slice(3)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, ...rest] = a.slice(2).split('=');
      return [key, rest.join('=') || true];
    })
);

try {
  if (!command || command === 'audit') {
    await runAudit({ writeBaseline: false });

  } else if (command === 'baseline') {
    await runAudit({ writeBaseline: true });

  } else if (command === 'fix') {
    const category = args.category ?? 'all';
    const findings = await runAudit({ silent: true });
    await runFixAgent({ category, findings });

  } else if (command === 'revert') {
    if (!args.commit) throw new Error('--commit=<sha> is required for revert.');
    spawnSync('git', ['revert', '--no-edit', args.commit], { stdio: 'inherit', shell: false });
    spawnSync('git', ['push'], { stdio: 'inherit', shell: false });
    console.log(`Reverted ${args.commit} and pushed.`);

  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: a11y-agent [audit|baseline|fix|revert]');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
