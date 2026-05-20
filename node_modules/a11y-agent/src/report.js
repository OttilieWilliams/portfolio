import { writeFileSync, readFileSync, existsSync } from 'fs';

const BASELINE_PATH = '.a11y-baseline.json';

export function writeBaseline(findings) {
  writeFileSync(BASELINE_PATH, JSON.stringify(findings, null, 2));
}

export function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

export function formatFindings(findings, aliases = {}) {
  if (findings.length === 0) {
    console.log('✓ No accessibility violations found.');
    return;
  }

  const byCategory = {};
  for (const f of findings) {
    (byCategory[f.category] ??= []).push(f);
  }

  const aliasLabel = Object.fromEntries(
    Object.entries(aliases).map(([alias, cat]) => [cat, alias])
  );

  console.log(`\n⚠ ${findings.length} accessibility violation(s) found:\n`);

  for (const [category, items] of Object.entries(byCategory)) {
    const label = aliasLabel[category] ?? category;
    console.log(`  ${label} (${items.length})`);
    for (const item of items) {
      console.log(`    [${item.path}] ${item.selector}`);
      console.log(`    → ${item.summary}`);
      console.log(`    ${item.helpUrl}\n`);
    }
  }
}

export function formatFindingsMarkdown(findings, aliases = {}) {
  if (findings.length === 0) {
    return '✅ No accessibility violations found.';
  }

  const byCategory = {};
  for (const f of findings) {
    (byCategory[f.category] ??= []).push(f);
  }

  const aliasLabel = Object.fromEntries(
    Object.entries(aliases).map(([alias, cat]) => [cat, alias])
  );

  const lines = [
    `## ♿ Accessibility audit — ${findings.length} violation(s)`,
    '',
    'Reply with `/fix <category>` to apply AI-generated fixes, or `/fix all` to fix everything.',
    '',
    '| Category | Count |',
    '|---|---|',
  ];

  for (const [category, items] of Object.entries(byCategory)) {
    const label = aliasLabel[category] ?? category;
    lines.push(`| \`${label}\` | ${items.length} |`);
  }

  lines.push('');

  for (const [category, items] of Object.entries(byCategory)) {
    const label = aliasLabel[category] ?? category;
    lines.push(`<details><summary><strong>${label}</strong> (${items.length})</summary>\n`);
    for (const item of items) {
      lines.push(`- **\`${item.selector}\`** on \`${item.path}\``);
      lines.push(`  ${item.summary}`);
      lines.push(`  [More info](${item.helpUrl})`);
    }
    lines.push('</details>\n');
  }

  return lines.join('\n');
}
