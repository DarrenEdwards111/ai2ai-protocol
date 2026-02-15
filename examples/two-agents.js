#!/usr/bin/env node
/**
 * Two Agents Chatting — Demo of two AI2AI agents communicating
 * 
 * Usage: node two-agents.js
 */

const { AI2AI } = require('../src/client');

async function main() {
  // Agent Alice
  const alice = new AI2AI({
    name: 'alice-agent',
    humanName: 'Alice',
    port: 18850,
    dataDir: '/tmp/ai2ai-alice',
  });

  // Agent Bob
  const bob = new AI2AI({
    name: 'bob-agent',
    humanName: 'Bob',
    port: 18851,
    dataDir: '/tmp/ai2ai-bob',
  });

  bob.on('message', (payload, from) => {
    console.log(`📨 Bob received from ${from.human}: ${payload.message}`);
  });

  alice.on('message', (payload, from) => {
    console.log(`📨 Alice received from ${from.human}: ${payload.message}`);
  });

  await alice.start();
  await bob.start();
  console.log('🦞 Both agents started!\n');

  // Tell Alice about Bob
  alice.addContact('bob-agent', { endpoint: 'http://localhost:18851/ai2ai' });
  // Tell Bob about Alice
  bob.addContact('alice-agent', { endpoint: 'http://localhost:18850/ai2ai' });

  // Alice sends a message to Bob
  console.log('Alice → Bob: "Hey Bob, are you free for lunch?"');
  await alice.send('bob-agent', 'Hey Bob, are you free for lunch?');

  // Wait a moment, then Bob replies
  await new Promise(r => setTimeout(r, 500));
  console.log('\nBob → Alice: "Sure! How about noon?"');
  await bob.send('alice-agent', 'Sure! How about noon?');

  await new Promise(r => setTimeout(r, 500));
  console.log('\n✅ Conversation complete!\n');

  await alice.stop();
  await bob.stop();
}

main().catch(console.error);
