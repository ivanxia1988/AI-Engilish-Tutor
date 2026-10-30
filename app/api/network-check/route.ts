/** Anonymous, bounded same-origin reachability probe. No provider API or credentials. */
export async function GET() {
  return Response.json({ ok: true, kind: 'littleleaf-network-probe' }, { headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } });
}
