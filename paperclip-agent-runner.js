#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    args[key] = next;
    if (next !== true) i++;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

const args = parseArgs(process.argv);
const issueId = String(args.issue || args.task || `agent-${Date.now()}`);
const statusDir = String(args.statusDir || path.join(process.cwd(), 'paperclip-runtime-status'));
const logDir = String(args.logDir || path.join(process.cwd(), 'paperclip-runtime-logs'));
const cwd = String(args.cwd || process.cwd());
const label = String(args.label || issueId);
const cmd = String(args.cmd || '');

if (!cmd) {
  console.error('Missing --cmd');
  process.exit(2);
}

ensureDir(statusDir);
ensureDir(logDir);
const statusPath = path.join(statusDir, `${issueId}.json`);
const logPath = path.join(logDir, `${issueId}.log`);

const out = fs.createWriteStream(logPath, { flags: 'a' });
const child = spawn('/bin/bash', ['-lc', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

function update(extra = {}) {
  writeJson(statusPath, {
    taskId: issueId,
    label,
    status: extra.status || 'running',
    cwd,
    command: cmd,
    pid: child.pid,
    startedAt: start,
    updatedAt: now(),
    finishedAt: extra.finishedAt,
    exitCode: extra.exitCode,
    signal: extra.signal,
    logPath,
    source: 'paperclip-agent-runner',
    error: extra.error,
  });
}

const start = now();
update({ status: 'running' });

child.stdout.on('data', (d) => out.write(d));
child.stderr.on('data', (d) => out.write(d));
child.on('error', (err) => {
  out.write(`\n[runner-error] ${err.message}\n`);
  update({ status: 'failed', finishedAt: now(), error: err.message });
});
child.on('close', (code, signal) => {
  out.write(`\n[runner-exit] code=${code} signal=${signal || ''}\n`);
  update({
    status: code === 0 ? 'completed' : 'failed',
    finishedAt: now(),
    exitCode: code,
    signal: signal || undefined,
  });
  out.end();
});

console.log(`Started ${label} (${issueId}) pid=${child.pid}`);
