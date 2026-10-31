import { mkdir, open, chmod, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { AccountService } from '../lib/server/account-service';
import { exportInvitationBatch, InvitationExportError } from '../lib/server/invitation-export';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL, secret = process.env.AUTH_SECRET;
  if (!databaseUrl || !secret) throw new Error('configuration');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const service = new AccountService(pool, { secret, sendCode: async () => { throw new Error('Email is unavailable in this command.'); } });
    if (command === 'list' && args.length === 0) {
      process.stdout.write(JSON.stringify(await service.listInvitations(), null, 2) + '\n'); return;
    }
    if (command === 'disable' && args.length === 1 && /^[\da-f-]{36}$/i.test(args[0])) {
      await service.disableInvitation(args[0]); process.stdout.write('Invitation disabled.\n'); return;
    }
    if (command !== 'issue') throw new Error('arguments');
    const flags = new Map<string,string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--count', '--days', '--batch', '--out'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error('arguments');
      flags.set(args[i], args[i + 1]);
    }
    const count = Number(flags.get('--count') ?? '10'), days = Number(flags.get('--days') ?? '30');
    if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('arguments');
    const output = resolve(flags.get('--out') ?? `.private/invitations-${new Date().toISOString().slice(0,10)}-${randomBytes(4).toString('hex')}.csv`);
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const withinProject = relative(projectRoot, output);
    if (!withinProject.startsWith(`..${sep}`) && withinProject !== '..' && !withinProject.startsWith(`.private${sep}`)) throw new Error('Private exports cannot be written into product or source directories.');
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    const canonicalRelative = relative(await realpath(projectRoot), resolve(await realpath(dirname(output)), basename(output)));
    if (!canonicalRelative.startsWith(`..${sep}`) && canonicalRelative !== '..' && !canonicalRelative.startsWith(`.private${sep}`)) throw new Error('Private export path resolves into product or source directories.');
    const file = await open(output, 'wx', 0o600);
    try {
      await exportInvitationBatch(service, { count, issuedBy: flags.get('--batch') ?? 'private-distribution', expiresAt: new Date(Date.now() + days * 86400000) }, async csv => {
        await file.writeFile(csv); await file.sync(); await chmod(output, 0o600);
      });
      process.stdout.write(`Generated ${count} invitations. Private CSV: ${output}\n`);
    } finally { await file.close(); }
  } finally { await pool.end(); }
}
main().catch(error => {
  if (error instanceof InvitationExportError && error.pendingDisableIds.length) process.stderr.write(`Pending manual disable IDs: ${error.pendingDisableIds.join(',')}\n`);
  process.stderr.write('Invitation command failed. Check arguments, administrator environment and database. No codes were printed.\n'); process.exitCode = 1;
});
