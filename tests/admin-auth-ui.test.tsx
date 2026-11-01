import React from 'react';
import test,{after,afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/admin/login'});
for(const key of ['window','self','document','HTMLElement','HTMLInputElement','Node','Event','MouseEvent','MutationObserver','getComputedStyle','navigator'])Object.defineProperty(globalThis,key,{value:(dom.window as unknown as Record<string,unknown>)[key],configurable:true});
const {render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
const {AdminLogin}=await import('../components/admin/admin-login');
const calls:{path:string;body?:unknown}[]=[];let response:Response;
beforeEach(()=>{calls.length=0;response=Response.json({ok:true,next:'/admin'});globalThis.fetch=async(input,init)=>{const path=String(input);calls.push({path,body:typeof init?.body==='string'?JSON.parse(init.body):undefined});if(path.endsWith('/state'))return Response.json({ok:true,user:null});return response;};});
afterEach(cleanup);after(()=>dom.window.close());
test('admin login uses username and its separate authentication route, with no review or student registration',async()=>{
 const destinations:string[]=[];render(<AdminLogin navigate={path=>destinations.push(path)}/>);
 await waitFor(()=>assert(!(screen.getByRole('button',{name:'登录后台'}) as HTMLButtonElement).disabled));
 assert.equal((screen.getByLabelText('用户名') as HTMLInputElement).value,'admin');assert(!screen.queryByLabelText('邮箱'));assert(!screen.queryByText(/注册|模拟|邀请码/));
 fireEvent.change(screen.getByLabelText('密码',{exact:true}),{target:{value:'fixture-login-password'}});fireEvent.click(screen.getByRole('button',{name:'登录后台'}));
 await waitFor(()=>assert.deepEqual(destinations,['/admin']));assert.deepEqual(calls.find(call=>call.path.endsWith('/login')),{path:'/api/v1/admin/auth/login',body:{username:'admin',password:'fixture-login-password'}});assert.equal(dom.window.localStorage.length,0);
});
test('a rejected admin login stays in place and cannot navigate to an unapproved destination',async()=>{
 response=Response.json({ok:false,error:{code:'LOGIN_INVALID',message:'用户名或密码不正确。'}},{status:401});
 const destinations:string[]=[];render(<AdminLogin navigate={path=>destinations.push(path)}/>);await waitFor(()=>assert(!(screen.getByRole('button',{name:'登录后台'}) as HTMLButtonElement).disabled));
 fireEvent.change(screen.getByLabelText('密码',{exact:true}),{target:{value:'fixture-wrong-password'}});fireEvent.click(screen.getByRole('button',{name:'登录后台'}));
 await waitFor(()=>assert.equal(screen.getByRole('alert').textContent,'用户名或密码不正确。'));assert.deepEqual(destinations,[]);
 response=Response.json({ok:true,next:'https://outside.test'});fireEvent.click(screen.getByRole('button',{name:'登录后台'}));await waitFor(()=>assert(screen.getByRole('alert').textContent?.includes('响应异常')));assert.deepEqual(destinations,[]);
});
test('existing administrator state enters only the management page',async()=>{
 const destinations:string[]=[];globalThis.fetch=async()=>Response.json({ok:true,user:{id:'synthetic-operator',username:'admin'}});
 render(<AdminLogin navigate={path=>destinations.push(path)}/>);await waitFor(()=>assert.deepEqual(destinations,['/admin']));
});
