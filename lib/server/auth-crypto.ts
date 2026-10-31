import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, COST, (error, result) => error ? reject(error) : resolve(result));
});

export function newToken(): string { return randomBytes(32).toString('base64url'); }
export function newOtp(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }
export function protectedDigest(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex');
}
export function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 64;
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('密码需为8–64个字符。');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 64) return false;
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match) return false;
  return timingSafeEqual(await derive(password, match[1]), Buffer.from(match[2], 'hex'));
}

export const DUMMY_PASSWORD_HASH = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`;
