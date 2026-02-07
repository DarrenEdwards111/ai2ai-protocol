/**
 * ai2ai pending — Show pending messages awaiting human review
 * Lists all pending messages with numbered references for easy approve/reject.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PENDING_DIR, ensureDirs } = require('./config');

/**
 * Load all pending messages, sorted by date
 */
function loadPending() {
  ensureDirs();
  if (!fs.existsSync(PENDING_DIR)) return [];

  const files = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'));
  const pending = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, file), 'utf-8'));
      pending.push({
        file,
        id: file.replace('.json', ''),
        ...data,
      });
    } catch {
      // Skip corrupted files
    }
  }

  // Sort by creation date (oldest first)
  pending.sort((a, b) => {
    const da = new Date(a.createdAt || 0);
    const db = new Date(b.createdAt || 0);
    return da - db;
  });

  return pending;
}

/**
 * Get a pending message by its list number (1-indexed)
 */
function getPendingByNumber(num) {
  const pending = loadPending();
  if (num < 1 || num > pending.length) return null;
  return pending[num - 1];
}

/**
 * Remove a pending message
 */
function removePending(id) {
  const filePath = path.join(PENDING_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Format a timestamp for display
 */
function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

async function run() {
  const pending = loadPending();

  if (pending.length === 0) {
    console.log('\n  📭 No pending messages.\n');
    return;
  }

  console.log(`\n  📬 Pending Messages (${pending.length})\n`);
  console.log('  ─'.repeat(25));

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const from = p.envelope?.from?.human || p.envelope?.from?.agent || 'Unknown';
    const intent = p.handler || p.envelope?.intent || p.envelope?.type || 'unknown';
    const time = p.createdAt ? timeAgo(p.createdAt) : '';

    console.log(`\n  ${i + 1}. ${intent} from ${from}  (${time})`);

    if (p.approvalMessage) {
      // Indent the approval message
      const lines = p.approvalMessage.split('\n');
      for (const line of lines) {
        console.log(`     ${line}`);
      }
    }

    console.log(`     ID: ${p.id.slice(0, 8)}...`);
  }

  console.log('\n  ─'.repeat(25));
  console.log(`\n  Commands:`);
  console.log(`    ai2ai approve <number> [reply]   Accept with optional reply`);
  console.log(`    ai2ai reject <number>            Decline\n`);
}

module.exports = { run, loadPending, getPendingByNumber, removePending };
