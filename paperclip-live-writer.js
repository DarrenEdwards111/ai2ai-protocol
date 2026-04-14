#!/usr/bin/env node
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTail(filePath, maxChars = 4000) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return data.length > maxChars ? data.slice(-maxChars) : data;
  } catch {
    return '';
  }
}

function listStatusFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

function main() {
  const args = parseArgs(process.argv);
  const srcDir = args.src || path.join(process.cwd(), 'paperclip-runtime-status');
  const outDir = args.out || path.join(process.cwd(), 'paperclip-live');
  const once = args.once === true;
  const intervalMs = Number(args.intervalMs || 3000);

  function sweep() {
    const files = listStatusFiles(srcDir);
    for (const file of files) {
      try {
        const issueId = path.basename(file, '.json');
        const data = readJson(file);
        const logPath = typeof data.logPath === 'string' ? data.logPath : undefined;
        const logTail = logPath ? readTail(logPath) : (typeof data.logTail === 'string' ? data.logTail : '');
        const outPath = path.join(outDir, `${issueId}.json`);
        writeJson(outPath, {
          taskId: data.taskId || undefined,
          status: data.status || 'running',
          cwd: data.cwd || undefined,
          command: data.command || undefined,
          startedAt: data.startedAt || undefined,
          updatedAt: new Date().toISOString(),
          finishedAt: data.finishedAt || undefined,
          logPath,
          logTail,
          source: data.source || 'paperclip-live-writer',
          error: data.error || undefined,
        });
      } catch (err) {
        console.error(`Failed to process status file ${file}:`, err.message);
      }
    }
  }

  sweep();
  if (once) return;
  console.log(`📡 Watching runtime status in ${srcDir}`);
  setInterval(sweep, intervalMs);
}

main();
