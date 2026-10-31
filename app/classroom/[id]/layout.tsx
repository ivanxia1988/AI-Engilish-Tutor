import type { ReactNode } from 'react';
import { requireProductAccount } from '../../../lib/server/account-guard';
export const dynamic='force-dynamic';
export const metadata={title:'课堂 · Teeko'};
export default async function ClassroomLayout({children}:{children:ReactNode}){
 await requireProductAccount(true);
 return children;
}
