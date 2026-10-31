import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccountPool } from '../db/postgres.ts';

test('an idle PostgreSQL connection failure cannot become an uncaught process error', async () => {
  const pool = getAccountPool('postgresql://localhost/fixture_not_connected');
  try {
    assert.doesNotThrow(() => pool.emit('error', new Error('synthetic idle connection failure')));
  } finally { await pool.end(); }
});
