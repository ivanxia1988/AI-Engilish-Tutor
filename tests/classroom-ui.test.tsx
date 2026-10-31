import React from "react";
import test, { beforeEach, afterEach } from "node:test";
import nodeAssert from "node:assert/strict";
// An explicit message avoids Node 24 parsing tsx-generated source during transient waitFor failures.
const assert: typeof nodeAssert = Object.assign((value: unknown, message?: string | Error): asserts value => nodeAssert.ok(value, message ?? "Expected a truthy value."), nodeAssert);
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:5173" });
for (const key of ["window","document","HTMLElement","HTMLDialogElement","HTMLInputElement","HTMLSelectElement","Node","Event","MouseEvent","MutationObserver","getComputedStyle","navigator"]) Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
Object.defineProperty(globalThis,"IDBKeyRange",{ value:IDBKeyRange, configurable:true });
dom.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open",""); };
dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
Object.defineProperty(dom.window, "speechSynthesis", { value: { cancel() {}, getVoices() { return []; }, speak() {} } });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { value: class { constructor(public text: string) {} }, configurable:true });
Object.defineProperty(globalThis, "Image", { value: dom.window.Image, configurable:true });
dom.window.HTMLImageElement.prototype.decode = async function() { Object.defineProperty(this,"naturalWidth",{value:400,configurable:true}); Object.defineProperty(this,"naturalHeight",{value:300,configurable:true}); };
dom.window.HTMLCanvasElement.prototype.getContext = function() { return { drawImage(){}, fillRect(){}, beginPath(){}, ellipse(){}, arc(){}, moveTo(){}, lineTo(){}, stroke(){} }; } as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
dom.window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,YWJj";
class PointerEventStub extends dom.window.MouseEvent { pointerId:number; constructor(type:string, options:MouseEventInit & {pointerId?:number}={}) { super(type,options); this.pointerId=options.pointerId??1; } }
Object.defineProperty(dom.window,"PointerEvent",{value:PointerEventStub});
Object.defineProperty(dom.window.SVGElement.prototype,"setPointerCapture",{value:()=>{}});
Object.defineProperty(dom.window.SVGElement.prototype,"releasePointerCapture",{value:()=>{}});
Object.defineProperty(dom.window.SVGElement.prototype,"hasPointerCapture",{value:()=>true});
const { render, screen, fireEvent, waitFor, cleanup, within } = await import("@testing-library/react");
const { default: Classroom } = await import("../components/legacy-classroom.tsx");
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable:true });
  globalThis.fetch = async input => String(input).includes("/api/network-check") ? Response.json({ok:true,kind:"littleleaf-network-probe"}) : Response.json({configured:false,mode:"demo"});
});
afterEach(() => cleanup());
async function start() { render(<Classroom />); await waitFor(() => assert(!screen.queryByText("正在打开小课堂…"))); fireEvent.click(screen.getByRole("button",{name:"我准备好了"})); }
async function choose(name: string) { const detail = screen.getByText("也可以用按钮选择教材对象"); fireEvent.click(detail); fireEvent.click(screen.getByRole("button",{name})); }
test("wrong object cannot unlock next; correct object and spoken-text answer advance", async () => {
  await start();
  await choose("banana"); assert(screen.getByRole("button",{name:"先在教材里找一找"}).hasAttribute("disabled"));
  await choose("apple"); assert(!screen.getByRole("button",{name:"继续探索"}).hasAttribute("disabled"));
  fireEvent.click(screen.getByRole("button",{name:"继续探索"}));
  fireEvent.change(screen.getByLabelText("文字回答或向老师提问"),{target:{value:"apple"}});
  fireEvent.click(screen.getByRole("button",{name:"发送回答"}));
  await waitFor(() => assert(screen.getByText("That answer fits. Try using it in your own sentence.")));
});
test("Chinese interruption gives help and keeps the current task", async () => {
  await start(); fireEvent.click(screen.getByRole("button",{name:/老师，我没听懂/}));
  assert(screen.getByText("你能把苹果圈出来吗？"));
  assert(screen.getByRole("button",{name:"先在教材里找一找"}).hasAttribute("disabled"));
  assert(screen.getByText("第 2 / 8 步"));
});
test("pause blocks answers and can resume the same task", async () => {
  await start(); fireEvent.click(screen.getByRole("button",{name:"休息一下"}));
  assert(screen.getByText("休息一下，课堂已暂停"));
  fireEvent.click(screen.getByRole("button",{name:"继续学习"}));
  assert(!screen.queryByText("休息一下，课堂已暂停")); assert(screen.getByText("第 2 / 8 步"));
});
test("progress and hint usage survive unmount and reload", async () => {
  await start(); fireEvent.click(screen.getByRole("button",{name:/老师，我没听懂/})); await choose("apple");
  await waitFor(async () => { const { storage } = await import("../lib/storage.ts"); const saved=await storage.progress(); assert(saved[0]?.answers.some(a=>a.correct)); assert(saved[0]?.assistedStepIds?.length); });
  cleanup(); render(<Classroom />); await waitFor(() => assert(!screen.queryByText("正在打开小课堂…")));
  assert(screen.getByText("第 2 / 8 步")); assert(screen.getByRole("button",{name:"继续探索"}));
});
test("completes a full lesson and shows actual practice counts", async () => {
  await start();
  for (const word of ["apple","banana","strawberry"]) {
    await choose(word); fireEvent.click(screen.getByRole("button",{name:"继续探索"}));
    fireEvent.change(screen.getByLabelText("文字回答或向老师提问"),{target:{value:word}}); fireEvent.click(screen.getByRole("button",{name:"发送回答"}));
    fireEvent.click(screen.getByRole("button",{name:"继续探索"}));
  }
  fireEvent.change(screen.getByLabelText("文字回答或向老师提问"),{target:{value:"I like apples."}}); fireEvent.click(screen.getByRole("button",{name:"发送回答"}));
  fireEvent.click(screen.getByRole("button",{name:"完成这节课"}));
  assert(screen.getByText("今天的你，又长大了一点！")); assert.equal(screen.getAllByText("7",{exact:true}).length,2);
  fireEvent.click(screen.getByRole("button",{name:"探索下一课"})); assert(screen.getByText("Hello, little friends! Let's look at this page together."));
});
test("library upload and parent controls open usable dialogs", async () => {
  render(<Classroom />); await waitFor(() => assert(!screen.queryByText("正在打开小课堂…")));
  fireEvent.click(screen.getByRole("button",{name:"教材书架"})); assert(screen.getByRole("heading",{name:"Little Explorers · 小小探索家"}));
  fireEvent.click(screen.getByRole("button",{name:"上传教材"})); assert(screen.getByRole("dialog"));
  fireEvent.click(screen.getByRole("button",{name:"关闭弹窗"}));
  fireEvent.click(screen.getByRole("button",{name:"家长设置"}));
  const dialog=screen.getByRole("dialog"); fireEvent.change(within(dialog).getByLabelText("孩子的课堂昵称"),{target:{value:"小豆"}});
  fireEvent.click(screen.getByRole("button",{name:"完成设置"})); fireEvent.click(screen.getByRole("button",{name:"我的课堂"}));
  assert(screen.getByText(/你好，小豆！/));
});
test("uploaded image can be manually marked, saved and used in a real lesson", async()=>{
  const app=render(<Classroom />); await waitFor(()=>assert(!screen.queryByText("正在打开小课堂…")));
  fireEvent.click(screen.getByRole("button",{name:"上传我的教材"}));
  fireEvent.change(screen.getByLabelText("选择教材文件"),{target:{files:[new File([new Uint8Array([1,2,3])],"my-fruits.png",{type:"image/png"})]}});
  await waitFor(()=>assert(screen.getByRole("button",{name:"手动标注备课"})));
  fireEvent.click(screen.getByRole("button",{name:"手动标注备课"}));
  const svg=app.container.ownerDocument.querySelector("dialog .drawing-layer")!;
  svg.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,width:400,height:300,right:400,bottom:300,toJSON(){return{};}});
  fireEvent.pointerDown(svg,{pointerId:1,clientX:80,clientY:90,button:0});
  fireEvent.pointerMove(svg,{pointerId:1,clientX:200,clientY:180});
  fireEvent.pointerUp(svg,{pointerId:1,clientX:200,clientY:180});
  assert(screen.getByText("区域已选好，填写下面的名称"));
  fireEvent.change(screen.getByLabelText("英文单词或短语"),{target:{value:"apple"}});
  fireEvent.change(screen.getByLabelText("中文含义"),{target:{value:"苹果"}});
  fireEvent.click(screen.getByRole("button",{name:"添加对象"}));
  fireEvent.click(screen.getByRole("button",{name:"生成练习"}));
  fireEvent.click(screen.getByRole("button",{name:"保存并开始学习"}));
  await waitFor(()=>assert(!screen.queryByRole("dialog")));
  assert(screen.getByText("我的教材 · 手动备课"));
  fireEvent.click(screen.getByRole("button",{name:"我准备好了"}));
  await choose("apple"); assert(screen.getByRole("button",{name:"继续探索"}));
  const {storage}=await import("../lib/storage.ts"); const saved=await storage.books();
  assert.equal(saved.length,1); assert.equal(saved[0].pages[0].objects[0].label,"apple");
  assert.equal(saved[0].lessons[0].steps.length,3);
});
test("late AI responses cannot overwrite a different lesson",async()=>{
  const {storage}=await import("../lib/storage.ts"), {defaultSettings}=await import("../lib/types.ts");
  await storage.saveSettings({...defaultSettings,consent:true,voice:false});
  let finish:((value:Response)=>void)|undefined;
  globalThis.fetch=async input=>String(input).includes("/api/network-check")?Response.json({ok:true,kind:"littleleaf-network-probe"}):String(input).includes("/api/status")?Response.json({configured:true,signedIn:true}):new Promise<Response>(resolve=>{finish=resolve;});
  await start(); fireEvent.click(screen.getByRole("button",{name:/老师，我没听懂/}));
  await waitFor(()=>assert(finish));
  fireEvent.click(screen.getByRole("button",{name:/花园里的朋友/}));
  finish!(Response.json({english:"STALE RESPONSE",chinese:"旧回答",highlightIds:[],assessment:"none"}));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert(!screen.queryByText("STALE RESPONSE")); assert(screen.getByText("Hello, little friends! Let's look at this page together."));
});

test("live voice tools honor the current task and transcripts alone cannot pass an exercise",async()=>{
  const {storage}=await import("../lib/storage.ts"),{defaultSettings}=await import("../lib/types.ts"),{createDemoBook}=await import("../lib/demo.ts");
  await storage.saveSettings({...defaultSettings,consent:true,voice:false});
  const demo=createDemoBook();let createdBody:Record<string,unknown>|undefined,stops=0;
  let agentAction={type:"none",objectIds:[] as string[],text:""},agentKey:string|undefined;
  class VoiceChannel {
    readyState="open";onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;sent:Record<string,unknown>[]=[];
    send(raw:string){const e=JSON.parse(raw);this.sent.push(e);if(e.type==="session.close")this.receive({type:"session.closed",usage:{seconds:15}});}
    receive(event:object){this.onmessage?.({data:JSON.stringify(event)});}
    close(){this.readyState="closed";}
  }
  class VoicePeer {
    static latest:VoicePeer;channel=new VoiceChannel();iceGatheringState="complete";connectionState="new";localDescription:{sdp:string}|null=null;
    constructor(){VoicePeer.latest=this;}createDataChannel(){return this.channel;}addTrack(){}addTransceiver(){}addEventListener(){}removeEventListener(){}
    async createOffer(){return{type:"offer",sdp:"v=0\r\nm=audio 9 x\r\nm=application 9 x\r\n"};}
    async setLocalDescription(value:{sdp:string}){this.localDescription=value;}
    async setRemoteDescription(){this.connectionState="connected";this.channel.receive({type:"session.started",event_id:"started-ui"});}
    close(){this.connectionState="closed";}
  }
  Object.defineProperty(globalThis,"RTCPeerConnection",{value:VoicePeer,configurable:true});
  Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){stops++;}}],getAudioTracks:()=>[{enabled:true,stop(){stops++;}}]})},configurable:true});
  dom.window.HTMLMediaElement.prototype.pause=()=>{};dom.window.HTMLMediaElement.prototype.play=async()=>{};
  globalThis.fetch=async(path,init)=>{
    if(String(path).includes('/api/network-check'))return Response.json({ok:true,kind:'littleleaf-network-probe'});
    if(String(path).includes('/api/status'))return Response.json({configured:true,keyConfigured:true,liveReady:true,signedIn:true});
    if(String(path).includes('/api/live/session')){createdBody=JSON.parse(init?.body as string);return Response.json({sessionId:'synthetic_ui',sdp:'v=0',closeToken:'synthetic'});}
    if(String(path).includes('/api/live/agent')){const body=JSON.parse(init?.body as string);return Response.json({contextKey:agentKey||body.context.contextKey,decision:'reply',english:'Let us try.',chinese:'试试看。',action:agentAction});}
    return Response.json({closed:true});
  };
  await start();fireEvent.click(screen.getByRole('button',{name:'开始实时课堂'}));
  await waitFor(()=>assert(screen.getByText('实时课堂进行中')));
  const channel=VoicePeer.latest.channel,oldKey=(createdBody!.context as {contextKey:string}).contextKey;
  function delegate(id:string,type:string,objectIds:string[]=[],text=''){agentAction={type,objectIds,text};channel.receive({type:'session.delegation.created',event_id:id,delegation:{id,target:'client'}});}
  delegate('hint1','highlight',['0-apple']);
  await waitFor(()=>assert(document.querySelector('ellipse.teacher-highlight[data-object-id="0-apple"]')));
  channel.receive({type:'session.input_transcript.delta',delta:'Can you circle the banana?',start_ms:100,end_ms:2000});
  await waitFor(()=>assert(document.querySelector('ellipse.teacher-circle[data-object-id="0-banana"]')), {timeout:2000});
  fireEvent.click(screen.getByRole('button',{name:'清除本题标注'}));
  await waitFor(()=>assert(channel.sent.some(e=>e.type==='session.thinking.append'&&String(e.content).includes('latest learner operation: clear'))));
  assert(!document.querySelector('.teacher-highlight'));
  await choose('apple');
  assert(channel.sent.some(e=>e.type==='session.commentary.append'&&String(e.content).includes('You selected apple')));
  fireEvent.click(screen.getByRole('button',{name:'继续探索'}));
  assert(screen.getByText('实时课堂进行中'));
  channel.receive({type:'session.input_transcript.delta',delta:'apple',event_id:'partial1'});
  assert(screen.getByRole('button',{name:'先来试着说一说'}).hasAttribute('disabled'));
  agentKey=oldKey;delegate('stale1','highlight',['0-banana']);
  await waitFor(()=>assert(channel.sent.some(e=>e.type==='session.thinking.append'&&JSON.stringify(e).includes('obsolete'))));
  const newKey=`${demo.id}:${demo.lessons[0].id}:${demo.lessons[0].steps[2].id}`;
  agentKey=newKey;delegate('answer1','answer',[],'apple');
  await waitFor(()=>assert(screen.getByRole('button',{name:'继续探索'})));
  fireEvent.click(screen.getByRole('button',{name:'请老师带回课堂'}));
  assert(channel.sent.some(e=>e.type==='session.instructions.append'&&String(e.content).includes('take the floor NOW')));
  assert(!channel.sent.some(e=>String(e.type).startsWith('response.')));
  fireEvent.click(screen.getByRole('button',{name:'结束实时课堂'}));
  await waitFor(()=>assert(screen.getByRole('button',{name:'重新开始实时课堂'})));
  assert(stops>0);
});

test('opening a textbook enters the immersive classroom and exiting returns to the library',async()=>{
 render(<Classroom />);await waitFor(()=>assert(!screen.queryByText('正在打开小课堂…')));
 fireEvent.click(screen.getByRole('button',{name:'教材书架'}));
 fireEvent.click(screen.getAllByRole('button',{name:'打开课堂'})[0]);
 assert(document.querySelector('.immersive-classroom'));
 assert(screen.getByRole('img',{name:'小叶老师的互动头像，播放语音时嘴巴开合、头部轻轻活动'}));
 fireEvent.click(screen.getByRole('button',{name:'返回教材'}));
 assert(!document.querySelector('.immersive-classroom'));
 assert(screen.getByRole('heading',{name:'Little Explorers · 小小探索家'}));
});
test('teacher avatar mouth follows audio energy and closes during silence',async()=>{
 const {TeacherAvatar}=await import('../components/teacher-avatar.tsx');
 const oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 let frame:FrameRequestCallback|undefined;
 globalThis.requestAnimationFrame=(cb:FrameRequestCallback)=>{frame=cb;return 1;};globalThis.cancelAnimationFrame=()=>{};
 try{
  const level={current:0};const rendered=render(<TeacherAvatar level={level} connected={true} paused={false}/>);
  frame!(0);const root=rendered.container.querySelector('.teacher-avatar') as HTMLElement;assert(!root.classList.contains('is-talking'));
  level.current=.8;frame!(80);assert(root.classList.contains('is-talking'));assert(Number(root.style.getPropertyValue('--voice-level'))>.3);
  level.current=0;for(let n=0;n<10;n++)frame!(160+n*80);assert(!root.classList.contains('is-talking'));
 }finally{globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;}
});

test('performance panel exposes experiment labels, subjective markers and safe exports',async()=>{
 const {PerformancePanel}=await import('../components/performance-panel.tsx');const {LivePerformanceCollector}=await import('../lib/live-performance.ts');
 const c=new LivePerformanceCollector();c.measure('agent_http',450);let strategy='',marked=0,downloaded='';
 const oldClick=dom.window.HTMLAnchorElement.prototype.click;
 dom.window.HTMLAnchorElement.prototype.click=function(){downloaded=this.download;};
 try{
  render(<PerformancePanel summary={c.summary()} active={true} strategy="baseline" onStrategy={v=>{strategy=v;}} onMark={()=>{marked++;}} getReport={()=>c.report()}/>);
  const details=document.querySelector('.performance-panel')!;details.setAttribute('open','');
  fireEvent.change(screen.getByLabelText('流畅度实验标签'),{target:{value:'network_a'}});assert.equal(strategy,'network_a');
  fireEvent.click(screen.getByRole('button',{name:'刚才卡了一下'}));assert.equal(marked,1);
  fireEvent.click(screen.getByRole('button',{name:'导出当前记录 JSON'}));assert(downloaded.startsWith('littleleaf-performance-'));assert(downloaded.endsWith('.json'));
  assert.equal(screen.getAllByText('450 ms',{exact:true}).length,2);
 }finally{dom.window.HTMLAnchorElement.prototype.click=oldClick;}
});

test('anonymous public visitors can practice and see sign-in before any AI microphone request',async()=>{
 let microphone=0;
 Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{microphone++;throw new Error('should not request');}},configurable:true});
 globalThis.fetch=async input=>String(input).includes('/api/network-check')?Response.json({ok:true,kind:'littleleaf-network-probe'}):Response.json({configured:true,keyConfigured:true,liveReady:true,signedIn:false});
 await start();await waitFor(()=>assert(screen.getByText('登录可用 AI')));
 assert(screen.getAllByRole('link',{name:/登录后使用 AI 老师/}).some(a=>a.getAttribute('target')==='_top'));
 assert(screen.getByRole('button',{name:'开始实时课堂'}).hasAttribute('disabled'));
 await choose('apple');assert(screen.getByRole('button',{name:'继续探索'}));assert.equal(microphone,0);
});
test('network warning appears after failed probes, can retry and handles offline recovery',async()=>{
 const {NetworkNotice}=await import('../components/network-notice.tsx');
 globalThis.fetch=async()=>{throw new TypeError('synthetic network failure');};
 render(<NetworkNotice active={false} sample={null}/>);
 await waitFor(()=>assert(screen.getByText('网站连接检测未成功')));
 globalThis.fetch=async()=>Response.json({ok:true,kind:'littleleaf-network-probe'});
 fireEvent.click(screen.getByRole('button',{name:'重新检测网络'}));
 await waitFor(()=>assert(screen.getByText(/网站连接正常/)));
 fireEvent(window,new Event('offline'));assert(screen.getByText('设备提示可能已离线'));
 fireEvent(window,new Event('online'));await waitFor(()=>assert(screen.getByText(/网站连接正常/)));
});
test('voice warning needs two bad samples and does not clear merely on missing stats',async()=>{
 const {NetworkNotice}=await import('../components/network-notice.tsx');const {LivePerformanceCollector}=await import('../lib/live-performance.ts');
 const c=new LivePerformanceCollector(), empty=c.sample([]);const sample={...empty,rttMs:900};
 const app=render(<NetworkNotice active={true} sample={{...sample,atMs:1}}/>);assert(!screen.queryByText('当前语音线路质量较差'));
 app.rerender(<NetworkNotice active={true} sample={{...sample,atMs:2}}/>);assert(screen.getByText('当前语音线路质量较差'));
 for(let i=3;i<6;i++)app.rerender(<NetworkNotice active={true} sample={{...empty,atMs:i}}/>);
 assert(screen.getByText('当前语音线路质量较差'));
 for(let i=6;i<9;i++)app.rerender(<NetworkNotice active={true} sample={{...empty,rttMs:50,atMs:i}}/>);
 assert(!screen.queryByText('当前语音线路质量较差'));
});
