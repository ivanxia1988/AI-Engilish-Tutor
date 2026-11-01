import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {adminSessionCookie} from './admin-auth-http';
import {getAdminAuthService} from './admin-auth-runtime';
import {adminOrigin} from './admin-origin';
export async function requireAdminHost(){const incoming=await headers(),origin=adminOrigin();if(incoming.get('host')!==new URL(origin).host)redirect(`${origin}/admin`);}
export async function requireAdminAccount(){
 await requireAdminHost();
 const incoming=await headers();let user;
 try{user=await getAdminAuthService().session(adminSessionCookie(new Request('https://admin.local',{headers:incoming})));}catch{}
 if(!user)redirect('/admin/login');return user;
}
