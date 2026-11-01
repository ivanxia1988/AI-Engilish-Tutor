import React from 'react';
import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import type {ModelCredentialStatus} from '../lib/model-credentials';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/admin'});
for(const key of ['window','self','document','HTMLElement','HTMLInputElement','Node','Event','MouseEvent','MutationObserver','getComputedStyle','navigator'])Object.defineProperty(globalThis,key,{value:(dom.window as unknown as Record<string,unknown>)[key],configurable:true});
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {ModelCredentialsEditor}=await import('../components/admin/model-credentials-editor');
afterEach(cleanup);after(()=>dom.window.close());
const modelId='20000000-0000-4000-8000-000000000001',secondId='20000000-0000-4000-8000-000000000002';
const state=(provider:'qwen'|'openai'='openai',extra:Partial<ModelCredentialStatus>={}):ModelCredentialStatus=>({provider,source:'environment',configured:true,revision:0,updatedAt:null,...extra});
const response=(credential:ModelCredentialStatus)=>Response.json({ok:true,credential});
async function click(element:HTMLElement){await act(async()=>{fireEvent.click(element);await new Promise(resolve=>setTimeout(resolve,0));});}

test('credential state is write-only and saving a replacement clears the input without changing model settings',async()=>{
 const calls:{url:string;body:unknown}[]=[];
 globalThis.fetch=async(input,init)=>{const url=String(input),body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,body});return response(state('openai',body?{source:'model',revision:1,updatedAt:'2026-11-01T00:00:00Z'}:{}));};
 render(<ModelCredentialsEditor modelId={modelId} provider="openai"/>);
 await waitFor(()=>assert(screen.getByText('使用环境默认密钥')));
 const input=screen.getByLabelText('API Key') as HTMLInputElement;assert.equal(input.type,'password');assert.equal(input.autocomplete,'off');assert.equal(input.value,'');
 fireEvent.change(input,{target:{value:'synthetic-replacement-key'}});await click(screen.getByRole('button',{name:'保存密钥'}));
 await waitFor(()=>assert(screen.getByText('密钥已保存，后续请求生效。')));assert.equal(input.value,'');assert(screen.getByText('已配置单模型密钥'));
 assert.deepEqual(calls.find(call=>call.body)?.body,{provider:'openai',expectedRevision:0,apiKey:'synthetic-replacement-key'});
 assert(calls.every(call=>call.url===`/api/v1/admin/models/${modelId}/credentials`));
});
test('Qwen credentials require a fresh key and workspace and send the selected region',async()=>{
 let sent:unknown;
 globalThis.fetch=async(_input,init)=>{if(init?.body)sent=JSON.parse(String(init.body));return response(state('qwen',init?.body?{source:'model',revision:1}:{}));};
 render(<ModelCredentialsEditor modelId={modelId} provider="qwen"/>);await waitFor(()=>assert(screen.getByText('使用环境默认密钥')));
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic-qwen-key'}});assert((screen.getByRole('button',{name:'保存密钥'}) as HTMLButtonElement).disabled);
 fireEvent.change(screen.getByLabelText('工作空间 ID'),{target:{value:'fixture-space'}});fireEvent.change(screen.getByLabelText('地域'),{target:{value:'ap-southeast-1'}});
 await click(screen.getByRole('button',{name:'保存密钥'}));await waitFor(()=>assert(sent));
 assert.deepEqual(sent,{provider:'qwen',expectedRevision:0,apiKey:'synthetic-qwen-key',workspaceId:'fixture-space',region:'ap-southeast-1'});
 assert.equal((screen.getByLabelText('API Key') as HTMLInputElement).value,'');assert.equal((screen.getByLabelText('工作空间 ID') as HTMLInputElement).value,'');
});
test('failed writes preserve replacement input but never display upstream body text',async()=>{
 let fails=true;
 globalThis.fetch=async(_input,init)=>init?.body&&fails?Response.json({ok:false,error:{code:'UNAVAILABLE',message:'PRIVATE_UPSTREAM_BODY'}},{status:503}):response(state('openai',init?.body?{source:'model',revision:1}:{}));
 render(<ModelCredentialsEditor modelId={modelId} provider="openai"/>);await waitFor(()=>assert(screen.getByText('使用环境默认密钥')));
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic-retry-key'}});await click(screen.getByRole('button',{name:'保存密钥'}));
 await waitFor(()=>assert(screen.getByRole('alert')));assert(!document.body.textContent?.includes('PRIVATE_UPSTREAM_BODY'));assert.equal((screen.getByLabelText('API Key') as HTMLInputElement).value,'synthetic-retry-key');
 fails=false;await click(screen.getByRole('button',{name:'保存密钥'}));await waitFor(()=>assert(screen.getByText('密钥已保存，后续请求生效。')));
});
test('a delayed credential read or write cannot populate another selected model',async()=>{
 let resolveRead:((value:Response)=>void)|undefined,resolveWrite:((value:Response)=>void)|undefined;
 globalThis.fetch=async(input,init)=>{
  if(init?.body)return new Promise<Response>(resolve=>{resolveWrite=resolve;});
  if(String(input).includes(modelId))return new Promise<Response>(resolve=>{resolveRead=resolve;});
  return response(state('openai',{source:'missing',configured:false}));
 };
 const view=render(<ModelCredentialsEditor modelId={modelId} provider="qwen"/>);assert(resolveRead);
 view.rerender(<ModelCredentialsEditor modelId={secondId} provider="openai"/>);await waitFor(()=>assert(screen.getByText('尚未配置密钥')));
 await act(async()=>{resolveRead!(response(state('qwen',{source:'model',revision:8})));});assert.equal(screen.queryByLabelText('工作空间 ID'),null);assert(screen.getByText('尚未配置密钥'));
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic-old-model-key'}});fireEvent.click(screen.getByRole('button',{name:'保存密钥'}));assert(resolveWrite);
 view.rerender(<ModelCredentialsEditor modelId={secondId} provider="qwen"/>);
 await act(async()=>{resolveWrite!(response(state('openai',{source:'model',revision:1})));});
 assert.equal((screen.getByLabelText('API Key') as HTMLInputElement).value,'');assert.equal(screen.queryByText('密钥已保存，后续请求生效。'),null);
});
test('reset requires confirmation, Escape cancels, and reset returns to environment defaults',async()=>{
 const calls:unknown[]=[];let refreshed=0;
 globalThis.fetch=async(input,init)=>{if(init?.body)calls.push(JSON.parse(String(init.body)));return response(state('openai',String(input).endsWith('/reset')?{revision:3}:{source:'model',revision:2}));};
 render(<ModelCredentialsEditor modelId={modelId} provider="openai" onSaved={()=>{refreshed++;}}/>);await waitFor(()=>assert(screen.getByText('已配置单模型密钥')));
 fireEvent.click(screen.getByRole('button',{name:'恢复环境默认'}));assert(screen.getByRole('dialog',{name:'恢复环境默认密钥？'}));assert.equal(calls.length,0);
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});assert.equal(screen.queryByRole('dialog'),null);
 fireEvent.click(screen.getByRole('button',{name:'恢复环境默认'}));await click(screen.getByRole('button',{name:'确认恢复'}));await waitFor(()=>assert(screen.getByText('已恢复环境默认配置。')));
 assert.deepEqual(calls,[{provider:'openai',expectedRevision:2}]);assert(screen.getByText('使用环境默认密钥'));assert.equal(refreshed,1);
});
test('a revision conflict requires a fresh status before retrying',async()=>{
 let revision=1;
 globalThis.fetch=async(_input,init)=>{if(init?.body){revision=2;return Response.json({ok:false,error:{code:'STALE',message:'PRIVATE_CONFLICT_DETAILS'}},{status:409});}return response(state('openai',{source:'model',revision}));};
 render(<ModelCredentialsEditor modelId={modelId} provider="openai"/>);await waitFor(()=>assert(screen.getByText('已配置单模型密钥')));
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic-conflict-key'}});await click(screen.getByRole('button',{name:'保存密钥'}));await waitFor(()=>assert(screen.getByRole('alert').textContent?.includes('配置已更新')));
 assert((screen.getByRole('button',{name:'保存密钥'}) as HTMLButtonElement).disabled);await click(screen.getByRole('button',{name:'重新读取密钥状态'}));await waitFor(()=>assert(!(screen.getByRole('button',{name:'保存密钥'}) as HTMLButtonElement).disabled));
});
test('unsaved model metadata disables credential writes and Enter never submits an enclosing model form',async()=>{
 globalThis.fetch=async()=>response(state());let submitted=0;
 const view=render(<form onSubmit={event=>{event.preventDefault();submitted++;}}><ModelCredentialsEditor modelId={modelId} provider="openai" disabled/></form>);
 await waitFor(()=>assert(screen.getByText('使用环境默认密钥')));assert(screen.getByLabelText('API Key').matches(':disabled'));
 view.rerender(<form onSubmit={event=>{event.preventDefault();submitted++;}}><ModelCredentialsEditor modelId={modelId} provider="openai"/></form>);
 fireEvent.keyDown(screen.getByLabelText('API Key'),{key:'Enter'});assert.equal(submitted,0);assert.equal(document.querySelectorAll('form').length,1);
});
test('unreadable or mismatched provider status fails closed and can be reloaded',async()=>{
 let mismatched=true;
 globalThis.fetch=async()=>response(state(mismatched?'qwen':'openai'));
 render(<ModelCredentialsEditor modelId={modelId} provider="openai"/>);await waitFor(()=>assert(screen.getByRole('alert').textContent?.includes('读取失败')));
 assert(screen.getByLabelText('API Key').matches(':disabled'));assert((screen.getByRole('button',{name:'保存密钥'}) as HTMLButtonElement).disabled);
 mismatched=false;await click(screen.getByRole('button',{name:'重新读取密钥状态'}));await waitFor(()=>assert(screen.getByText('使用环境默认密钥')));assert(!screen.getByLabelText('API Key').matches(':disabled'));
});
test('a failed reset stays in the confirmation with a safe retry message',async()=>{
 globalThis.fetch=async(_input,init)=>init?.body?Response.json({ok:false,error:{code:'UNAVAILABLE',message:'PRIVATE_RESET_BODY'}},{status:503}):response(state('openai',{source:'model',revision:1}));
 render(<ModelCredentialsEditor modelId={modelId} provider="openai"/>);await waitFor(()=>assert(screen.getByText('已配置单模型密钥')));
 fireEvent.click(screen.getByRole('button',{name:'恢复环境默认'}));await click(screen.getByRole('button',{name:'确认恢复'}));
 const dialog=screen.getByRole('dialog');assert(dialog.querySelector('[role=alert]'));assert(!dialog.textContent?.includes('PRIVATE_RESET_BODY'));assert(screen.getByText('已配置单模型密钥'));
});
test('a new unsaved model never reads or sends credentials',()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No request expected');};
 render(<ModelCredentialsEditor provider="qwen"/>);assert(screen.getByText('先保存模型，再配置密钥。'));assert.equal(calls,0);assert.equal(screen.queryByLabelText('API Key'),null);
});
