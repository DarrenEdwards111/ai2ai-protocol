/**
 * AI2AI Message Queue — Disk-backed queue with exponential backoff retry
 *
 * When the recipient agent is offline, messages are queued to the outbox/
 * directory and retried with exponential backoff.
 *
 * Retry schedule (configurable):
 *   Attempt 1: 1 minute
 *   Attempt 2: 5 minutes
 *   Attempt 3: 30 minutes
 *   Attempt 4: 2 hours
 *   Attempt 5: 12 hours
 *
 * After max retries, the human is notified of delivery failure.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./ai2ai-logger');

const OUTBOX_DIR = path.join(__dirname, 'outbox');

// Ensure outbox directory exists
if (!fs.existsSync(OUTBOX_DIR)) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
}

// Default retry delays in milliseconds
const DEFAULT_RETRY_DELAYS = [
  1 * 60 * 1000,        // 1 minute
  5 * 60 * 1000,        // 5 minutes
  30 * 60 * 1000,       // 30 minutes
  2 * 60 * 60 * 1000,   // 2 hours
  12 * 60 * 60 * 1000,  // 12 hours
];

// In-memory timer map for active retries
const retryTimers = new Map(); // queueId → timeoutId

/**
 * Queue a message for delivery
 *
 * @param {string} endpoint - Target endpoint URL
 * @param {object} envelope - AI2AI envelope to send
 * @param {object} options - { maxRetries, retryDelays, onFailure }
 * @returns {string} - Queue ID
 */
function enqueue(endpoint, envelope, options = {}) {
  const queueId = envelope.id || require('crypto').randomUUID();

  const queueEntry = {
    id: queueId,
    endpoint,
    envelope,
    createdAt: new Date().toISOString(),
    attempt: 0,
    maxRetries: options.maxRetries ?? DEFAULT_RETRY_DELAYS.length,
    retryDelays: options.retryDelays || DEFAULT_RETRY_DELAYS,
    lastAttempt: null,
    lastError: null,
    status: 'queued', // queued | retrying | delivered | failed
  };

  const entryPath = path.join(OUTBOX_DIR, `${queueId}.json`);
  fs.writeFileSync(entryPath, JSON.stringify(queueEntry, null, 2));

  logger.info('QUEUE', `Message queued: ${queueId} → ${endpoint}`, {
    id: queueId,
    intent: envelope.intent,
    to: envelope.to?.agent,
  });

  return queueId;
}

/**
 * Update a queue entry on disk
 */
function updateEntry(queueId, updates) {
  const entryPath = path.join(OUTBOX_DIR, `${queueId}.json`);
  if (!fs.existsSync(entryPath)) return null;

  const entry = JSON.parse(fs.readFileSync(entryPath, 'utf-8'));
  Object.assign(entry, updates);
  fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
  return entry;
}

/**
 * Load a queue entry from disk
 */
function loadEntry(queueId) {
  const entryPath = path.join(OUTBOX_DIR, `${queueId}.json`);
  if (!fs.existsSync(entryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(entryPath, 'utf-8'));
  } catch { return null; }
}

/**
 * Remove a queue entry (after successful delivery or permanent failure)
 */
function removeEntry(queueId) {
  const entryPath = path.join(OUTBOX_DIR, `${queueId}.json`);
  if (fs.existsSync(entryPath)) {
    fs.unlinkSync(entryPath);
  }
  if (retryTimers.has(queueId)) {
    clearTimeout(retryTimers.get(queueId));
    retryTimers.delete(queueId);
  }
}

/**
 * Attempt to deliver a queued message
 *
 * @param {string} queueId - Queue entry ID
 * @param {Function} sendFn - async function(endpoint, envelope) → response
 * @param {Function} onFailure - callback(entry) when all retries exhausted
 * @returns {Promise<boolean>} - true if delivered
 */
async function attemptDelivery(queueId, sendFn, onFailure) {
  const entry = loadEntry(queueId);
  if (!entry || entry.status === 'delivered' || entry.status === 'failed') {
    return false;
  }

  entry.attempt += 1;
  entry.lastAttempt = new Date().toISOString();
  entry.status = 'retrying';

  logger.info('QUEUE', `Delivery attempt ${entry.attempt}/${entry.maxRetries} for ${queueId}`, {
    endpoint: entry.endpoint,
    attempt: entry.attempt,
  });

  try {
    const response = await sendFn(entry.endpoint, entry.envelope);

    // Success!
    entry.status = 'delivered';
    entry.deliveredAt = new Date().toISOString();
    updateEntry(queueId, entry);
    removeEntry(queueId);

    logger.info('QUEUE', `Message delivered: ${queueId}`, { attempt: entry.attempt });
    return true;
  } catch (err) {
    entry.lastError = err.message;
    updateEntry(queueId, entry);

    logger.logDeliveryFailure(entry.endpoint, entry.envelope?.to?.agent, err.message, entry.attempt);

    if (entry.attempt >= entry.maxRetries) {
      // All retries exhausted
      entry.status = 'failed';
      updateEntry(queueId, entry);

      logger.error('QUEUE', `All retries exhausted for ${queueId}. Delivery failed.`, {
        endpoint: entry.endpoint,
        to: entry.envelope?.to?.agent,
        totalAttempts: entry.attempt,
      });

      if (onFailure) onFailure(entry);
      return false;
    }

    // Schedule next retry
    const delay = entry.retryDelays[entry.attempt - 1] || entry.retryDelays[entry.retryDelays.length - 1];
    const delayMin = Math.round(delay / 60000);
    logger.info('QUEUE', `Scheduling retry for ${queueId} in ${delayMin} minutes`);

    const timer = setTimeout(() => {
      retryTimers.delete(queueId);
      attemptDelivery(queueId, sendFn, onFailure);
    }, delay);

    retryTimers.set(queueId, timer);
    return false;
  }
}

/**
 * Queue a message and immediately attempt first delivery.
 * If it fails, automatic retries are scheduled.
 *
 * @param {string} endpoint - Target endpoint
 * @param {object} envelope - AI2AI envelope
 * @param {Function} sendFn - async function(endpoint, envelope)
 * @param {object} options - { maxRetries, retryDelays, onFailure }
 * @returns {Promise<{queued: boolean, delivered: boolean, queueId: string}>}
 */
async function queueAndSend(endpoint, envelope, sendFn, options = {}) {
  const queueId = enqueue(endpoint, envelope, options);
  const delivered = await attemptDelivery(queueId, sendFn, options.onFailure);
  return { queued: !delivered, delivered, queueId };
}

/**
 * List all queued messages
 */
function listQueue() {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  return fs.readdirSync(OUTBOX_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(OUTBOX_DIR, f), 'utf-8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Resume retries for all pending queued messages (call on startup)
 *
 * @param {Function} sendFn - async function(endpoint, envelope)
 * @param {Function} onFailure - callback when all retries exhausted
 */
function resumeQueue(sendFn, onFailure) {
  const pending = listQueue().filter(e => e.status === 'queued' || e.status === 'retrying');

  if (pending.length === 0) return;

  logger.info('QUEUE', `Resuming ${pending.length} queued messages`);

  for (const entry of pending) {
    // Stagger retries slightly to avoid thundering herd
    const jitter = Math.random() * 5000;
    setTimeout(() => {
      attemptDelivery(entry.id, sendFn, onFailure);
    }, jitter);
  }
}

/**
 * Clean up delivered/failed entries older than N days
 */
function cleanQueue(retainDays = 7) {
  const cutoff = Date.now() - retainDays * 86400000;
  let cleaned = 0;

  for (const entry of listQueue()) {
    if (entry.status === 'delivered' || entry.status === 'failed') {
      const createdAt = new Date(entry.createdAt).getTime();
      if (createdAt < cutoff) {
        removeEntry(entry.id);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    logger.info('QUEUE', `Cleaned ${cleaned} old queue entries`);
  }
  return cleaned;
}

/**
 * Cancel all active retry timers (for shutdown)
 */
function cancelAllRetries() {
  for (const [id, timer] of retryTimers) {
    clearTimeout(timer);
  }
  retryTimers.clear();
}

module.exports = {
  enqueue,
  attemptDelivery,
  queueAndSend,
  listQueue,
  resumeQueue,
  cleanQueue,
  removeEntry,
  cancelAllRetries,
  loadEntry,
  OUTBOX_DIR,
};
