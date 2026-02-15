#!/usr/bin/env node
/**
 * Demo: Schedule Meeting
 * Agent A asks Agent B to find a meeting time.
 * Agent B checks availability and proposes times.
 * Agent A picks one, both confirm.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n🗓️  Demo: Schedule Meeting\n');

  const agentA = createAgent('alice', 19001);
  const agentB = createAgent('bob', 19002);

  // State
  const stateA = { meeting: null };
  const stateB = { meeting: null, calendar: ['2026-03-10T10:00', '2026-03-10T14:00', '2026-03-11T09:00'] };

  await agentA.start();
  await agentB.start();
  agentA.addContact('bob', { endpoint: 'http://localhost:19002/ai2ai' });
  agentB.addContact('alice', { endpoint: 'http://localhost:19001/ai2ai' });

  // Step 1: Bob handles meeting requests
  agentB.on('request', async (intent, payload, from, envelope) => {
    if (intent === 'schedule.propose') {
      log('Bob', `Received meeting request: "${payload.subject}" from ${from.agent}`);
      log('Bob', `Checking calendar... proposing ${stateB.calendar.length} available slots`);
      await agentB.request('alice', 'schedule.options', {
        subject: payload.subject,
        availableSlots: stateB.calendar,
      });
    }
    if (intent === 'schedule.confirm') {
      log('Bob', `Meeting confirmed: ${payload.subject} at ${payload.time}`);
      stateB.meeting = { subject: payload.subject, time: payload.time };
    }
  });

  // Step 2: Alice handles responses
  const done = new Promise((resolve) => {
    agentA.on('request', async (intent, payload, from) => {
      if (intent === 'schedule.options') {
        log('Alice', `Got ${payload.availableSlots.length} time options from ${from.agent}`);
        const picked = payload.availableSlots[1]; // Pick second slot
        log('Alice', `Picking: ${picked}`);
        stateA.meeting = { subject: payload.subject, time: picked };
        await agentA.request('bob', 'schedule.confirm', {
          subject: payload.subject,
          time: picked,
        });
        setTimeout(resolve, 200);
      }
    });
  });

  // Step 3: Alice initiates
  log('Alice', 'Requesting meeting with Bob: "Project Sync"');
  await agentA.request('bob', 'schedule.propose', { subject: 'Project Sync' });

  await done;

  // Verify
  assert(stateA.meeting !== null, 'Alice should have a meeting');
  assert(stateB.meeting !== null, 'Bob should have a meeting');
  assert(stateA.meeting.time === stateB.meeting.time, 'Both should agree on time');
  assert(stateA.meeting.subject === stateB.meeting.subject, 'Both should agree on subject');

  console.log(`\n✅ Both agents agreed: "${stateA.meeting.subject}" at ${stateA.meeting.time}\n`);

  await cleanup(agentA, agentB);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
