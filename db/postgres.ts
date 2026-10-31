import { Pool } from 'pg';

let singleton: Pool | undefined;
let configuredUrl: string | undefined;

export function getAccountPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) throw new Error('账号数据库尚未配置。');
  if (!singleton) {
    configuredUrl = databaseUrl;
    singleton = new Pool({ connectionString: databaseUrl, max: 8, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, application_name: 'teeko-accounts' });
    // pg removes failed idle clients; query failures still reach their callers.
    singleton.on('error', () => {});
  }
  if (databaseUrl !== configuredUrl) throw new Error('账号数据库配置发生变化，请重启服务。');
  return singleton;
}
