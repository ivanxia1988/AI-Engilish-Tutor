import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nodeFrameworkArguments, nodeFrameworkEnvironment } from '../scripts/run-node-framework.mjs';

const cli = fileURLToPath(new URL('../scripts/run-node-framework.mjs', import.meta.url));

test('Node framework entry builds the production app and starts on the assigned public port', () => {
  assert.deepEqual(nodeFrameworkArguments('build', {}), ['build', '--webpack']);
  assert.deepEqual(nodeFrameworkArguments('start', { PORT: '3456' }), ['start', '--hostname', '0.0.0.0', '--port', '3456']);
  assert.equal(nodeFrameworkArguments('start', {}).at(-1), '8080');
});

test('Node framework entry rejects unknown modes and malformed listening ports', () => {
  for (const mode of ['', 'dev', 'deploy']) assert.throws(() => nodeFrameworkArguments(mode, {}), /build or start/);
  for (const PORT of ['0', '65536', '-1', '3000abc', '3.5', ' 3000']) assert.throws(() => nodeFrameworkArguments('start', { PORT }), /PORT/);
  const rejected = spawnSync(process.execPath, [cli, 'dev'], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /build or start/);
});

test('Node production mode disables telemetry and never accepts Sites identity headers', () => {
  const input = Object.freeze({ NODE_ENV: 'development', LITTLELEAF_HOSTING: 'sites', NEXT_TELEMETRY_DISABLED: '0', TEEKO_NODE_RUNTIME: '0', PORT: '3456' });
  const result = nodeFrameworkEnvironment(input);
  assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.LITTLELEAF_HOSTING, 'railway');
  assert.equal(result.NEXT_TELEMETRY_DISABLED, '1');
  assert.equal(result.TEEKO_NODE_RUNTIME, '1');
  assert.equal(result.PORT, '3456');
  assert.equal(input.LITTLELEAF_HOSTING, 'sites');
});
