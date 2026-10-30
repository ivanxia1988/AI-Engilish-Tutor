/** Stateless authorization for closing only the session minted for the current identity. */
function encode(bytes: Uint8Array) { return btoa(Array.from(bytes, v => String.fromCharCode(v)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function decode(value: string) { return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0)); }
async function signingKey(secret: string) { return crypto.subtle.importKey("raw", new TextEncoder().encode("littleleaf-live-close:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]); }
export async function makeLiveTicket(secret: string, sessionId: string, userId: string, now = Date.now()) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ sessionId, userId, expires: now + 15 * 60_000 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(payload)));
  return `${payload}.${encode(signature)}`;
}
export async function verifyLiveTicket(secret: string, ticket: string, sessionId: string, userId: string, now = Date.now()) {
  try {
    if (ticket.length > 1500) return false;
    const parts = ticket.split("."); if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), decode(signature), new TextEncoder().encode(payload));
    if (!valid) return false;
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    return value.sessionId === sessionId && value.userId === userId && typeof value.expires === "number" && value.expires > now;
  } catch { return false; }
}
