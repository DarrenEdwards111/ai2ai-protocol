/**
 * AI2AI Logger — Structured logging with daily rotation
 * Logs all incoming/outgoing messages, trust changes, blocks, and errors.
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LOG_LEVELS[process.env.AI2AI_LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

/**
 * Get today's log file path
 */
function getLogPath() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `ai2ai-${today}.log`);
}

/**
 * Write a structured log entry
 */
function log(level, category, message, data = null) {
  if (LOG_LEVELS[level] == null || LOG_LEVELS[level] < currentLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    cat: category,
    msg: message,
  };
  if (data !== undefined && data !== null) {
    entry.data = data;
  }

  const line = JSON.stringify(entry);

  try {
    fs.appendFileSync(getLogPath(), line + '\n');
  } catch (err) {
    // Fallback to stderr if file write fails
    process.stderr.write(`[AI2AI LOG ERROR] ${err.message}\n`);
    process.stderr.write(line + '\n');
  }
}

/** Convenience helpers */
function debug(category, message, data) { log('DEBUG', category, message, data); }
function info(category, message, data)  { log('INFO', category, message, data); }
function warn(category, message, data)  { log('WARN', category, message, data); }
function error(category, message, data) { log('ERROR', category, message, data); }

/**
 * Log an outgoing message
 */
function logOutgoing(envelope) {
  info('OUT', `→ ${envelope.type}/${envelope.intent || '-'} to ${envelope.to?.agent}`, {
    id: envelope.id,
    conversation: envelope.conversation,
    intent: envelope.intent,
    to: envelope.to?.agent,
  });
}

/**
 * Log an incoming message
 */
function logIncoming(envelope) {
  info('IN', `← ${envelope.type}/${envelope.intent || '-'} from ${envelope.from?.agent}`, {
    id: envelope.id,
    conversation: envelope.conversation,
    intent: envelope.intent,
    from: envelope.from?.agent,
  });
}

/**
 * Log a trust change
 */
function logTrustChange(agentId, oldLevel, newLevel, reason) {
  info('TRUST', `Trust changed for ${agentId}: ${oldLevel} → ${newLevel}`, {
    agentId, oldLevel, newLevel, reason,
  });
}

/**
 * Log a block/unblock
 */
function logBlock(agentId, blocked) {
  warn('TRUST', `Agent ${agentId} ${blocked ? 'BLOCKED' : 'UNBLOCKED'}`, { agentId, blocked });
}

/**
 * Log delivery failure
 */
function logDeliveryFailure(endpoint, agentId, errorMsg, attempt) {
  error('DELIVERY', `Failed to deliver to ${agentId} at ${endpoint}`, {
    endpoint, agentId, error: errorMsg, attempt,
  });
}

/**
 * Read log entries from a given date
 */
function readLog(date) {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
  const logPath = path.join(LOGS_DIR, `ai2ai-${dateStr}.log`);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Clean up old log files (older than N days)
 */
function cleanOldLogs(retainDays = 30) {
  const cutoff = Date.now() - retainDays * 86400000;
  let cleaned = 0;
  try {
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const match = f.match(/^ai2ai-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match && new Date(match[1]).getTime() < cutoff) {
        fs.unlinkSync(path.join(LOGS_DIR, f));
        cleaned++;
      }
    }
  } catch { /* ignore */ }
  return cleaned;
}

module.exports = {
  log, debug, info, warn, error,
  logOutgoing, logIncoming,
  logTrustChange, logBlock,
  logDeliveryFailure,
  readLog, cleanOldLogs,
  LOGS_DIR,
};
