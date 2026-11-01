import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminAuthHandler,adminSessionCookie} from '../lib/server/admin-auth-http';
const origin='https://admin.teeko.app',token='a'.repeat(43);
test('dedicated login emits only its host-only strict cookie and does not touch the student session',async()=>{
 let loggedOut:string|undefined;
 const auth={login:async()=>({sessionToken:token,user:{id:'operator',username:'admin'}}),session:async(value?:string)=>value===token?{id:'operator',username:'admin'}:null,logout:async(value?:string)=>{loggedOut=value;}};
 const handler=createAdminAuthHandler({origin,auth});
 const response=await handler(new Request(`${origin}/api/v1/admin/auth/login`,{method:'POST',headers:{Origin:origin,'content-type':'application/json',cookie:`teeko_session=${'s'.repeat(43)}`},body:JSON.stringify({username:'admin',password:'fixture-password'})}));
 assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!;assert(cookie.startsWith('teeko_admin_session='));assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Strict'));assert(cookie.includes('Secure'));assert(cookie.includes('Max-Age=28800'));assert(!/Domain=|teeko_session=/.test(cookie));assert.deepEqual(await response.json(),{ok:true,next:'/admin'});
 const state=await handler(new Request(`${origin}/api/v1/admin/auth/state`,{headers:{cookie:`teeko_session=${'s'.repeat(43)}`}}));assert.deepEqual(await state.json(),{ok:true,user:null});
 const logout=await handler(new Request(`${origin}/api/v1/admin/auth/logout`,{method:'POST',headers:{Origin:origin,'content-type':'application/json',cookie:`teeko_session=${'s'.repeat(43)}; teeko_admin_session=${token}`},body:'{}'}));assert.equal(loggedOut,token);assert(logout.headers.get('set-cookie')?.includes('teeko_admin_session=;'));assert(!logout.headers.get('set-cookie')?.includes('teeko_session='));
});
test('admin authentication rejects wrong origins, oversized bodies, duplicate cookies and public provisioning',async()=>{
 let calls=0;const handler=createAdminAuthHandler({origin,auth:{login:async()=>{calls++;return{sessionToken:token,user:{id:'operator',username:'admin'}};},session:async()=>null,logout:async()=>{}}});
 const post=(path:string,body:unknown,site=origin)=>handler(new Request(`${origin}/api/v1/admin/auth${path}`,{method:'POST',headers:{Origin:site,'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await post('/login',{username:'admin',password:'fixture-password'},'https://teeko.app')).status,403);assert.equal(calls,0);
 assert.equal((await post('/provision',{username:'admin',password:'fixture-password'})).status,404);
 assert.equal((await post('/login',{username:'admin',password:'x'.repeat(9000)})).status,413);
 assert.equal((await post('/login',{username:'admin',password:'fixture-password',role:'admin'})).status,400);
 assert.equal(adminSessionCookie(new Request(origin,{headers:{cookie:`teeko_admin_session=${token}; teeko_admin_session=${token}`}})),undefined);
});

test('admin authentication checks the external Host when Next uses an internal request URL', async () => {
 const handler=createAdminAuthHandler({origin,auth:{login:async()=>({sessionToken:token,user:{id:'operator',username:'admin'}}),session:async()=>null,logout:async()=>{}}});
 const post=(url:string,host:string)=>handler(new Request(url,{method:'POST',headers:{host,origin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-password'})}));
 assert.equal((await post('http://0.0.0.0:8080/api/v1/admin/auth/login','admin.teeko.app')).status,200);
 assert.equal((await post(`${origin}/api/v1/admin/auth/login`,'teeko.app')).status,403);
});
