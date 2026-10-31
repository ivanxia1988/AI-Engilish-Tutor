import type { ReactNode } from 'react';
import { requireProductAccount } from '../../lib/server/account-guard';
export const dynamic = 'force-dynamic';
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireProductAccount();
  return children;
}
