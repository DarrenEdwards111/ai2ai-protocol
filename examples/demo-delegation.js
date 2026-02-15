#!/usr/bin/env node
/**
 * Demo: Delegation Chain
 * Agent A asks Agent B to do a task. B delegates part to Agent C.
 * C responds to B, B combines and responds to A.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n🔗 Demo: Delegation Chain\n');

  const agentA = createAgent('manager', 19030);
  const agentB = createAgent('coordinator', 19031);
  const agentC = createAgent('worker', 19032);

  await agentA.start();
  await agentB.start();
  await agentC.start();

  agentA.addContact('coordinator', { endpoint: 'http://localhost:19031/ai2ai' });
  agentB.addContact('manager', { endpoint: 'http://localhost:19030/ai2ai' });
  agentB.addContact('worker', { endpoint: 'http://localhost:19032/ai2ai' });
  agentC.addContact('coordinator', { endpoint: 'http://localhost:19031/ai2ai' });

  // Worker (C) handles delegated sub-tasks
  agentC.on('request', async (intent, payload, from) => {
    if (intent === 'task.subtask') {
      log('Worker', `Received subtask: "${payload.subtask}"`);
      const result = { subtask: payload.subtask, result: 'Sensor readings: temp=22.5°C, humidity=45%, pressure=1013hPa', status: 'complete' };
      log('Worker', 'Subtask complete, sending result to coordinator');
      await agentC.request('coordinator', 'task.subtask-result', result);
    }
  });

  // Coordinator (B) handles tasks, delegates what it can't do
  agentB.on('request', async (intent, payload, from) => {
    if (intent === 'task.execute') {
      log('Coordinator', `Received task: "${payload.task}" from ${from.agent}`);
      log('Coordinator', 'I can do data analysis but need sensor data — delegating to worker');
      const myPart = { analysis: 'Trend analysis shows 3% increase over baseline' };
      agentB._pendingTask = { originalTask: payload.task, myPart, from: from.agent };
      await agentB.request('worker', 'task.subtask', { subtask: 'Collect current sensor readings' });
    }
    if (intent === 'task.subtask-result') {
      log('Coordinator', `Got subtask result from worker`);
      const combined = {
        task: agentB._pendingTask.originalTask,
        results: {
          sensorData: payload.result,
          analysis: agentB._pendingTask.myPart.analysis,
        },
        chain: ['worker → coordinator → manager'],
        status: 'complete',
      };
      log('Coordinator', 'Combining results and sending to manager');
      await agentB.request('manager', 'task.result', combined);
    }
  });

  // Manager (A) receives final result
  let finalResult = null;
  const done = new Promise((resolve) => {
    agentA.on('request', (intent, payload) => {
      if (intent === 'task.result') {
        log('Manager', `Received complete result for: "${payload.task}"`);
        log('Manager', `  Sensor: ${payload.results.sensorData}`);
        log('Manager', `  Analysis: ${payload.results.analysis}`);
        finalResult = payload;
        resolve();
      }
    });
  });

  log('Manager', 'Sending task to coordinator: "Environmental monitoring report"');
  await agentA.request('coordinator', 'task.execute', { task: 'Environmental monitoring report' });

  await done;

  assert(finalResult !== null, 'Should have received result');
  assert(finalResult.results.sensorData.includes('temp=22.5'), 'Should contain worker data');
  assert(finalResult.results.analysis.includes('3% increase'), 'Should contain coordinator analysis');
  assert(finalResult.status === 'complete', 'Task should be complete');

  console.log(`\n✅ Delegation chain complete: manager ← coordinator ← worker\n`);

  await cleanup(agentA, agentB, agentC);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
