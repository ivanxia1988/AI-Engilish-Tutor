import type { LivePerformanceSample } from './live-performance';

export type NetworkCheckResult = {
  status: 'good' | 'poor' | 'unavailable' | 'offline';
  medianMs: number | null;
  spreadMs: number | null;
  succeeded: number;
  attempted: number;
};
export type NetworkAttempt = { durationMs: number | null };
export function classifyNetwork(attempts: NetworkAttempt[], onlineHint?: boolean): NetworkCheckResult {
  const durations = attempts.map(a => a.durationMs).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const attempted = attempts.length, succeeded = durations.length;
  if (!succeeded) return { status: onlineHint === false ? 'offline' : 'unavailable', medianMs: null, spreadMs: null, succeeded, attempted };
  const mid = Math.floor(succeeded / 2), medianMs = succeeded % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  const spreadMs = durations.at(-1)! - durations[0];
  // Product warning heuristics for website HTTP reachability, not a voice-quality guarantee.
  const poor = succeeded < attempted || medianMs > 800 || spreadMs > 600;
  return { status: poor ? 'poor' : 'good', medianMs, spreadMs, succeeded, attempted };
}

type Options = { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal; onlineHint?: boolean; timeoutMs?: number };
const aborted = () => new DOMException('Network check cancelled.', 'AbortError');
export async function checkNetwork(options: Options = {}): Promise<NetworkCheckResult> {
  const request = options.fetch || globalThis.fetch.bind(globalThis);
  const now = options.now || (() => performance.now());
  const attempts: NetworkAttempt[] = [];
  const timeoutMs = Math.max(1, options.timeoutMs ?? 3500);
  for (let i = 0; i < 3; i++) {
    if (options.signal?.aborted) throw aborted();
    const controller = new AbortController(), began = now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled: ((reason: unknown) => void) | undefined;
    const cancel = () => { controller.abort(); rejectCancelled?.(aborted()); };
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const timedOut = new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Network probe timed out.')); }, timeoutMs); });
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const probe = (async () => {
        const response = await request(`/api/network-check?nocache=${Date.now()}-${i}`, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Probe unavailable.');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 2 || (data as { ok?: unknown }).ok !== true || (data as { kind?: unknown }).kind !== 'littleleaf-network-probe') throw new Error('Unexpected probe response.');
      })();
      await Promise.race([probe, timedOut, cancelled]);
      if (options.signal?.aborted) throw aborted();
      attempts.push({ durationMs: now() - began });
    } catch {
      if (options.signal?.aborted) throw aborted();
      attempts.push({ durationMs: null });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
      controller.abort();
    }
  }
  return classifyNetwork(attempts, options.onlineHint);
}

export function mediaPoor(sample?: LivePerformanceSample | null): boolean {
  if (!sample) return false;
  return [[sample.rttMs, 600], [sample.inboundJitterMs, 80], [sample.jitterBufferMs, 300], [sample.inboundPacketLossPct, 5], [sample.concealmentPct, 3]].some(([value, threshold]) => typeof value === 'number' && Number.isFinite(value) && value > threshold!);
}
