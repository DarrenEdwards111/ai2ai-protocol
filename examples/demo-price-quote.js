#!/usr/bin/env node
/**
 * Demo: Price Comparison
 * Agent A (buyer) requests quotes from Agent B and C (merchants).
 * Picks the cheapest offer.
 */
const { createAgent, log, cleanup, assert } = require('./demo-helpers');

(async () => {
  console.log('\n💰 Demo: Price Comparison\n');

  const buyer = createAgent('buyer', 19010);
  const merchantB = createAgent('merchant-b', 19011);
  const merchantC = createAgent('merchant-c', 19012);

  await buyer.start();
  await merchantB.start();
  await merchantC.start();

  buyer.addContact('merchant-b', { endpoint: 'http://localhost:19011/ai2ai' });
  buyer.addContact('merchant-c', { endpoint: 'http://localhost:19012/ai2ai' });
  merchantB.addContact('buyer', { endpoint: 'http://localhost:19010/ai2ai' });
  merchantC.addContact('buyer', { endpoint: 'http://localhost:19010/ai2ai' });

  // Merchants respond with prices
  merchantB.on('request', async (intent, payload, from) => {
    if (intent === 'quote.request') {
      log('Merchant B', `Quote request for "${payload.item}" — responding £28`);
      await merchantB.request('buyer', 'quote.response', {
        item: payload.item, price: 28, currency: 'GBP', merchant: 'merchant-b',
      });
    }
  });

  merchantC.on('request', async (intent, payload, from) => {
    if (intent === 'quote.request') {
      log('Merchant C', `Quote request for "${payload.item}" — responding £32`);
      await merchantC.request('buyer', 'quote.response', {
        item: payload.item, price: 32, currency: 'GBP', merchant: 'merchant-c',
      });
    }
  });

  // Buyer collects quotes
  const quotes = [];
  const done = new Promise((resolve) => {
    buyer.on('request', (intent, payload) => {
      if (intent === 'quote.response') {
        log('Buyer', `Got quote from ${payload.merchant}: £${payload.price}`);
        quotes.push(payload);
        if (quotes.length === 2) resolve();
      }
    });
  });

  log('Buyer', 'Requesting quotes for "Heltec V3"...');
  await buyer.request('merchant-b', 'quote.request', { item: 'Heltec V3' });
  await buyer.request('merchant-c', 'quote.request', { item: 'Heltec V3' });

  await done;

  const best = quotes.sort((a, b) => a.price - b.price)[0];
  log('Buyer', `Best price: £${best.price} from ${best.merchant}`);

  assert(best.merchant === 'merchant-b', 'Should pick merchant-b (cheapest)');
  assert(best.price === 28, 'Best price should be £28');

  console.log(`\n✅ Buyer selected ${best.merchant} at £${best.price}\n`);

  await cleanup(buyer, merchantB, merchantC);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
