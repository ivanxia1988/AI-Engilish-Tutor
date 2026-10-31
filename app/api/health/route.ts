import { getAccountPool } from '../../../db/postgres';
import { accountOrigin, getAccountService } from '../../../lib/server/account-runtime';
import { readRuntimeEnv } from '../../../lib/server/runtime-env';
import { ACCOUNT_TERMS_VERSION } from '../../../lib/account-terms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    accountOrigin(); getAccountService();
    if (!readRuntimeEnv('RESEND_API_KEY') || !readRuntimeEnv('RESEND_FROM') || readRuntimeEnv('ACCOUNT_TERMS_VERSION') !== ACCOUNT_TERMS_VERSION) throw new Error('configuration');
    const result = await getAccountPool(readRuntimeEnv('DATABASE_URL')).query("SELECT EXISTS(SELECT 1 FROM teeko_schema_migrations WHERE name='0001_accounts.sql') AS ready");
    if (!result.rows[0]?.ready) throw new Error('migration');
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
