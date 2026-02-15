#!/usr/bin/env node
/**
 * Webhook Receiver — Forward AI2AI messages to webhooks
 * 
 * Usage: node webhook-receiver.js
 */

const { AI2AI } = require('../src/client');
const { createWebhookForwarder } = require('../src/integrations/webhook');

async function main() {
  // Create webhook forwarder (replace URL with your webhook)
  const webhook = createWebhookForwarder({
    url: process.env.WEBHOOK_URL || 'https://httpbin.org/post',
    secret: 'my-shared-secret',
    events: ['message', 'request'], // Only forward these event types
  });

  const agent = new AI2AI({
    name: 'webhook-agent',
    humanName: 'Webhook Bot',
    port: 18870,
    dataDir: '/tmp/ai2ai-webhook',
  });

  // Forward all messages to webhook
  agent.on('message', webhook.handler);

  // Also log locally
  agent.on('message', (payload, from) => {
    console.log(`📨 Message from ${from.agent} → forwarded to webhook`);
  });

  await agent.start();
  console.log(`🦞 Webhook agent listening on port ${agent.port}`);
  console.log(`   Forwarding to: ${process.env.WEBHOOK_URL || 'https://httpbin.org/post'}`);
  console.log('\nPress Ctrl+C to stop.');
}

main().catch(console.error);
