export type ServerPerformance = { serverTotalMs: number; upstreamMs: number; model?: string };
type Operation = 'session' | 'agent' | 'teacher';
const milliseconds = (value: number) => Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 10) / 10;

/** All durations use one server clock. Upstream includes transport and body reading, not just inference. */
export class ServerTimer {
  private readonly startedAt: number;
  private upstreamMs = 0;
  constructor(private readonly operation: Operation, private readonly now = () => performance.now()) { this.startedAt = now(); }
  recordUpstream = (milliseconds: number) => { if (Number.isFinite(milliseconds) && milliseconds >= 0) this.upstreamMs += milliseconds; };
  async upstream<T>(work: () => Promise<T>): Promise<T> {
    const began = this.now();
    try { return await work(); } finally { this.recordUpstream(this.now() - began); }
  }
  snapshot(model?: string): ServerPerformance {
    return { serverTotalMs: milliseconds(this.now() - this.startedAt), upstreamMs: milliseconds(this.upstreamMs), ...(model ? { model } : {}) };
  }
  finish(status: number, model?: string) {
    const measured = this.snapshot(model);
    // Never log request contents, credentials, images or provider error bodies.
    console.info(JSON.stringify({ scope: 'littleleaf.performance', operation: this.operation, status, totalMs: measured.serverTotalMs, upstreamMs: measured.upstreamMs, ...(model ? { model } : {}) }));
    return { performance: measured, headers: { 'Server-Timing': `app;dur=${measured.serverTotalMs}, upstream;dur=${measured.upstreamMs}`, 'Cache-Control': 'no-store' } };
  }
  error(response: Response, model?: string) {
    const measured = this.finish(response.status, model);
    for (const [name, value] of Object.entries(measured.headers)) response.headers.set(name, value);
    return response;
  }
}
