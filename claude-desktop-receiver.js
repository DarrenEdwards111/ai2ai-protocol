#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function findPending(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(dir, f));
}

async function runWorker(workerPath, task, cwd, outPath, claudePath) {
  return new Promise((resolve) => {
    const args = [workerPath, '--prompt', task, '--out', outPath];
    if (cwd) args.push('--cwd', cwd);
    if (claudePath) args.push('--claude', claudePath);

    const child = spawn('node', args, { stdio: 'inherit', env: process.env });
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });
}

async function processOne(filePath, opts) {
  const data = readJson(filePath);
  const envelope = data.envelope || {};
  const payload = envelope.payload || {};

  if (envelope.intent !== 'dev.claude_task') return false;
  if (data.resolved) return false;

  const task = payload.task;
  const cwd = payload.cwd || opts.cwd || process.cwd();
  const jobId = envelope.id || path.basename(filePath, '.json');
  const outDir = opts.outDir || path.join(path.dirname(filePath), '..', 'claude-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${jobId}.json`);

  console.log(`🧠 Running Claude task ${jobId} in ${cwd}`);
  const exitCode = await runWorker(opts.worker, task, cwd, outPath, opts.claude);

  data.resolved = true;
  data.resolvedAt = new Date().toISOString();
  data.desktopClaude = {
    ok: exitCode === 0,
    exitCode,
    resultPath: outPath,
  };
  writeJson(filePath, data);

  console.log(`✅ Finished ${jobId}, result: ${outPath}`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const pendingDir = args.pending || path.join(process.cwd(), 'skills', 'ai2ai', 'pending');
  const worker = args.worker || path.join(process.cwd(), 'ai2ai-protocol', 'claude-desktop-worker.js');
  const claude = args.claude || 'claude';
  const cwd = args.cwd;
  const once = args.once === true;
  const intervalMs = Number(args.intervalMs || 5000);
  const outDir = args.outDir;

  const opts = { worker, claude, cwd, outDir };

  async function sweep() {
    const files = findPending(pendingDir);
    for (const f of files) {
      try {
        await processOne(f, opts);
      } catch (err) {
        console.error(`Failed processing ${f}: ${err.message}`);
      }
    }
  }

  await sweep();
  if (once) return;

  console.log(`👂 Watching ${pendingDir} for dev.claude_task approvals...`);
  setInterval(() => {
    sweep().catch(err => console.error(err));
  }, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
