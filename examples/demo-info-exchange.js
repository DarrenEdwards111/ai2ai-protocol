#!/usr/bin/env node
/**
 * Demo: Information Exchange
 * Agent A requests sensor data from Agent B twice, 2 seconds apart.
 * Verifies both readings received with different timestamps.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n📊 Demo: Information Exchange\n');

  const collector = createAgent('collector', 19040);
  const sensor = createAgent('sensor-hub', 19041);

  await collector.start();
  await sensor.start();

  collector.addContact('sensor-hub', { endpoint: 'http://localhost:19041/ai2ai' });
  sensor.addContact('collector', { endpoint: 'http://localhost:19040/ai2ai' });

  let readingCount = 0;
  const baseTemp = 21.0;

  // Sensor hub responds with simulated data
  sensor.on('request', async (intent, payload, from) => {
    if (intent === 'sensor.read') {
      readingCount++;
      const data = {
        temperature: baseTemp + readingCount * 0.3,
        humidity: 55 + readingCount * 2,
        timestamp: new Date().toISOString(),
        sensorId: 'env-sensor-01',
        unit: { temperature: '°C', humidity: '%' },
        readingNumber: readingCount,
      };
      log('Sensor', `Reading #${readingCount}: ${data.temperature}°C, ${data.humidity}% at ${data.timestamp}`);
      await sensor.request('collector', 'sensor.data', data);
    }
  });

  // Collector gathers readings
  const readings = [];
  let resolveReadings;
  const allDone = new Promise(r => { resolveReadings = r; });

  collector.on('request', (intent, payload) => {
    if (intent === 'sensor.data') {
      log('Collector', `Received reading #${payload.readingNumber}: ${payload.temperature}°C, ${payload.humidity}%`);
      readings.push(payload);
      if (readings.length === 2) resolveReadings();
    }
  });

  // First reading
  log('Collector', 'Requesting sensor data (reading 1)...');
  await collector.request('sensor-hub', 'sensor.read', { sensors: ['temperature', 'humidity'] });

  // Wait 2 seconds
  log('Collector', 'Waiting 2 seconds...');
  await new Promise(r => setTimeout(r, 2000));

  // Second reading
  log('Collector', 'Requesting sensor data (reading 2)...');
  await collector.request('sensor-hub', 'sensor.read', { sensors: ['temperature', 'humidity'] });

  await allDone;

  assert(readings.length === 2, 'Should have 2 readings');
  assert(readings[0].timestamp !== readings[1].timestamp, 'Timestamps should differ');
  assert(readings[0].temperature !== readings[1].temperature, 'Temperatures should differ');
  assert(readings[0].readingNumber === 1, 'First reading number correct');
  assert(readings[1].readingNumber === 2, 'Second reading number correct');

  console.log(`\n✅ Two readings received with different timestamps:`);
  console.log(`   #1: ${readings[0].temperature}°C at ${readings[0].timestamp}`);
  console.log(`   #2: ${readings[1].temperature}°C at ${readings[1].timestamp}\n`);

  await cleanup(collector, sensor);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
