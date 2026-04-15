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

function now() { return new Date().toISOString(); }

const args = parseArgs(process.argv);
const issueId = String(args.issue || `pty-agent-${Date.now()}`);
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
const runId = `${issueId}-${Date.now()}`;
const logPath = path.join(logDir, `${runId}.log`);
const latestLogPath = path.join(logDir, `${issueId}.log`);
const start = now();

try {
  if (fs.existsSync(statusPath)) fs.unlinkSync(statusPath);
} catch {}
try {
  if (fs.existsSync(latestLogPath)) fs.unlinkSync(latestLogPath);
} catch {}

const child = spawn('/usr/bin/script', ['-qefc', cmd, logPath], {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, TERM: 'xterm-256color' }
});

function update(extra = {}) {
  writeJson(statusPath, {
    taskId: issueId,
    runId,
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
    latestLogPath,
    source: 'paperclip-agent-pty-runner',
    error: extra.error,
  });
  try {
    fs.copyFileSync(logPath, latestLogPath);
  } catch {}
}

update({ status: 'running' });
child.stdout.on('data', () => update({ status: 'running' }));
child.stderr.on('data', () => update({ status: 'running' }));
const heartbeat = setInterval(() => update({ status: 'running' }), 2000);
child.on('error', err => {
  update({ status: 'failed', finishedAt: now(), error: err.message });
});
child.on('close', (code, signal) => {
  clearInterval(heartbeat);
  update({ status: code === 0 ? 'completed' : 'failed', finishedAt: now(), exitCode: code, signal: signal || undefined });
});

console.log(`Started ${label} (${issueId}) pid=${child.pid}`);
