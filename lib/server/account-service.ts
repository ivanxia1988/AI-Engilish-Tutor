import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { DUMMY_PASSWORD_HASH, hashPassword, newOtp, newToken, protectedDigest, validPassword, verifyPassword } from './auth-crypto';

export class AccountError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = 'AccountError'; }
}
export type AccountPurpose = 'register' | 'reset';
export type AccountUser = { id: string; email: string; profileComplete: boolean };
export type AccountProfile = { name: string; ageRange: '8–9' | '10–11' | '12–13'; level: 'starter' | 'sentences' | 'conversation' | 'unsure' };
export type CodeDelivery = { email: string; code: string; purpose: AccountPurpose; idempotencyKey: string };
export type PublicFlow = { purpose: AccountPurpose; stage: 'email' | 'code' | 'password'; email?: string };
export type Invitation = { id: string; code: string; expiresAt: Date };
type Options = { secret: string; sendCode: (delivery: CodeDelivery) => Promise<void>; now?: () => Date };
type FlowRow = {
  id: string; purpose: AccountPurpose; invitation_id: string | null; email: string | null; account_version: number | null; stage: PublicFlow['stage'];
  otp_hash: string | null; otp_expires_at: Date | null; otp_ready: boolean; delivery_id: string | null; attempts: number; sends: number; sent_at: Date | null;
  verified_at: Date | null; expires_at: Date; consumed_at: Date | null;
};
type InvitationRow = { id: string; expires_at: Date; disabled_at: Date | null; redeemed_at: Date | null };
type AccountRow = { id: string; email: string; password_hash: string; auth_version: number };
const profileSchema = z.object({ name: z.string().trim().min(1).max(20).regex(/^[^\u0000-\u001f\u007f]+$/), ageRange: z.enum(['8–9', '10–11', '12–13']), level: z.enum(['starter', 'sentences', 'conversation', 'unsure']) }).strict();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MINUTE = 60_000;
const flowError = () => new AccountError('FLOW_INVALID', '验证已失效，请重新开始。', 410);
const codeError = () => new AccountError('CODE_INVALID', '验证码不正确或已过期。');
const loginError = () => new AccountError('LOGIN_INVALID', '邮箱或密码不正确。', 401);
const limitError = () => new AccountError('RATE_LIMITED', '操作太频繁，请稍后再试。', 429);

export class AccountService {
  private readonly secret: string;
  private readonly clock: () => Date;
  constructor(private readonly pool: Pool, private readonly options: Options) {
    if (Buffer.byteLength(options.secret, 'utf8') < 32) throw new Error('账号保护密钥尚未配置。');
    this.secret = options.secret; this.clock = options.now ?? (() => new Date());
  }
  private digest(purpose: string, value: string) { return protectedDigest(this.secret, purpose, value); }
  private date() { return new Date(this.clock()); }
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private email(value: string) {
    if (typeof value !== 'string' || value.length > 254 || !z.string().email().safeParse(value.trim()).success) throw new AccountError('EMAIL_INVALID', '请输入有效的邮箱地址。');
    return value.trim().toLowerCase();
  }
  private purpose(value: AccountPurpose) { if (value !== 'register' && value !== 'reset') throw flowError(); }
  private assertFlow(flow: FlowRow | undefined, purpose?: AccountPurpose, proof = false): FlowRow {
    const now = this.date().getTime();
    if (!flow || flow.consumed_at || flow.expires_at.getTime() <= now || (purpose && flow.purpose !== purpose)) throw flowError();
    if (proof && (flow.stage !== 'password' || !flow.email || !flow.verified_at || flow.verified_at.getTime() + 10 * MINUTE <= now)) throw flowError();
    return flow;
  }
  private assertInvitation(invitation: InvitationRow | undefined) {
    if (!invitation) throw new AccountError('INVITATION_INVALID', '邀请码不正确。');
    if (invitation.disabled_at) throw new AccountError('INVITATION_DISABLED', '这个邀请码已停用。');
    if (invitation.redeemed_at) throw new AccountError('INVITATION_USED', '这个邀请码已使用。');
    if (invitation.expires_at.getTime() <= this.date().getTime()) throw new AccountError('INVITATION_EXPIRED', '这个邀请码已过期。');
    return invitation;
  }
  private async lockedFlow(client: PoolClient, token: string, purpose?: AccountPurpose, proof = false) {
    if (!TOKEN.test(token ?? '')) throw flowError();
    const result = await client.query<FlowRow>('SELECT * FROM teeko_account_flows WHERE token_hash=$1 FOR UPDATE', [this.digest('flow', token)]);
    return this.assertFlow(result.rows[0], purpose, proof);
  }
  private async user(client: PoolClient | Pool, id: string): Promise<AccountUser> {
    const result = await client.query<{ id: string; email: string; complete: boolean }>('SELECT a.id,a.email,EXISTS(SELECT 1 FROM teeko_profiles p WHERE p.account_id=a.id) AS complete FROM teeko_accounts a WHERE a.id=$1', [id]);
    const account = result.rows[0];
    if (!account) throw new AccountError('AUTH_REQUIRED', '请先登录。', 401);
    return { id: account.id, email: account.email, profileComplete: account.complete };
  }
  private async createSession(client: PoolClient, account: AccountRow) {
    const token = newToken(), now = this.date();
    await client.query('INSERT INTO teeko_sessions(token_hash,account_id,auth_version,expires_at,created_at) VALUES($1,$2,$3,$4,$5)', [this.digest('session', token), account.id, account.auth_version, new Date(now.getTime() + 7 * 24 * 60 * MINUTE), now]);
    return { sessionToken: token, user: await this.user(client, account.id) };
  }
  async limit(key: string, max: number, windowSeconds: number): Promise<void> {
    const now = this.date();
    const result = await this.pool.query<{ count: number }>(`INSERT INTO teeko_auth_limits(key,count,started_at) VALUES($1,1,$2)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN teeko_auth_limits.started_at <= $3 THEN 1 ELSE teeko_auth_limits.count+1 END,
      started_at=CASE WHEN teeko_auth_limits.started_at <= $3 THEN $2 ELSE teeko_auth_limits.started_at END RETURNING count`,
    [this.digest('limit', key), now, new Date(now.getTime() - windowSeconds * 1000)]);
    if (result.rows[0].count > max) throw limitError();
  }
  async issueInvitations(input: { count: number; expiresAt: Date; issuedBy: string }): Promise<Invitation[]> {
    const now = this.date();
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000 || !(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= now || input.expiresAt.getTime() > now.getTime() + 366 * 24 * 60 * MINUTE || !input.issuedBy?.trim() || input.issuedBy.length > 100) throw new AccountError('INVITATION_INPUT_INVALID', '请检查发码数量、有效期和批次标记。');
    return this.transaction(async client => {
      const issued: Invitation[] = [];
      for (let i = 0; i < input.count; i++) {
        const code = randomBytes(16).toString('hex').toUpperCase(), id = randomUUID();
        await client.query('INSERT INTO teeko_invitations(id,code_hash,issued_by,issued_at,expires_at) VALUES($1,$2,$3,$4,$5)', [id, this.digest('invitation', code), input.issuedBy.trim(), now, input.expiresAt]);
        issued.push({ id, code, expiresAt: input.expiresAt });
      }
      return issued;
    });
  }
  async listInvitations(): Promise<{ id: string; issuedBy: string; issuedAt: Date; expiresAt: Date; disabledAt: Date | null; redeemedBy: string | null; redeemedAt: Date | null }[]> {
    return (await this.pool.query('SELECT id,issued_by AS "issuedBy",issued_at AS "issuedAt",expires_at AS "expiresAt",disabled_at AS "disabledAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt" FROM teeko_invitations ORDER BY issued_at DESC LIMIT 1000')).rows;
  }
  async disableInvitation(id: string): Promise<void> {
    if (!z.string().uuid().safeParse(id).success) throw new AccountError('INVITATION_INVALID', '邀请码记录不正确。');
    await this.pool.query('UPDATE teeko_invitations SET disabled_at=COALESCE(disabled_at,$1) WHERE id=$2', [this.date(), id]);
  }
  async verifyInvitation(code: string): Promise<{ flowToken: string }> {
    await this.limit('invitation-verifications', 100, 60);
    if (typeof code !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(code.trim())) throw new AccountError('INVITATION_INVALID', '邀请码不正确。');
    const invitation = this.assertInvitation((await this.pool.query<InvitationRow>('SELECT * FROM teeko_invitations WHERE code_hash=$1', [this.digest('invitation', code.trim().toUpperCase())])).rows[0]);
    const token = newToken(), now = this.date();
    await this.pool.query("INSERT INTO teeko_account_flows(id,token_hash,purpose,invitation_id,stage,expires_at,created_at) VALUES($1,$2,'register',$3,'email',$4,$5)", [randomUUID(), this.digest('flow', token), invitation.id, new Date(now.getTime() + 30 * MINUTE), now]);
    return { flowToken: token };
  }
  async sendCode(purpose: AccountPurpose, emailInput: string, flowToken?: string): Promise<{ flowToken: string; stage: 'code'; retryAfter: 60 }> {
    this.purpose(purpose); const email = this.email(emailInput);
    await this.limit(`code-email:${email}`, 5, 3600);
    await this.limit('code-deliveries', 100, 3600);
    const token = flowToken || newToken(), code = newOtp(), deliveryId = randomUUID(), now = this.date();
    const reserved = await this.transaction(async client => {
      let flow: FlowRow;
      if (flowToken) flow = await this.lockedFlow(client, token, purpose);
      else {
        if (purpose === 'register') throw flowError();
        const result = await client.query<FlowRow>("INSERT INTO teeko_account_flows(id,token_hash,purpose,stage,expires_at,created_at) VALUES($1,$2,'reset','email',$3,$4) RETURNING *", [randomUUID(), this.digest('flow', token), new Date(now.getTime() + 30 * MINUTE), now]);
        flow = result.rows[0];
      }
      if (flow.sent_at && flow.sent_at.getTime() + MINUTE > now.getTime()) throw limitError();
      if (flow.sends >= 5) throw limitError();
      if (purpose === 'register') {
        this.assertInvitation((await client.query<InvitationRow>('SELECT * FROM teeko_invitations WHERE id=$1 FOR SHARE', [flow.invitation_id])).rows[0]);
        if ((await client.query('SELECT id FROM teeko_accounts WHERE email=$1', [email])).rowCount) throw new AccountError('EMAIL_UNAVAILABLE', '这个邮箱无法注册，请登录或找回密码。', 409);
      }
      const account = purpose === 'reset' ? (await client.query<AccountRow>('SELECT id,auth_version FROM teeko_accounts WHERE email=$1', [email])).rows[0] : undefined;
      const exists = purpose === 'register' || Boolean(account);
      await client.query("UPDATE teeko_account_flows SET email=$1,stage='code',otp_hash=$2,otp_expires_at=$3,otp_ready=false,delivery_id=$4,attempts=0,sends=sends+1,sent_at=$5,verified_at=NULL,account_version=$7 WHERE id=$6", [email, this.digest('otp', `${flow.id}:${purpose}:${email}:${code}`), new Date(now.getTime() + 5 * MINUTE), deliveryId, now, flow.id, account?.auth_version ?? null]);
      return { id: flow.id, exists };
    });
    try {
      if (reserved.exists) await this.options.sendCode({ email, code, purpose, idempotencyKey: deliveryId });
    } catch {
      await this.pool.query('UPDATE teeko_account_flows SET otp_hash=NULL,otp_ready=false WHERE id=$1 AND delivery_id=$2', [reserved.id, deliveryId]);
      throw new AccountError('MAIL_UNAVAILABLE', '验证码邮件暂时无法发送，请稍后重试。', 503);
    }
    const activated = await this.pool.query('UPDATE teeko_account_flows SET otp_ready=$1 WHERE id=$2 AND delivery_id=$3 AND consumed_at IS NULL AND expires_at>$4', [reserved.exists, reserved.id, deliveryId, this.date()]);
    if (!activated.rowCount) throw flowError();
    return { flowToken: token, stage: 'code', retryAfter: 60 };
  }
  async verifyCode(purpose: AccountPurpose, code: string, flowToken: string): Promise<void> {
    this.purpose(purpose);
    const error = await this.transaction(async client => {
      const flow = await this.lockedFlow(client, flowToken, purpose);
      if (flow.attempts >= 5) return new AccountError('CODE_LOCKED', '尝试次数过多，请重新获取验证码。', 429);
      if (flow.stage !== 'code' || !flow.otp_ready || !flow.otp_hash || !flow.otp_expires_at || flow.otp_expires_at <= this.date()) return codeError();
      const valid = typeof code === 'string' && /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(this.digest('otp', `${flow.id}:${purpose}:${flow.email}:${code}`), 'hex'), Buffer.from(flow.otp_hash, 'hex'));
      if (!valid) { await client.query('UPDATE teeko_account_flows SET attempts=attempts+1 WHERE id=$1', [flow.id]); return codeError(); }
      await client.query("UPDATE teeko_account_flows SET stage='password',verified_at=$1,otp_hash=NULL,otp_ready=false WHERE id=$2", [this.date(), flow.id]);
      return null;
    });
    if (error) throw error;
  }
  async register(flowToken: string, password: string, consentVersion: string) {
    if (!validPassword(password)) throw new AccountError('PASSWORD_INVALID', '密码需为8–64个字符。');
    if (!consentVersion?.trim() || consentVersion.length > 100) throw new AccountError('AGREEMENT_REQUIRED', '请先阅读并同意用户协议。');
    const encoded = await hashPassword(password);
    try {
      return await this.transaction(async client => {
        const flow = await this.lockedFlow(client, flowToken, 'register', true);
        const invitation = this.assertInvitation((await client.query<InvitationRow>('SELECT * FROM teeko_invitations WHERE id=$1 FOR UPDATE', [flow.invitation_id])).rows[0]);
        const now = this.date(), id = randomUUID();
        const account = (await client.query<AccountRow>('INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,$3,$4,$5,$5) RETURNING *', [id, flow.email, encoded, consentVersion, now])).rows[0];
        await client.query('UPDATE teeko_invitations SET redeemed_by=$1,redeemed_at=$2 WHERE id=$3', [id, now, invitation.id]);
        await client.query('UPDATE teeko_account_flows SET consumed_at=$1 WHERE id=$2', [now, flow.id]);
        return this.createSession(client, account);
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new AccountError('EMAIL_UNAVAILABLE', '这个邮箱无法注册，请登录或找回密码。', 409);
      throw error;
    }
  }
  async login(emailInput: string, password: string) {
    let email: string;
    try { email = this.email(emailInput); } catch { throw loginError(); }
    await this.limit(`login:${email}`, 10, 15 * 60);
    const before = (await this.pool.query<AccountRow>('SELECT * FROM teeko_accounts WHERE email=$1', [email])).rows[0];
    const matched = await verifyPassword(password, before?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!before || !matched) throw loginError();
    return this.transaction(async client => {
      const current = (await client.query<AccountRow>('SELECT * FROM teeko_accounts WHERE id=$1 FOR UPDATE', [before.id])).rows[0];
      if (!current || current.password_hash !== before.password_hash || current.auth_version !== before.auth_version) throw loginError();
      return this.createSession(client, current);
    });
  }
  async reset(flowToken: string, password: string): Promise<void> {
    if (!validPassword(password)) throw new AccountError('PASSWORD_INVALID', '密码需为8–64个字符。');
    const encoded = await hashPassword(password);
    await this.transaction(async client => {
      if (!TOKEN.test(flowToken ?? '')) throw flowError();
      const snapshot = this.assertFlow((await client.query<FlowRow>('SELECT * FROM teeko_account_flows WHERE token_hash=$1', [this.digest('flow', flowToken)])).rows[0], 'reset', true);
      // Lock the account before flows so two reset proofs cannot deadlock each other.
      const account = (await client.query<AccountRow>('SELECT * FROM teeko_accounts WHERE email=$1 FOR UPDATE', [snapshot.email])).rows[0];
      if (!account) throw flowError();
      const flow = await this.lockedFlow(client, flowToken, 'reset', true);
      if (flow.account_version !== account.auth_version) throw flowError();
      await client.query('UPDATE teeko_accounts SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [encoded, account.id]);
      await client.query('DELETE FROM teeko_sessions WHERE account_id=$1', [account.id]);
      await client.query("UPDATE teeko_account_flows SET consumed_at=$1,otp_hash=NULL,otp_ready=false WHERE purpose='reset' AND email=$2 AND consumed_at IS NULL", [this.date(), flow.email]);
    });
  }
  async session(token?: string): Promise<AccountUser | null> {
    if (!TOKEN.test(token ?? '')) return null;
    const result = await this.pool.query<{ id: string; email: string; complete: boolean }>('SELECT a.id,a.email,EXISTS(SELECT 1 FROM teeko_profiles p WHERE p.account_id=a.id) AS complete FROM teeko_sessions s JOIN teeko_accounts a ON a.id=s.account_id AND a.auth_version=s.auth_version WHERE s.token_hash=$1 AND s.expires_at>$2', [this.digest('session', token!), this.date()]);
    return result.rows[0] ? { id: result.rows[0].id, email: result.rows[0].email, profileComplete: result.rows[0].complete } : null;
  }
  async flow(token?: string): Promise<PublicFlow | null> {
    if (!TOKEN.test(token ?? '')) return null;
    const row = (await this.pool.query<FlowRow>('SELECT * FROM teeko_account_flows WHERE token_hash=$1', [this.digest('flow', token!)])).rows[0];
    try { const flow = this.assertFlow(row, undefined, row?.stage === 'password'); return { purpose: flow.purpose, stage: flow.stage, ...(flow.email ? { email: flow.email } : {}) }; } catch (error) { if (error instanceof AccountError) return null; throw error; }
  }
  async logout(token?: string): Promise<void> { if (TOKEN.test(token ?? '')) await this.pool.query('DELETE FROM teeko_sessions WHERE token_hash=$1', [this.digest('session', token!)]); }
  async cancelFlow(token?: string): Promise<void> { if (TOKEN.test(token ?? '')) await this.pool.query('UPDATE teeko_account_flows SET consumed_at=COALESCE(consumed_at,$1),otp_hash=NULL,otp_ready=false WHERE token_hash=$2', [this.date(), this.digest('flow', token!)]); }
  async getProfile(id: string): Promise<AccountProfile | null> {
    return (await this.pool.query<AccountProfile>('SELECT name,age_range AS "ageRange",level FROM teeko_profiles WHERE account_id=$1', [id])).rows[0] ?? null;
  }
  async saveProfile(id: string, input: AccountProfile): Promise<AccountProfile> {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) throw new AccountError('PROFILE_INVALID', '请检查孩子称呼、年龄段和英语基础。');
    const profile = parsed.data;
    await this.pool.query('INSERT INTO teeko_profiles(account_id,name,age_range,level,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO UPDATE SET name=EXCLUDED.name,age_range=EXCLUDED.age_range,level=EXCLUDED.level,updated_at=EXCLUDED.updated_at', [id, profile.name, profile.ageRange, profile.level, this.date()]);
    return profile;
  }
}
