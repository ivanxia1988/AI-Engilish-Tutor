import { z } from 'zod';

type Purpose = 'register' | 'reset';
type User = { id: string; email: string; profileComplete: boolean };
type Profile = { name: string; ageRange: '8–9' | '10–11' | '12–13'; level: 'starter' | 'sentences' | 'conversation' | 'unsure' };
export interface AccountBackend {
  verifyInvitation(code: string): Promise<{ flowToken: string }>;
  sendCode(purpose: Purpose, email: string, flowToken?: string): Promise<{ flowToken: string; retryAfter: number }>;
  verifyCode(purpose: Purpose, code: string, flowToken: string): Promise<void>;
  register(flowToken: string, password: string, consentVersion: string): Promise<{ sessionToken: string; user: User }>;
  login(email: string, password: string): Promise<{ sessionToken: string; user: User }>;
  reset(flowToken: string, password: string): Promise<void>;
  session(token?: string): Promise<User | null>;
  flow(token?: string): Promise<{ purpose: Purpose; stage: string; email?: string } | null>;
  logout(token?: string): Promise<void>;
  cancelFlow(token?: string): Promise<void>;
  getProfile(id: string): Promise<Profile | null>;
  saveProfile(id: string, data: Profile): Promise<Profile>;
  limit(key: string, maximum: number, windowSeconds: number): Promise<void>;
}
type Dependencies = { service: AccountBackend; origin: string; termsVersion: string; accountError: (error: unknown) => { code: string; message: string; status: number } | null };
const purpose = z.enum(['register', 'reset']);
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(64);
const passwordPair = z.object({ password, confirmation: password }).strict().refine(value => value.password === value.confirmation);
const schemas = {
  invitation: z.object({ code: z.string().trim().min(1).max(128) }).strict(),
  code: z.object({ purpose, email }).strict(),
  verify: z.object({ purpose, code: z.string().regex(/^\d{6}$/) }).strict(),
  register: z.object({ password, confirmation: password, agreed: z.literal(true) }).strict().refine(value => value.password === value.confirmation),
  login: z.object({ email, password: z.string().min(1).max(64) }).strict(),
  reset: passwordPair,
  profile: z.object({ name: z.string().trim().min(1).max(20).regex(/^[^\u0000-\u001f\u007f]+$/), ageRange: z.enum(['8–9', '10–11', '12–13']), level: z.enum(['starter', 'sentences', 'conversation', 'unsure']) }).strict(),
  empty: z.object({}).strict(),
};
class HttpProblem extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
export function accountCookie(request: Request, name: 'teeko_session' | 'teeko_flow'): string | undefined {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : undefined;
}
async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpProblem('CONTENT_TYPE', '请使用 JSON 请求。', 415);
  const declared = Number(request.headers.get('content-length') || '0');
  if (!Number.isFinite(declared) || declared < 0 || declared > 8192) throw new HttpProblem('BODY_TOO_LARGE', '请求内容过长。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpProblem('INVALID_INPUT', '请检查填写的内容。', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new HttpProblem('BODY_TOO_LARGE', '请求内容过长。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpProblem('INVALID_INPUT', '请检查填写的内容。', 400); }
}
function input<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpProblem('INVALID_INPUT', '请检查填写的内容、密码及协议确认。', 400);
  return result.data;
}
export function accountResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' } });
}
export function createAccountHandler(dependencies: Dependencies) {
  const { service, origin, termsVersion, accountError } = dependencies;
  const cookie = (response: Response, name: string, token: string, age: number) => {
    response.headers.append('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`);
  };
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
      const write = request.method === 'POST' || request.method === 'PATCH';
      if (write && (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')) throw new HttpProblem('ORIGIN', '请求来源无效，请刷新页面重试。', 403);
      const sessionToken = accountCookie(request, 'teeko_session');
      const flowToken = accountCookie(request, 'teeko_flow');
      if (request.method === 'GET') {
        if (path === '/auth/state') return accountResponse({ ok: true, user: await service.session(sessionToken), flow: await service.flow(flowToken) });
        if (path === '/profile' || path === '/courses') {
          const user = await service.session(sessionToken);
          if (!user) throw new HttpProblem('UNAUTHORIZED', '请先登录。', 401);
          if (path === '/profile') return accountResponse({ ok: true, profile: await service.getProfile(user.id) });
          if (!user.profileComplete) throw new HttpProblem('PROFILE_REQUIRED', '请先填写孩子档案。', 409);
          return accountResponse({ ok: true, courses: [] });
        }
        throw new HttpProblem('NOT_FOUND', '接口不存在。', 404);
      }
      if (!write) throw new HttpProblem('METHOD', '不支持此请求方式。', 405);
      if (!['/invitations/verify', '/auth/code', '/auth/verify', '/auth/register', '/auth/login', '/auth/reset', '/auth/logout', '/auth/cancel', '/profile'].includes(path)) throw new HttpProblem('NOT_FOUND', '接口不存在。', 404);
      const body = await boundedJson(request);
      await service.limit(`http:${path}`, path === '/auth/code' ? 20 : 120, 60);
      const needFlow = () => { if (!flowToken) throw new HttpProblem('FLOW_REQUIRED', '验证已失效，请重新开始。', 400); return flowToken; };
      if (request.method === 'PATCH' && path === '/profile') {
        const data = input(schemas.profile, body), user = await service.session(sessionToken);
        if (!user) throw new HttpProblem('UNAUTHORIZED', '请先登录。', 401);
        return accountResponse({ ok: true, profile: await service.saveProfile(user.id, data) });
      }
      if (request.method !== 'POST') throw new HttpProblem('METHOD', '不支持此请求方式。', 405);
      if (path === '/invitations/verify') {
        const data = input(schemas.invitation, body);
        const result = await service.verifyInvitation(data.code);
        await service.cancelFlow(flowToken);
        const response = accountResponse({ ok: true, next: '/login?intent=register' });
        cookie(response, 'teeko_flow', result.flowToken, 1800); return response;
      }
      if (path === '/auth/code') {
        const data = input(schemas.code, body);
        const result = await service.sendCode(data.purpose, data.email, flowToken);
        const response = accountResponse({ ok: true, stage: 'code', retryAfter: result.retryAfter });
        cookie(response, 'teeko_flow', result.flowToken, 1800); return response;
      }
      if (path === '/auth/verify') {
        const data = input(schemas.verify, body);
        await service.verifyCode(data.purpose, data.code, needFlow());
        return accountResponse({ ok: true, stage: 'password' });
      }
      if (path === '/auth/register' || path === '/auth/login') {
        const result = path === '/auth/register'
          ? await service.register(needFlow(), input(schemas.register, body).password, termsVersion)
          : await (async () => { const data = input(schemas.login, body); return service.login(data.email, data.password); })();
        const response = accountResponse({ ok: true, next: result.user.profileComplete ? '/courses' : '/onboarding' });
        cookie(response, 'teeko_session', result.sessionToken, 604800);
        cookie(response, 'teeko_flow', '', 0); return response;
      }
      if (path === '/auth/reset') {
        const data = input(schemas.reset, body);
        await service.reset(needFlow(), data.password);
        const response = accountResponse({ ok: true, next: '/login' });
        cookie(response, 'teeko_flow', '', 0); cookie(response, 'teeko_session', '', 0); return response;
      }
      if (path === '/auth/logout' || path === '/auth/cancel') {
        input(schemas.empty, body);
        if (path === '/auth/logout') await service.logout(sessionToken);
        await service.cancelFlow(flowToken);
        const response = accountResponse({ ok: true, next: '/' });
        cookie(response, 'teeko_flow', '', 0);
        if (path === '/auth/logout') cookie(response, 'teeko_session', '', 0);
        return response;
      }
      throw new HttpProblem('NOT_FOUND', '接口不存在。', 404);
    } catch (error) {
      const known = error instanceof HttpProblem ? error : accountError(error);
      const recovery = known?.code === 'FLOW_INVALID' && new URL(request.url).pathname === '/api/v1/auth/register' ? '验证已失效。若刚才已提交注册，请返回登录；否则重新验证邀请码。' : undefined;
      return accountResponse({ ok: false, error: { code: known?.code ?? 'UNAVAILABLE', message: recovery ?? known?.message ?? '账号服务暂时不可用，请稍后再试。' } }, known?.status ?? 503);
    }
  };
}
