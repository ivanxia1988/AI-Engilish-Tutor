import React from 'react';
import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DEFAULT_TEACHER_AGENT,DEFAULT_TEACHER_MODELS,type TeacherAgent,type TeacherModel} from '../lib/teacher-agent';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/admin'});
for(const key of ['window','self','document','HTMLElement','HTMLInputElement','Node','Event','MouseEvent','MutationObserver','getComputedStyle','navigator'])Object.defineProperty(globalThis,key,{value:(dom.window as unknown as Record<string,unknown>)[key],configurable:true});
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {AdminConsole}=await import('../components/admin/admin-console');
afterEach(cleanup);after(()=>dom.window.close());
const date='2026-11-01T00:00:00Z',agentId='30000000-0000-4000-8000-000000000001',releaseId='40000000-0000-4000-8000-000000000001';
function fixture(options:{failWrite?:boolean;unauthorized?:boolean;invalidBinding?:'provider'|'purpose'|'disabled'|'missing'}={}){
 const models:TeacherModel[]=DEFAULT_TEACHER_MODELS.map(item=>({...item.input,id:item.id,revision:1,createdAt:date,updatedAt:date}));
 if(options.invalidBinding){if(options.invalidBinding==='provider')models[0].provider='openai';if(options.invalidBinding==='purpose')models[0].purpose='reasoning';if(options.invalidBinding==='disabled')models[0].enabled=false;if(options.invalidBinding==='missing')models.shift();models.push({...DEFAULT_TEACHER_MODELS[0].input,id:'20000000-0000-4000-8000-000000000099',name:'替代实时模型',revision:1,createdAt:date,updatedAt:date});}
 let agent:TeacherAgent={...structuredClone(DEFAULT_TEACHER_AGENT),id:agentId,revision:1,createdAt:date,updatedAt:date};
 const release={id:releaseId,agentId,agentName:agent.name,version:1,publishedAt:date};
 const calls:{url:string;method:string;body:unknown}[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=String(input),method=init?.method??'GET',body=typeof init?.body==='string'?JSON.parse(init.body):undefined;calls.push({url,method,body});
  if(options.unauthorized)return Response.json({ok:false,error:{code:'FORBIDDEN',message:'此账号没有管理权限。'}},{status:403});
  if(options.failWrite&&method!=='GET')return Response.json({ok:false,error:{code:'UNAVAILABLE',message:'暂时无法保存，请重试。'}},{status:503});
  if(url.endsWith('/auth/logout'))return Response.json({ok:true});
  if(url.endsWith('/config'))return Response.json({ok:true,models,agents:[agent],releases:[release],activeRelease:release,providers:{qwen:true,openai:true}});
  if(url.includes('/overview'))return Response.json({ok:true,overview:{days:7,registeredUsers:12,profiledUsers:9,newUsers:4,activeUsers:5,classroomCount:8,endedCount:6,usageSeconds:1200,providerUsage:[{provider:'qwen',seconds:900,classrooms:6},{provider:'openai',seconds:300,classrooms:2}],endings:[{reason:'manual',count:3}]}});
  if(url.includes('/users?'))return Response.json({ok:true,users:[{id:agentId,email:'parent@example.test',name:'Mia',createdAt:date,profileComplete:true,classroomCount:2,usageSeconds:600,lastClassroomAt:date}],total:1,page:0,pageSize:20});
  if(url.endsWith('/preview'))return Response.json({ok:true,prompt:'固定基础规则 → 主提示词 → 分水平策略 → 用户偏好 → 本轮任务。'});
  if(url.endsWith('/tryout'))return Response.json({ok:true,result:{decision:'conversation',confidence:'high',reason:'孩子正在谈兴趣。',suggestedResponse:'Triceratops sounds interesting! What do you like about it?',nextAction:'follow_topic'}});
  if(url.endsWith('/publish')||url.endsWith('/activate'))return Response.json({ok:true,release:{...release,version:2}});
  if(url.endsWith(`/agents/${agentId}`)){const input=structuredClone(body);delete input.expectedRevision;agent={...input,id:agentId,revision:2,createdAt:date,updatedAt:date};return Response.json({ok:true,agent});}
  if(url.endsWith('/agents'))return Response.json({ok:true,agent:{...body,id:'30000000-0000-4000-8000-000000000002',revision:1,createdAt:date,updatedAt:date}});
  if(url.endsWith('/models'))return Response.json({ok:true,model:{...body,id:'20000000-0000-4000-8000-000000000099',revision:1,createdAt:date,updatedAt:date}});
  throw new Error('Unexpected fixture request');
 };
 return{calls};
}
async function clickAsync(element:HTMLElement){await act(async()=>{fireEvent.click(element);await new Promise(resolve=>setTimeout(resolve,0));});}
async function openAgents(){await waitFor(()=>assert(screen.getByRole('button',{name:'教师智能体'})));fireEvent.click(screen.getByRole('button',{name:'教师智能体'}));await waitFor(()=>assert(screen.getByLabelText('智能体名称')));}

test('admin shows real overview data and a material placeholder without an upload control',async()=>{
 fixture();render(<AdminConsole/>);
 await waitFor(()=>assert(screen.getByText('12')));assert(screen.getByText('累计注册用户'));
 fireEvent.click(screen.getByRole('button',{name:'教材管理'}));assert(screen.getByRole('heading',{name:'教材管理'}));assert.equal(document.querySelector('input[type=file]'),null);assert.equal(screen.queryByRole('button',{name:/上传/}),null);
});
test('model creation sends model settings only and a failed save preserves form values',async()=>{
 const f=fixture({failWrite:true});render(<AdminConsole/>);await waitFor(()=>assert(screen.getByText('累计注册用户')));
 fireEvent.click(screen.getByRole('button',{name:'模型配置'}));fireEvent.click(screen.getByRole('button',{name:'新增模型'}));
 fireEvent.change(screen.getByLabelText('配置名称'),{target:{value:'第二个通义模型'}});fireEvent.change(screen.getByLabelText('模型名称'),{target:{value:'qwen-plus'}});
 await clickAsync(screen.getByRole('button',{name:'保存模型'}));await waitFor(()=>assert(screen.getByRole('alert').textContent?.includes('暂时无法保存')));
 assert.equal((screen.getByLabelText('配置名称') as HTMLInputElement).value,'第二个通义模型');
 const call=f.calls.find(item=>item.url.endsWith('/models')&&item.method==='POST');assert(call);assert(!JSON.stringify(call.body).match(/apiKey|endpoint|secret/i));
});
test('agent publishing requires a saved draft and an explicit confirmation',async()=>{
 const f=fixture();render(<AdminConsole/>);await openAgents();
 fireEvent.change(screen.getByLabelText('智能体名称'),{target:{value:'温柔的 Teeko'}});
 assert((screen.getByRole('button',{name:'发布上线'}) as HTMLButtonElement).disabled);
 await clickAsync(screen.getByRole('button',{name:'保存草稿'}));await waitFor(()=>assert(!(screen.getByRole('button',{name:'发布上线'}) as HTMLButtonElement).disabled));
 fireEvent.click(screen.getByRole('button',{name:'发布上线'}));assert(screen.getByRole('dialog',{name:'发布智能体'}));assert.equal(f.calls.filter(item=>item.url.endsWith('/publish')).length,0);
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});assert.equal(screen.queryByRole('dialog'),null);
 fireEvent.click(screen.getByRole('button',{name:'发布上线'}));await clickAsync(screen.getByRole('button',{name:'确认发布'}));await waitFor(()=>assert.equal(f.calls.filter(item=>item.url.endsWith('/publish')).length,1));
 const saved=f.calls.find(item=>item.method==='PATCH'&&item.url.endsWith(`/agents/${agentId}`));assert.equal((saved?.body as {expectedRevision:number}).expectedRevision,1);
});
test('agent copy creates a distinct draft and never overwrites the original revision',async()=>{
 const f=fixture();render(<AdminConsole/>);await openAgents();fireEvent.click(screen.getByRole('button',{name:'复制智能体'}));
 assert((screen.getByLabelText('智能体名称') as HTMLInputElement).value.includes('副本'));
 await clickAsync(screen.getByRole('button',{name:'保存草稿'}));await waitFor(()=>assert(f.calls.some(item=>item.method==='POST'&&item.url.endsWith('/agents'))));
 assert.equal(f.calls.filter(item=>item.method==='PATCH').length,0);
});
test('prompt preview and actual text tryout use explicit synthetic context and render the result',async()=>{
 const f=fixture();render(<AdminConsole/>);await openAgents();fireEvent.click(screen.getByRole('tab',{name:'预览与试教'}));
 await clickAsync(screen.getByRole('button',{name:'生成提示词预览'}));await waitFor(()=>assert((screen.getByLabelText('最终提示词') as HTMLTextAreaElement).value.includes('固定基础规则')));
 fireEvent.change(screen.getByLabelText('模拟孩子的回答'),{target:{value:'I like dinosaurs.'}});await clickAsync(screen.getByRole('button',{name:'开始文字试教'}));
 await waitFor(()=>assert(screen.getByText('孩子正在谈兴趣。')));assert(screen.getByText(/Triceratops sounds interesting/));
 const body=f.calls.find(item=>item.url.endsWith('/tryout'))?.body as {profile:{level:string};text:string;taskId:string};assert.equal(body.text,'I like dinosaurs.');assert.equal(body.profile.level,'starter');assert(body.taskId);
});
test('historical activation asks for confirmation and user usage remains separate from classroom counts',async()=>{
 const f=fixture();render(<AdminConsole/>);await openAgents();fireEvent.click(screen.getByRole('button',{name:'历史版本'}));fireEvent.click(screen.getByRole('button',{name:'使用此版本'}));
 assert(screen.getByRole('dialog',{name:'切换线上版本'}));assert.equal(f.calls.filter(item=>item.url.endsWith('/activate')).length,0);await clickAsync(screen.getByRole('button',{name:'确认切换'}));await waitFor(()=>assert.equal(f.calls.filter(item=>item.url.endsWith('/activate')).length,1));
 fireEvent.click(screen.getByRole('button',{name:'用户与使用'}));await waitFor(()=>assert(screen.getByText('parent@example.test')));assert(screen.getByText('10 分钟'));
});
test('a denied admin response never exposes editable configuration or fake success',async()=>{
 fixture({unauthorized:true});render(<AdminConsole/>);await waitFor(()=>assert(screen.getByRole('alert').textContent?.includes('没有管理权限')));
 assert.equal(screen.queryByRole('button',{name:'保存草稿'}),null);assert.equal(screen.queryByText('12'),null);assert.equal(screen.getByRole('link',{name:'返回登录'}).getAttribute('href'),'/admin/login');
});

test('admin logout uses its separate session and returns to admin login',async()=>{
 const f=fixture(),destinations:string[]=[];render(<AdminConsole navigate={path=>destinations.push(path)}/>);
 await waitFor(()=>assert(screen.getByText('累计注册用户')));await clickAsync(screen.getByRole('button',{name:'退出后台'}));
 await waitFor(()=>assert.deepEqual(destinations,['/admin/login']));
 assert(f.calls.some(item=>item.url==='/api/v1/admin/auth/logout'&&item.method==='POST'));
 assert(!f.calls.some(item=>item.url==='/api/v1/auth/logout'));
});
test('leaving an edited draft asks once and clears the browser warning after discard',async()=>{
 fixture();const destinations:string[]=[];render(<AdminConsole navigate={path=>{const event=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,false);destinations.push(path);}}/>);
 await openAgents();fireEvent.change(screen.getByLabelText('智能体名称'),{target:{value:'未保存的名字'}});
 fireEvent.click(screen.getByRole('button',{name:'模型配置'}));assert(screen.getByRole('dialog',{name:'放弃未保存的更改？'}));fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 assert.equal((screen.getByLabelText('智能体名称') as HTMLInputElement).value,'未保存的名字');
 fireEvent.click(screen.getAllByRole('link',{name:'回到我的课程'})[0]);assert(screen.getByRole('dialog',{name:'放弃未保存的更改？'}));
 await clickAsync(screen.getByRole('button',{name:'放弃更改'}));assert.deepEqual(destinations,['/courses']);
});
test('a delayed tryout cannot display the previous answer after input changes',async()=>{
 fixture();const original=globalThis.fetch;let resolve:((response:Response)=>void)|undefined;
 globalThis.fetch=async(input,init)=>String(input).endsWith('/tryout')?new Promise<Response>(done=>{resolve=done;}):original(input,init);
 render(<AdminConsole/>);await openAgents();fireEvent.click(screen.getByRole('tab',{name:'预览与试教'}));
 fireEvent.click(screen.getByRole('button',{name:'开始文字试教'}));assert(resolve);
 fireEvent.change(screen.getByLabelText('模拟孩子的回答'),{target:{value:'I want to talk about football.'}});
 await act(async()=>{resolve!(Response.json({ok:true,result:{decision:'conversation',confidence:'high',reason:'OLD_RESULT',suggestedResponse:'Old dinosaur reply.',nextAction:'follow_topic'}}));await new Promise(done=>setTimeout(done,0));});
 assert.equal(screen.queryByText('OLD_RESULT'),null);assert.equal(screen.queryByText('Old dinosaur reply.'),null);
});

for(const invalidBinding of ['provider','purpose','disabled','missing'] as const)test(`an invalid ${invalidBinding} binding stays visible and requires an explicit replacement before publish`,async()=>{
 const f=fixture({invalidBinding});render(<AdminConsole/>);await openAgents();fireEvent.click(screen.getByRole('tab',{name:'模型与声音'}));
 const select=screen.getByLabelText('通义实时对话模型');assert(select instanceof dom.window.HTMLSelectElement);
 assert.equal(select.value,DEFAULT_TEACHER_AGENT.routes.qwen.realtimeModelId);assert(select.selectedOptions[0].disabled);assert.match(select.selectedOptions[0].textContent??'',/当前绑定已失效/);
 assert((screen.getByRole('button',{name:'发布上线'}) as HTMLButtonElement).disabled);assert(screen.getByText('存在失效的模型绑定，请在“模型与声音”中重新选择后保存。'));
 fireEvent.change(select,{target:{value:'20000000-0000-4000-8000-000000000099'}});await clickAsync(screen.getByRole('button',{name:'保存草稿'}));
 await waitFor(()=>assert(!(screen.getByRole('button',{name:'发布上线'}) as HTMLButtonElement).disabled));
 const saved=f.calls.find(item=>item.method==='PATCH'&&item.url.endsWith(`/agents/${agentId}`));assert.equal((saved?.body as {routes:TeacherAgent['routes']}).routes.qwen.realtimeModelId,'20000000-0000-4000-8000-000000000099');
});
