import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, rm, access, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrateAccounts } from '../scripts/migrate-accounts.mjs';

const database = process.env.TEST_ACCOUNT_DATABASE_URL;
const project = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/manage-invitations.ts', import.meta.url));
const secret = 'synthetic-cli-account-test-key-over-32-bytes';

test('real invitation CLI exports private codes once, lists metadata and disables without stdout secrets', { skip: !database, timeout: 20_000 }, async t => {
  assert(database);
  const url = new URL(database);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/teeko_node', 'Only loopback disposable teeko_node may be used.');
  const admin = new Pool({ connectionString: url.href });
  const schema = `cli_fixture_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'teeko-invite-cli-'));
  const alias = join(project, '.private', `cli-alias-${randomUUID()}`);
  const escapedName = `fixture-invitations-${randomUUID()}.csv`;
  const escapedFile = join(project, 'components', escapedName);
  t.after(async () => {
    await rm(alias, { force: true }); await rm(escapedFile, { force: true }); await rm(directory, { recursive: true, force: true });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  await migrateAccounts(url.href);
  function run(args: string[]) {
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
        cwd: project, env: { ...process.env, DATABASE_URL: url.href, AUTH_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000,
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
    });
  }
  const output = join(directory, 'batch.csv');
  const issued = await run(['issue', '--count', '2', '--days', '2', '--batch', 'synthetic-cli-batch', '--out', output]);
  assert.equal(issued.status, 0); assert.match(issued.stdout, /Generated 2 invitations/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const lines = (await readFile(output, 'utf8')).trim().split('\n');
  assert.equal(lines[0], 'id,code,expires_at'); assert.equal(lines.length, 3);
  const issuedRows = lines.slice(1).map(line => line.split(','));
  for (const row of issuedRows) { assert.match(row[1], /^[A-F0-9]{32}$/); assert(!issued.stdout.includes(row[1]) && !issued.stderr.includes(row[1])); }
  const listed = await run(['list']); assert.equal(listed.status, 0);
  const metadata = JSON.parse(listed.stdout) as { id: string; disabledAt: string | null; code?: string; code_hash?: string }[];
  assert.equal(metadata.length, 2);
  for (const row of metadata) { assert.equal(row.code, undefined); assert.equal(row.code_hash, undefined); }
  for (const row of issuedRows) assert(!listed.stdout.includes(row[1]));
  const existing = await run(['issue', '--count', '1', '--out', output]); assert.equal(existing.status, 1);
  assert.equal((JSON.parse((await run(['list'])).stdout) as unknown[]).length, 2);
  assert.equal((await run(['disable', issuedRows[0][0]])).status, 0);
  const afterDisable = JSON.parse((await run(['list'])).stdout) as { id: string; disabledAt: string | null }[];
  assert(afterDisable.find(row => row.id === issuedRows[0][0])?.disabledAt);
  const publicFile = join(project, 'public', escapedName);
  assert.equal((await run(['issue', '--count', '1', '--out', publicFile])).status, 1);
  await assert.rejects(access(publicFile), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.equal((await run(['issue', '--count', '1', '--out', escapedFile])).status, 1);
  await assert.rejects(access(escapedFile), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  await mkdir(join(project, '.private'), { recursive: true, mode: 0o700 });
  await symlink(join(project, 'components'), alias, 'dir');
  const escape = await run(['issue', '--count', '1', '--out', join(alias, escapedName)]);
  assert.equal(escape.status, 1, 'Private export path must not follow a symlink into source or public directories.');
  await assert.rejects(access(escapedFile), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.equal((JSON.parse((await run(['list'])).stdout) as unknown[]).length, 2);
  t.diagnostic('Actual CLI issue/list/disable, mode0600, no stdout codes, overwrite and unsafe-path rejection passed.');
});
