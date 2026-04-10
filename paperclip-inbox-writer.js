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

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function listConversationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f));
}

function parseJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function latestResponse(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && (msg.type === 'response' || msg.type === 'confirm' || msg.type === 'reject') && msg.intent === 'dev.claude_task') {
      return msg;
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  const conversationsDir = args.conversations || path.join(process.cwd(), 'skills', 'ai2ai', 'conversations');
  const outDir = args.out || path.join(process.cwd(), 'paperclip-inbox');
  const once = args.once === true;
  const intervalMs = Number(args.intervalMs || 5000);

  function sweep() {
    const files = listConversationFiles(conversationsDir);
    for (const filePath of files) {
      const conversationId = path.basename(filePath, '.jsonl');
      const outPath = path.join(outDir, `${conversationId}.json`);
      const donePath = `${outPath}.processed`;
      if (fs.existsSync(outPath) || fs.existsSync(donePath)) continue;

      const messages = parseJsonl(filePath);
      const response = latestResponse(messages);
      if (!response) continue;

      writeJson(outPath, {
        conversation: conversationId,
        ok: response.type !== 'reject' && Boolean(response.payload?.ok ?? true),
        payload: response.payload || {},
        from: response.from || {},
        type: response.type,
        intent: response.intent,
        receivedAt: new Date().toISOString(),
      });

      console.log(`📥 Wrote Paperclip inbox response for conversation ${conversationId}`);
    }
  }

  sweep();
  if (once) return;

  console.log(`📡 Watching AI2AI conversations in ${conversationsDir}`);
  setInterval(sweep, intervalMs);
}

main();
