#!/usr/bin/env node
/**
 * Demo: Human Approval Flow
 * Agent A sends a £500 purchase request to Agent B.
 * Agent B's policy requires human approval for amounts > £100.
 * Simulates human approving, then confirms to Agent A.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n🔐 Demo: Human Approval Flow\n');

  const requester = createAgent('requester', 19050);
  const approver = createAgent('approver', 19051);

  await requester.start();
  await approver.start();

  requester.addContact('approver', { endpoint: 'http://localhost:19051/ai2ai' });
  approver.addContact('requester', { endpoint: 'http://localhost:19050/ai2ai' });

  const approvalLog = [];

  // Approver agent handles purchase requests
  approver.on('request', async (intent, payload, from) => {
    if (intent === 'purchase.request') {
      log('Approver', `Purchase request: £${payload.amount} for "${payload.item}" from ${from.agent}`);

      if (payload.amount > 100) {
        log('Approver', `⚠️  Amount £${payload.amount} exceeds £100 — human approval required`);
        approvalLog.push({ event: 'approval_required', amount: payload.amount });

        // Simulate human review delay
        await new Promise(r => setTimeout(r, 500));
        log('Approver', '👤 Human reviewed and APPROVED the purchase');
        approvalLog.push({ event: 'human_approved' });

        await approver.request('requester', 'purchase.approved', {
          item: payload.item,
          amount: payload.amount,
          approvedBy: 'human-operator',
          approvalId: 'APR-2026-001',
          note: 'Approved after human review',
        });
      } else {
        log('Approver', 'Auto-approved (under £100 threshold)');
        await approver.request('requester', 'purchase.approved', {
          item: payload.item,
          amount: payload.amount,
          approvedBy: 'auto',
        });
      }
    }
  });

  // Requester handles approval responses
  let approval = null;
  const done = new Promise((resolve) => {
    requester.on('request', (intent, payload) => {
      if (intent === 'purchase.approved') {
        log('Requester', `✅ Purchase approved! £${payload.amount} for "${payload.item}"`);
        log('Requester', `   Approved by: ${payload.approvedBy} (${payload.approvalId || 'N/A'})`);
        approval = payload;
        resolve();
      }
    });
  });

  log('Requester', 'Sending purchase request: £500 for "Heltec V3 Dev Kit (x10)"');
  await requester.request('approver', 'purchase.request', {
    item: 'Heltec V3 Dev Kit (x10)',
    amount: 500,
    currency: 'GBP',
    justification: 'Needed for LoRa mesh network deployment',
  });

  await done;

  assert(approval !== null, 'Should have received approval');
  assert(approval.approvedBy === 'human-operator', 'Should be human-approved');
  assert(approval.approvalId === 'APR-2026-001', 'Should have approval ID');
  assert(approvalLog.length === 2, 'Should have 2 approval log entries');
  assert(approvalLog[0].event === 'approval_required', 'Should log approval required');
  assert(approvalLog[1].event === 'human_approved', 'Should log human approval');

  console.log(`\n✅ Human approval flow completed: ${approvalLog.map(e => e.event).join(' → ')}\n`);

  await cleanup(requester, approver);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
