#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

function reqFrom(baseDir, mod) {
  return require(path.join(baseDir, mod));
}

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

function extractClaudeTaskSpec(payload = {}) {
  const commandEnvelope = payload.commandEnvelope;
  if (commandEnvelope && typeof commandEnvelope === 'object') {
    if (commandEnvelope.kind !== 'ai2ai.command') {
      throw new Error('Unsupported commandEnvelope kind');
    }
    if (commandEnvelope.command !== 'dev.claude_task') {
      throw new Error(`Unsupported commandEnvelope command: ${commandEnvelope.command}`);
    }

    const instructions = typeof commandEnvelope.instructions === 'string'
      ? commandEnvelope.instructions.trim()
      : '';
    const cwd = typeof commandEnvelope.cwd === 'string' && commandEnvelope.cwd.trim()
      ? commandEnvelope.cwd.trim()
      : undefined;

    if (!instructions) {
      throw new Error('commandEnvelope.instructions is required for dev.claude_task');
    }

    return {
      prompt: instructions,
      cwd,
      commandEnvelope,
      source: 'commandEnvelope',
    };
  }

  const task = typeof payload.task === 'string' ? payload.task.trim() : '';
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim()
    ? payload.cwd.trim()
    : undefined;

  if (!task) {
    throw new Error('payload.task is required when commandEnvelope is absent');
  }

  return {
    prompt: task,
    cwd,
    commandEnvelope: null,
    source: 'legacy-task',
  };
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

async function sendResultBack(data, opts, resultJson, taskSpec) {
  const envelope = data.envelope || {};
  const originalFrom = envelope.from || {};
  const contact = opts.getContact ? opts.getContact(originalFrom.agent) : null;
  if (!contact?.endpoint || !opts.createEnvelope || !opts.sendMessage) return false;

  const summary = {
    ok: resultJson.ok,
    exitCode: resultJson.exitCode,
    cwd: resultJson.cwd,
    prompt: resultJson.prompt,
    stdout: resultJson.stdout,
    stderr: resultJson.stderr,
    finishedAt: resultJson.finishedAt,
    obeyedVia: taskSpec?.source || 'unknown',
  };

  if (taskSpec?.commandEnvelope) {
    summary.commandEnvelope = taskSpec.commandEnvelope;
  }

  const reply = opts.createEnvelope({
    to: {
      agent: originalFrom.agent,
      human: originalFrom.human || originalFrom.agent,
      node: originalFrom.node || 'unknown',
    },
    type: 'response',
    intent: 'dev.claude_task',
    conversationId: envelope.conversation || crypto.randomUUID(),
    payload: summary,
  });

  await opts.sendMessage(contact.endpoint, reply, { queue: true });
  return true;
}

async function processOne(filePath, opts) {
  const data = readJson(filePath);
  const envelope = data.envelope || {};
  const payload = envelope.payload || {};

  if (envelope.intent !== 'dev.claude_task') return false;
  if (data.resolved) return false;
  if (data.approved === false) return false;
  if (data.approved !== true && !data.desktopClaudeForceRun) return false;

  const taskSpec = extractClaudeTaskSpec(payload);
  const task = taskSpec.prompt;
  const cwd = taskSpec.cwd || opts.cwd || process.cwd();
  const jobId = envelope.id || path.basename(filePath, '.json');
  const outDir = opts.outDir || path.join(path.dirname(filePath), '..', 'claude-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${jobId}.json`);

  console.log(`🧠 Running Claude task ${jobId} in ${cwd}`);
  const exitCode = await runWorker(opts.worker, task, cwd, outPath, opts.claude);
  const resultJson = readJson(outPath);
  resultJson.obeyedVia = taskSpec.source;
  if (taskSpec.commandEnvelope) {
    resultJson.commandEnvelope = taskSpec.commandEnvelope;
    writeJson(outPath, resultJson);
  }

  let sentBack = false;
  try {
    sentBack = await sendResultBack(data, opts, resultJson, taskSpec);
  } catch (err) {
    resultJson.returnSendError = err.message;
    writeJson(outPath, resultJson);
  }

  data.resolved = true;
  data.resolvedAt = new Date().toISOString();
  data.desktopClaude = {
    ok: exitCode === 0,
    exitCode,
    resultPath: outPath,
    resultSentBack: sentBack,
    obeyedVia: taskSpec.source,
  };
  writeJson(filePath, data);

  console.log(`✅ Finished ${jobId}, result: ${outPath}, sentBack=${sentBack}`);
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
  const skillDir = args.skillDir || path.join(process.cwd(), 'skills', 'ai2ai');

  const client = reqFrom(skillDir, 'ai2ai-client.js');
  const trust = reqFrom(skillDir, 'ai2ai-trust.js');

  const opts = {
    worker,
    claude,
    cwd,
    outDir,
    sendMessage: client.sendMessage,
    createEnvelope: client.createEnvelope,
    getContact: trust.getContact,
  };

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
