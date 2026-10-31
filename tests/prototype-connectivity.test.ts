import test from 'node:test';
import assert from 'node:assert/strict';
import { providerReadiness } from '../lib/prototype-connectivity.ts';

test('connection checks distinguish login, configuration and unknown state', () => {
  assert.equal(providerReadiness(null, 'openai'), 'unknown');
  assert.equal(providerReadiness({ keyConfigured: true, signedIn: false }, 'openai'), 'login');
  assert.equal(providerReadiness({ keyConfigured: false, signedIn: true }, 'openai'), 'configuration');
  assert.equal(providerReadiness({ keyConfigured: true, signedIn: true }, 'openai'), 'ready');
  assert.equal(providerReadiness({ signedIn: true, voiceProviders: [{ id: 'qwen', configured: false }] }, 'qwen'), 'configuration');
  assert.equal(providerReadiness({ signedIn: true, voiceProviders: [{ id: 'qwen', configured: true }] }, 'qwen'), 'ready');
  assert.equal(providerReadiness({ signedIn: true }, 'qwen'), 'unknown');
});
