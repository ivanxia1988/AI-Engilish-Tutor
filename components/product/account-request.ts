import { z } from 'zod';

export const accountUser = z.object({ id: z.string(), email: z.string().email(), profileComplete: z.boolean() });
export const accountFlow = z.object({ purpose: z.enum(['register', 'reset']), stage: z.enum(['email', 'code', 'password']), email: z.string().email().optional() });
export const accountState = z.object({ ok: z.literal(true), user: accountUser.nullable(), flow: accountFlow.nullable() });
export const completed = z.object({ ok: z.literal(true) });
export const destination = z.object({ ok: z.literal(true), next: z.enum(['/', '/login', '/login?intent=register', '/login?intent=recover', '/onboarding', '/courses']) });
export const sentCode = z.object({ ok: z.literal(true), stage: z.literal('code'), retryAfter: z.number().int().min(0).max(3600) });
export const verifiedCode = z.object({ ok: z.literal(true), stage: z.literal('password') });
export const childProfile = z.object({ name: z.string().trim().min(1).max(20), ageRange: z.enum(['8–9', '10–11', '12–13']), level: z.enum(['starter', 'sentences', 'conversation', 'unsure']) });
export const profileResponse = z.object({ ok: z.literal(true), profile: childProfile.nullable() });
export type ChildProfile = z.infer<typeof childProfile>;
export type ProductDestination = z.infer<typeof destination>['next'];
export const accountFailure = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string().min(1).max(300) }) });

export class AccountRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function accountRequest<T extends z.ZodTypeAny>(path: string, schema: T, options: { body?: unknown; method?: 'POST' | 'PATCH'; signal?: AbortSignal } = {}): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', signal: options.signal, ...(options.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('连接未成功，请检查网络后重试。');
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('服务响应异常，请稍后重试。'); }
  if (!response.ok) {
    const failure = accountFailure.safeParse(body);
    throw new AccountRequestError(failure.success ? failure.data.error.message : '服务暂不可用，请稍后重试。', response.status);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new Error('服务响应异常，请稍后重试。');
  return result.data;
}

export function navigateProduct(path: ProductDestination) { window.location.assign(path); }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
