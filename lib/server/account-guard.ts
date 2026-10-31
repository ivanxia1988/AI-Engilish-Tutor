import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAccountService } from './account-runtime';
import { accountCookie } from './account-http';

export async function requireProductAccount(profileRequired = false) {
  const incoming = await headers();
  let user;
  try { user = await getAccountService().session(accountCookie(new Request('https://app.local', { headers: incoming }), 'teeko_session')); }
  catch { redirect('/login'); }
  if (!user) redirect('/login');
  if (profileRequired && !user.profileComplete) redirect('/onboarding');
  return user;
}
