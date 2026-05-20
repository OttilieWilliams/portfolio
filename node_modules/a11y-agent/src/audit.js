import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { spawn } from 'child_process';
import waitOn from 'wait-on';
import { readFileSync, existsSync } from 'fs';
import { formatFindings, formatFindingsMarkdown, writeBaseline as saveBaseline, loadBaseline } from './report.js';
import { updatePRComment } from './github.js';

const ALIASES = {
  'contrast': 'cat.color',
  'alt-text': 'cat.text-alternatives',
  'labels': 'cat.forms',
  'aria': 'cat.aria',
  'structure': 'cat.structure',
  'keyboard': 'cat.keyboard',
  'tables': 'cat.tables',
  'sensory': 'cat.sensory-and-visual-cues',
};

export function resolveCategory(input) {
  return ALIASES[input] ?? input;
}

function loadConfig() {
  if (!existsSync('.a11y.config.json')) {
    throw new Error('No .a11y.config.json found in current directory.');
  }
  const config = JSON.parse(readFileSync('.a11y.config.json', 'utf8'));
  return {
    startCommand: config.startCommand,
    port: config.port ?? 3000,
    paths: config.paths ?? ['/'],
    wcag: config.wcag ?? 'AA',
    mode: config.mode ?? 'all',
    aliases: { ...ALIASES, ...(config.aliases ?? {}) },
  };
}

function categorise(violations) {
  const findings = [];
  for (const violation of violations) {
    const category = violation.tags.find(t => t.startsWith('cat.')) ?? 'cat.other';
    for (const node of violation.nodes) {
      findings.push({
        category,
        ruleId: violation.id,
        description: violation.description,
        helpUrl: violation.helpUrl,
        selector: node.target.join(', '),
        summary: node.failureSummary,
      });
    }
  }
  return findings;
}

export async function runAudit({ writeBaseline = false, silent = false } = {}) {
  const config = loadConfig();

  let appProcess;
  if (config.startCommand) {
    const [cmd, ...args] = config.startCommand.split(' ');
    appProcess = spawn(cmd, args, { shell: true, stdio: 'ignore' });
    await waitOn({ resources: [`tcp:${config.port}`], timeout: 60000 });
  }

  const allFindings = [];
  const browser = await chromium.launch();
  const context = await browser.newContext();

  try {
    for (const path of config.paths) {
      const url = `http://localhost:${config.port}${path}`;
      const page = await context.newPage();
      await page.goto(url);

      const standard = config.wcag === 'AAA' ? ['wcag2a', 'wcag2aa', 'wcag2aaa'] :
                       config.wcag === 'AA'  ? ['wcag2a', 'wcag2aa'] : ['wcag2a'];

      const results = await new AxeBuilder({ page })
        .withTags(standard)
        .analyze();

      const findings = categorise(results.violations).map(f => ({ ...f, path }));
      allFindings.push(...findings);
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
    if (appProcess) appProcess.kill();
  }

  if (writeBaseline) {
    saveBaseline(allFindings);
    console.log(`Baseline written: ${allFindings.length} violation(s) captured.`);
    return allFindings;
  }

  let reportFindings = allFindings;
  if (config.mode === 'new-only') {
    const baseline = loadBaseline();
    const baselineKeys = new Set(baseline.map(f => `${f.path}::${f.selector}::${f.ruleId}`));
    reportFindings = allFindings.filter(
      f => !baselineKeys.has(`${f.path}::${f.selector}::${f.ruleId}`)
    );
  }

  if (!silent) {
    const inCI = process.env.GITHUB_TOKEN && process.env.PR_NUMBER;
    if (inCI) {
      await updatePRComment(formatFindingsMarkdown(reportFindings, config.aliases));
    } else {
      formatFindings(reportFindings, config.aliases);
    }
  }

  return reportFindings;
}
