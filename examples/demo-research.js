#!/usr/bin/env node
/**
 * Demo: Collaborative Research
 * Agent A (researcher) asks Agent B (specialist) a technical question.
 * Agent B returns a structured answer. Agent A builds a report.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n🔬 Demo: Collaborative Research\n');

  const researcher = createAgent('researcher', 19020);
  const specialist = createAgent('specialist', 19021);

  await researcher.start();
  await specialist.start();

  researcher.addContact('specialist', { endpoint: 'http://localhost:19021/ai2ai' });
  specialist.addContact('researcher', { endpoint: 'http://localhost:19020/ai2ai' });

  // Specialist answers technical questions
  specialist.on('request', async (intent, payload, from) => {
    if (intent === 'research.query') {
      log('Specialist', `Received query: "${payload.question}"`);
      const answer = {
        question: payload.question,
        answer: 'LoRa uses Chirp Spread Spectrum (CSS) modulation with spreading factors SF7-SF12. Higher SF = longer range but lower data rate. Typical range: 2-15km line-of-sight.',
        confidence: 0.95,
        sources: ['Semtech AN1200.22', 'LoRa Alliance Technical Overview'],
        field: 'RF Engineering',
      };
      log('Specialist', `Responding with structured answer (confidence: ${answer.confidence})`);
      await specialist.request('researcher', 'research.answer', answer);
    }
  });

  // Researcher builds report
  let report = null;
  const done = new Promise((resolve) => {
    researcher.on('request', (intent, payload) => {
      if (intent === 'research.answer') {
        log('Researcher', `Got answer from specialist (confidence: ${payload.confidence})`);
        report = {
          title: 'LoRa Modulation Technical Brief',
          sections: [
            { heading: 'Introduction', content: 'This report examines LoRa modulation techniques.' },
            { heading: 'Expert Analysis', content: payload.answer, sources: payload.sources, contributor: 'specialist' },
            { heading: 'Conclusion', content: 'LoRa CSS modulation provides excellent range-to-power trade-offs.' },
          ],
          contributors: ['researcher', 'specialist'],
        };
        log('Researcher', `Report compiled: "${report.title}" with ${report.sections.length} sections`);
        resolve();
      }
    });
  });

  log('Researcher', 'Asking specialist about LoRa modulation...');
  await researcher.request('specialist', 'research.query', {
    question: 'How does LoRa modulation work and what is its typical range?',
    context: 'IoT sensor network design',
  });

  await done;

  assert(report !== null, 'Report should exist');
  assert(report.contributors.includes('specialist'), 'Report should credit specialist');
  assert(report.sections[1].content.includes('Chirp Spread Spectrum'), 'Report should contain specialist answer');
  assert(report.sections[1].sources.length === 2, 'Report should include sources');

  console.log(`\n✅ Report "${report.title}" includes specialist contribution\n`);

  await cleanup(researcher, specialist);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
