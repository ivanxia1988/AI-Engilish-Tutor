import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveClassroomClient, type LiveDependencies, type LiveCallbacks } from '../lib/live-client.ts';
import { buildLiveSession, isReceiveOnlyOffer, liveSessionSchema, type LiveContext, type LiveSession, type LiveState } from '../lib/live-protocol.ts';
import { agentTool, agentInstructions, type LiveAgentResult } from '../lib/live-agent.ts';
import { makeLiveTicket, verifyLiveTicket } from '../lib/live-ticket.ts';
import { createDemoBook } from '../lib/demo.ts';
const book=createDemoBook(), step=book.lessons[0].steps[1];
const context:LiveContext={contextKey:'b:l:step1',lessonTitle:'水果课',age:7,step,objects:book.pages[0].objects,selectedIds:[],answered:false};
const SDP='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const SESSION:LiveSession={sessionId:'live_synthetic_test',sdp:SDP,closeToken:'synthetic-ticket'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
class Channel {
 readyState='open'; onmessage:((e:{data:string})=>void)|null=null; onclose:(()=>void)|null=null; sent:Record<string,unknown>[]=[]; ack=true;
 send(raw:string){const event=JSON.parse(raw);this.sent.push(event);if(event.type==='session.close'&&this.ack)this.receive({type:'session.closed',usage:{seconds:15},reason:'close_requested'});}
 receive(event:object){this.onmessage?.({data:JSON.stringify(event)});}
 close(){this.readyState='closed';this.onclose?.();}
}
class Peer {
 channel=new Channel(); localDescription:{sdp:string}|null=null; iceGatheringState='complete'; connectionState='new'; onconnectionstatechange:(()=>void)|null=null; ontrack:unknown=null;
 remote=0; transceivers:unknown[]=[]; tracks:unknown[]=[];
 createDataChannel(){return this.channel;} addTransceiver(...args:unknown[]){this.transceivers.push(args);} addTrack(...args:unknown[]){this.tracks.push(args);}
 async createOffer(){return{type:'offer',sdp:SDP};} async setLocalDescription(value:{sdp:string}){this.localDescription=value;}
 async setRemoteDescription(){this.remote++;this.connectionState='connected';this.channel.receive({type:'session.started',event_id:'started'});}
 addEventListener(){} removeEventListener(){} close(){this.connectionState='closed';}
}
function harness(extra:Partial<LiveDependencies>={}, callbacks:Partial<LiveCallbacks>={}){
 const peer=new Peer(), states:LiveState[]=[], errors:string[]=[], requests:{path:string;body:unknown}[]=[], tools:string[]=[];
 let stopped=0, mediaCount=0;
 const track={enabled:true,stop(){stopped++;}}, stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const deps:LiveDependencies={now:()=>Date.now(),peer:()=>peer as unknown as RTCPeerConnection,media:async()=>{mediaCount++;return stream as unknown as MediaStream;},audio:()=>({autoplay:true,pause(){},play:async()=>{},srcObject:null})as unknown as HTMLAudioElement,request:async<T>(path:string,body:unknown)=>{requests.push({path,body});return(path.includes('/close')?{closed:true}:SESSION)as T;},closeWaitMs:1,...extra};
 const client=new LiveClassroomClient({state:s=>states.push(s),error:e=>errors.push(e),tool:async call=>{tools.push(call.name);return{status:'confirmed'};},...callbacks},deps);
 return{client,peer,states,errors,requests,tools,stopped:()=>stopped,mediaCount:()=>mediaCount,track};
}
test('probe connects, finalizes and never requests a microphone',async()=>{
 let usage=0;const h=harness({}, {usage:value=>{usage=value;}});
 await h.client.start('probe');await h.client.stop();
 assert.equal(h.mediaCount(),0);assert.deepEqual(h.states,['connecting','connected','closing','closed']);assert.equal(usage,15);
 assert(h.peer.transceivers.length);assert.equal(h.peer.tracks.length,0);assert(!h.requests.some(r=>r.path.includes('/close')));
});
const agentReply=(overrides:Partial<LiveAgentResult>={}):LiveAgentResult=>({contextKey:context.contextKey,decision:'reply',english:'Let us look at the picture.',chinese:'看看图片。',action:{type:'none',objectIds:[],text:''},...overrides});
const delegation=(id='delegation_1')=>({type:'session.delegation.created',event_id:'event_'+id,offset_ms:1000,delegation:{id,target:'client'}});
function agentHarness(result:LiveAgentResult,callbacks:Partial<LiveCallbacks>={}) {
 const agentRequests:Record<string,unknown>[]=[];
 const h=harness({request:async<T>(path:string,body:unknown)=>{if(path==='/api/live/agent'){agentRequests.push(body as Record<string,unknown>);return result as T;}return SESSION as T;}},callbacks);
 return {...h,agentRequests};
}
test('classroom and probe select client delegation with no managed Responses workflow',()=>{
 for(const current of [context,undefined]){
  const config=buildLiveSession({liveModel:'gpt-live-1',liveVoice:'gleam',liveBackend:'gpt-6-luna'},current);
  assert.equal(config.model,'gpt-live-1');assert.equal(config.audio.output.voice,'gleam');assert.equal(config.store,false);
  assert.equal(config.delegation.type,'client');assert.equal(config.delegation.acknowledgement_delay_ms,800);
  assert(!('responses'in config.delegation));assert(!JSON.stringify(config).includes('API_KEY'));
 }
});
test('client delegation cancels acknowledgement, preserves transcript timestamps and executes once',async()=>{
 const h=agentHarness(agentReply({action:{type:'highlight',objectIds:['0-apple'],text:''}}));
 await h.client.start('classroom',context);
 h.peer.channel.receive({type:'session.input_transcript.delta',delta:'Please help me find the apple.',start_ms:10,end_ms:1500});
 h.peer.channel.receive(delegation());h.peer.channel.receive(delegation());await tick();await tick();
 assert.equal(h.agentRequests.length,1);assert.deepEqual(h.agentRequests[0].history,[{role:'child',text:'Please help me find the apple.',startMs:10,endMs:1500}]);
 assert.deepEqual(h.tools,['highlight_objects']);
 const events=h.peer.channel.sent.filter(e=>e.delegation_id==='delegation_1');
 assert.equal(events[0].type,'session.thinking.append');assert.equal(events[0].content,'');
 assert(events.some(e=>e.type==='session.commentary.append'&&String(e.content).includes('highlighted')));
 assert(!h.peer.channel.sent.some(e=>e.type==='response.item.create'||e.type==='response.create'));
 await h.client.stop();
});
test('stale agent result cannot execute or speak after the task changes',async()=>{
 let finish:((v:LiveAgentResult)=>void)|undefined;
 const h=harness({request:async<T>(path:string)=>path==='/api/live/agent'?await new Promise<LiveAgentResult>(resolve=>{finish=resolve;})as T:SESSION as T});
 await h.client.start('classroom',context);h.peer.channel.receive(delegation());await tick();assert(finish);
 h.client.updateContext({...context,contextKey:'new-task'});finish(agentReply({action:{type:'highlight',objectIds:['0-apple'],text:''}}));await tick();await tick();
 assert.equal(h.tools.length,0);assert(!h.peer.channel.sent.some(e=>e.type==='session.commentary.append'&&e.delegation_id==='delegation_1'));await h.client.stop();
});
test('failed application actions cannot be announced as successful',async()=>{
 const h=agentHarness(agentReply({english:'It is highlighted!',action:{type:'highlight',objectIds:['0-apple'],text:''}}),{tool:async()=>({status:'failed'})});
 await h.client.start('classroom',context);h.peer.channel.receive(delegation());await tick();await tick();
 const speech=h.peer.channel.sent.filter(e=>e.type==='session.commentary.append'&&e.delegation_id==='delegation_1').map(e=>e.content).join('');
 assert(speech.includes('did not finish'));assert(!speech.includes('It is highlighted!'));await h.client.stop();
});
test('typed messages use our agent, never Responses-only data-channel commands',async()=>{
 const h=agentHarness(agentReply({english:'Apple means 苹果.'}));await h.client.start('classroom',context);
 assert(h.client.sendTyped('apple是什么意思？'));await tick();await tick();
 assert.equal(h.agentRequests[0].reason,'typed');assert.equal(h.agentRequests[0].message,'apple是什么意思？');
 assert(!h.peer.channel.sent.some(e=>String(e.type).startsWith('response.')));await h.client.stop();
});
test('ongoing off-topic speech can trigger a redirect before the child finishes, with cooldown',async()=>{
 let now=0,calls=0;
 const h=harness({now:()=>now,request:async<T>(path:string)=>{if(path==='/api/live/agent'){calls++;return agentReply({decision:'redirect',english:'Let us find the apple.'})as T;}return SESSION as T;}});
 await h.client.start('classroom',context);
 for(let n=0;n<=6;n++){now=n*2000;h.peer.channel.receive({type:'session.input_transcript.delta',delta:'blah nonsense blah ',start_ms:now,end_ms:now+100});await tick();}
 const sent=h.peer.channel.sent;const redirect=sent.findIndex(e=>e.type==='session.instructions.append');assert(redirect>=0);assert.equal(sent[redirect+1].type,'session.commentary.append');assert.equal(calls,1);
 for(let n=7;n<=12;n++){now=n*2000;h.peer.channel.receive({type:'session.input_transcript.delta',delta:'blah nonsense blah '});await tick();}
 assert.equal(calls,1);await h.client.stop();
});
test('long meaningful speech gets no redirect and attention checks cannot execute tools',async()=>{
 let now=0;
 const h=harness({now:()=>now,request:async<T>(path:string)=>path==='/api/live/agent'?agentReply({decision:'wait',action:{type:'answer',objectIds:[],text:'apple'}})as T:SESSION as T});
 await h.client.start('classroom',context);
 for(let n=0;n<=6;n++){now=n*2000;h.peer.channel.receive({type:'session.input_transcript.delta',delta:'I can see a red apple and a yellow banana. '});await tick();}
 assert(!h.peer.channel.sent.some(e=>e.type==='session.instructions.append'));assert.equal(h.tools.length,0);await h.client.stop();
});
test('a stop request during an attention check prevents a late redirect',async()=>{
 let now=0,finish:((v:LiveAgentResult)=>void)|undefined;
 const h=harness({now:()=>now,request:async<T>(path:string)=>path==='/api/live/agent'?await new Promise<LiveAgentResult>(resolve=>{finish=resolve;})as T:SESSION as T});
 await h.client.start('classroom',context);
 for(let n=0;n<=5;n++){now=n*2000;h.peer.channel.receive({type:'session.input_transcript.delta',delta:'blah nonsense blah '});await tick();}
 assert(finish);now+=500;h.peer.channel.receive({type:'session.input_transcript.delta',delta:'Please stop and wait.'});
 finish(agentReply({decision:'redirect',english:'Let us find the apple.'}));await tick();await tick();
 assert(!h.peer.channel.sent.some(e=>e.type==='session.instructions.append'));await h.client.stop();
});
test('agent action validation rejects unknown objects, selection grading and obsolete keys',()=>{
 assert.equal(agentTool(agentReply({action:{type:'highlight',objectIds:['invented'],text:''}}),context,'1'),null);
 assert.equal(agentTool(agentReply({action:{type:'answer',objectIds:[],text:'apple'}}),context,'2'),null);
 assert.equal(agentTool(agentReply({contextKey:'old',action:{type:'inspect',objectIds:[],text:'this?'}}),context,'3'),null);
 assert(agentInstructions('attention').includes('Duration alone is insufficient'));
});
test('closing during session creation closes a late server session without reconnecting',async()=>{
 let resolve:((s:LiveSession)=>void)|undefined,closeCalls=0;
 const h=harness({request:async<T>(path:string)=>path.includes('/close')?(closeCalls++,{closed:true}as T):await new Promise<LiveSession>(r=>{resolve=r;})as T});
 const starting=h.client.start('classroom',context);await tick();assert(resolve);await h.client.stop();resolve(SESSION);await starting;
 assert.equal(h.peer.remote,0);assert.equal(closeCalls,1);assert(h.stopped()>0);assert(!h.states.includes('connected'));
});
test('network close falls back to signed server cleanup when final event is missing',async()=>{
 const h=harness();h.peer.channel.ack=false;await h.client.start('classroom',context);await h.client.stop();
 assert(h.requests.some(r=>r.path==='/api/live/close'));assert(h.stopped()>0);assert.equal(h.peer.connectionState,'closed');
});
test('microphone denial creates no billable session and returns an actionable error',async()=>{
 const h=harness({media:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}});
 await h.client.start('classroom',context);assert.equal(h.requests.length,0);assert(h.errors[0].includes('麦克风权限'));assert.equal(h.states.at(-1),'error');
});
test('a throwing data channel cannot prevent shutdown and server cleanup',async()=>{
 const h=harness();await h.client.start('classroom',context);
 h.peer.channel.send=()=>{throw new Error('network write failed');};
 await h.client.stop();assert(h.stopped()>0);assert.equal(h.peer.connectionState,'closed');assert(h.requests.some(r=>r.path==='/api/live/close'));
});
test('context updates send state patches without changing delegation; muting controls capture track',async()=>{
 const h=harness();await h.client.start('classroom',context);h.client.updateContext({...context,contextKey:'b:l:new-step'});
 const update=h.peer.channel.sent.find(e=>e.type==='session.thinking.append'&&String(e.content).includes('b:l:new-step'));assert(update);assert(!h.peer.channel.sent.some(e=>e.type==='session.update'));
 h.client.mute(true);assert.equal(h.track.enabled,false);h.client.mute(false);assert.equal(h.track.enabled,true);await h.client.stop();
});
test('probe schema cannot carry classroom data and requires a receive-only offer',()=>{
 liveSessionSchema.parse({mode:'probe',sdp:SDP});assert(isReceiveOnlyOffer(SDP));assert(!isReceiveOnlyOffer(SDP.replace('recvonly','sendrecv')));
 assert.throws(()=>liveSessionSchema.parse({mode:'probe',sdp:SDP,context}));assert.throws(()=>liveSessionSchema.parse({mode:'classroom',sdp:SDP,context,consent:false}));
});
test('signed close tickets bind user, session, expiry and signature',async()=>{
 const ticket=await makeLiveTicket('synthetic-secret','live_1','user_1',1000);
 assert(await verifyLiveTicket('synthetic-secret',ticket,'live_1','user_1',2000));
 assert(!await verifyLiveTicket('synthetic-secret',ticket,'live_2','user_1',2000));assert(!await verifyLiveTicket('synthetic-secret',ticket,'live_1','user_2',2000));
 assert(!await verifyLiveTicket('synthetic-secret',ticket,'live_1','user_1',1_000_000));assert(!await verifyLiveTicket('wrong',ticket,'live_1','user_1',2000));
 assert(!await verifyLiveTicket('synthetic-secret',ticket+'tampered','live_1','user_1',2000));assert(!ticket.includes('synthetic-secret'));
});

test('voice circle command executes with no native delegation, and late delegation cannot duplicate it',async()=>{
 const h=harness({commandWaitMs:0});await h.client.start('classroom',context);
 for(const delta of ['Can you ', 'circle the ', 'apple?'])h.peer.channel.receive({type:'session.input_transcript.delta',delta});
 await tick();await tick();assert.deepEqual(h.tools,['highlight_objects']);
 assert(h.peer.channel.sent.some(e=>e.type==='session.commentary.append'&&String(e.content).includes('visible circle')));
 h.peer.channel.receive(delegation('late_native'));await tick();assert.equal(h.tools.length,1);
 assert(h.peer.channel.sent.some(e=>e.delegation_id==='late_native'&&String(e.content).includes('already drew')));
 await h.client.stop();
});
test('state injection is only confirmed after matching provider acknowledgments',async()=>{
 const sync:string[]=[];const h=harness({}, {sync:value=>sync.push(value)});await h.client.start('classroom',context);
 assert.equal(sync.at(-1),'pending');
 const updates=h.peer.channel.sent.filter(e=>e.type==='session.thinking.append');
 h.peer.channel.receive({type:'session.thinking.appended',client_event_id:'not_ours'});assert.equal(sync.at(-1),'pending');
 for(const e of updates)h.peer.channel.receive({type:'session.thinking.appended',client_event_id:e.event_id});
 assert.equal(sync.at(-1),'confirmed');await h.client.stop();
});

test('live idle timer sends a scaffold without a user turn or delegation, and records assistance',async()=>{
 let now=0,assisted=0;const h=harness({now:()=>now},{assistance:()=>assisted++});await h.client.start('classroom',context);
 for(const event of h.peer.channel.sent.filter(e=>e.type==='session.thinking.append'))h.peer.channel.receive({type:'session.thinking.appended',client_event_id:event.event_id});
 now=1000;h.client.observeAudio('teacher',.1);h.client.observeAudio('child',0);
 now=9000;h.client.observeAudio('teacher',0);h.client.observeAudio('child',0);h.client.coachTick();
 assert.equal(assisted,1);assert(h.peer.channel.sent.some(e=>e.type==='session.commentary.append'&&String(e.content).includes('Lead the current select exercise')));
 assert.equal(h.tools.length,0);await h.client.stop();
});
test('live automatic progression calls the app only for a completed step',async()=>{
 let now=0,advanced=0;const h=harness({now:()=>now},{advance:()=>{advanced++;return true;}});await h.client.start('classroom',{...context,answered:true});
 for(const event of h.peer.channel.sent.filter(e=>e.type==='session.thinking.append'))h.peer.channel.receive({type:'session.thinking.appended',client_event_id:event.event_id});
 now=1000;h.client.observeAudio('teacher',.1);h.client.observeAudio('child',0);
 now=7000;h.client.observeAudio('teacher',0);h.client.observeAudio('child',0);h.client.coachTick();assert.equal(advanced,1);
 h.client.coachTick();assert.equal(advanced,1);await h.client.stop();
});

test('performance records backend phases without retaining response content or credentials',async()=>{
 let now=0;const h=harness({now:()=>now,request:async<T>(path:string)=>{now+=40;return (path==='/api/live/session'?{...SESSION,performance:{serverTotalMs:25,upstreamMs:20,model:'gpt-live-1'},secret:'NEVER_EXPORT'}:{closed:true})as T;}});
 await h.client.start('classroom',context);h.client.markStutter();
 const report=h.client.performanceReport();assert.equal(report.summary.measurements.session_http?.p50Ms,40);assert.equal(report.summary.measurements.session_server_total?.p50Ms,25);assert.equal(report.summary.stutterMarkers,1);
 assert(!JSON.stringify(report).includes('NEVER_EXPORT'));assert(!JSON.stringify(report).includes(SESSION.sdp));assert(!JSON.stringify(report).includes(SESSION.closeToken));await h.client.stop();
});
test('speech overlapping the teacher is not counted as an answer-latency sample',async()=>{
 let now=0;const h=harness({now:()=>now});await h.client.start('classroom',context);
 now=1000;h.client.observeAudio('teacher',.1);now=1200;h.client.observeAudio('child',.1);now=1400;h.client.observeAudio('child',.1);
 now=1700;h.client.observeAudio('teacher',0);now=1800;h.client.observeAudio('teacher',.1);
 assert.equal(h.client.performanceReport().summary.measurements.child_to_teacher_gap,undefined);await h.client.stop();
});
