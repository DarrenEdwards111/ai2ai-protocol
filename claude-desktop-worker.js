#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = next;
      if (next !== true) i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const prompt = args.prompt;
  const cwd = args.cwd || process.cwd();
  const outPath = args.out || path.join(process.cwd(), 'claude-task-result.json');
  const claudeBin = args.claude || 'claude';

  if (!prompt) {
    console.error('Usage: claude-desktop-worker.js --prompt "..." [--cwd /path] [--out file] [--claude /path/to/claude]');
    process.exit(1);
  }

  const result = {
    startedAt: new Date().toISOString(),
    cwd,
    prompt,
    ok: false,
    exitCode: null,
    stdout: '',
    stderr: ''
  };

  await new Promise((resolve) => {
    const child = spawn(claudeBin, ['--permission-mode', 'bypassPermissions', '--print', prompt], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout.on('data', (d) => { result.stdout += d.toString(); });
    child.stderr.on('data', (d) => { result.stderr += d.toString(); });

    child.on('close', (code) => {
      result.exitCode = code;
      result.ok = code === 0;
      result.finishedAt = new Date().toISOString();
      resolve();
    });

    child.on('error', (err) => {
      result.stderr += `\nSPAWN_ERROR: ${err.message}`;
      result.exitCode = -1;
      result.ok = false;
      result.finishedAt = new Date().toISOString();
      resolve();
    });
  });

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
