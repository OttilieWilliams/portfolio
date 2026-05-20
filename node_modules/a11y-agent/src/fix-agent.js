import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { resolveCategory } from './audit.js';

const PROJECT_ROOT = resolve(process.cwd());

function safePath(inputPath) {
  const resolved = resolve(PROJECT_ROOT, inputPath);
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + '/')) {
    return null;
  }
  return resolved;
}

function listFiles(dir) {
  const safe = safePath(dir ?? '.');
  if (!safe) return { error: 'Path must be within the project directory.' };
  try {
    return readdirSync(safe, { withFileTypes: true }).map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: join(dir ?? '.', e.name),
    }));
  } catch (err) {
    return { error: err.message };
  }
}

const ALLOWED_GIT_SUBCOMMANDS = ['add', 'commit', 'push'];

function executeTool(name, input) {
  switch (name) {
    case 'list_files':
      return listFiles(input.dir);

    case 'read_file': {
      const safe = safePath(input.path);
      if (!safe) return { error: 'Path must be within the project directory.' };
      if (!existsSync(safe)) return { error: `File not found: ${input.path}` };
      return { content: readFileSync(safe, 'utf8') };
    }

    case 'write_file': {
      const safe = safePath(input.path);
      if (!safe) return { error: 'Path must be within the project directory.' };
      writeFileSync(safe, input.content, 'utf8');
      return { success: true };
    }

    case 'run_command': {
      const parts = input.cmd.trim().split(/\s+/);
      if (parts[0] !== 'git' || !ALLOWED_GIT_SUBCOMMANDS.includes(parts[1])) {
        return { error: 'Only git add, git commit, and git push are permitted.' };
      }
      const result = spawnSync('git', parts.slice(1), { encoding: 'utf8', shell: false });
      if (result.error) return { error: result.error.message };
      if (result.status !== 0) return { error: result.stderr.trim() };
      return { output: result.stdout.trim() };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files and directories at a given path.',
    input_schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to list. Defaults to project root.' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a source file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, replacing its current contents.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a git command. Only git add, git commit, and git push are allowed.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'The git command, e.g. "git add -A".' },
      },
      required: ['cmd'],
    },
  },
];

export async function runFixAgent({ category: categoryInput = 'all', findings: allFindings = [] }) {
  const category = categoryInput === 'all' ? 'all' : resolveCategory(categoryInput);

  const findings = category === 'all'
    ? allFindings
    : allFindings.filter(f => f.category === category);

  if (findings.length === 0) {
    console.log('No findings to fix for this category.');
    return;
  }

  const designIntent = existsSync('ACCESSIBILITY.md')
    ? readFileSync('ACCESSIBILITY.md', 'utf8')
    : null;

  const prompt = [
    'You are an accessibility fix agent. Fix the following violations by making minimal,',
    'targeted edits to the source files. Do not change anything unrelated to these violations.',
    '',
    `Violations (${findings.length}):`,
    JSON.stringify(findings, null, 2),
    '',
    designIntent && `Design intent (ACCESSIBILITY.md):\n${designIntent}`,
    '',
    'Each finding has a `path` (the URL where it was found) and a `selector` (CSS selector',
    'of the affected element). Use these to locate the right file to edit.',
    '',
    'Steps:',
    '1. Explore the project with list_files, then read relevant source files.',
    '2. Apply fixes with write_file — one file at a time, minimal changes only.',
    '3. When all fixes are done: run "git add -A", then',
    `   "git commit -m \\"fix(a11y): fix ${categoryInput} violations [a11y-agent]\\"", then`,
    '   "git push".',
  ].filter(Boolean).join('\n');

  const anthropic = new Anthropic();
  const messages = [{ role: 'user', content: prompt }];

  console.log(`Fixing ${findings.length} ${categoryInput} violation(s)...`);

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const results = [];
    for (const block of toolUseBlocks) {
      console.log(`  → ${block.name}: ${JSON.stringify(block.input).slice(0, 100)}`);
      const result = executeTool(block.name, block.input);
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  console.log('Done.');
}
