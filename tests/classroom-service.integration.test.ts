import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test/.test(url.pathname)) throw new Error('A loopback disposable test database is required.');
}
async function fixture(t: TestContext) {
  const admin = new Pool({ connectionString: database });
  const schema = `classroom_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: database, options: `-c search_path=${schema},public`, max:8 });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  for (const file of ['0001_accounts.sql','0002_classrooms.sql','0003_teacher_agents.sql']) await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
  const { ClassroomService } = await import('../lib/server/classroom-service.ts');
  const { publishTrialCourses } = await import('../lib/server/course-catalog.ts');
  await publishTrialCourses(pool);
  const owner = randomUUID(), other = randomUUID();
  for (const id of [owner,other]) {
    await pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,'synthetic','v1',now(),now())",[id,`${id}@example.test`]);
    await pool.query("INSERT INTO teeko_profiles(account_id,name,age_range,level,updated_at) VALUES($1,'Test learner','10–11','unsure',now())",[id]);
  }
  let clock = new Date('2026-11-01T01:00:00Z');
  const options = { now:()=>new Date(clock), maxSeconds:60, dailySeconds:120 };
  const service = new ClassroomService(pool,options);
  return { pool,owner,other,service,options,advance:(ms:number)=>{ clock=new Date(clock.getTime()+ms); } };
}
test('real classroom persistence, concurrency, evidence and bounded leases', {skip:!database}, async t=>{
  await t.test('published courses have valid material and a single competing active classroom',async t=>{
    const f=await fixture(t); const catalog=await f.service.courses(f.owner);
    assert.equal(catalog.courses.length,1); assert.equal(catalog.courses[0].id,'picnic');
    const results=await Promise.allSettled([f.service.create(f.owner,'picnic'),f.service.create(f.owner,'picnic')]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const row=(await f.pool.query('SELECT id FROM teeko_classrooms')).rows[0];
    await assert.rejects(f.service.get(f.other,row.id));
    const restarted=new (await import('../lib/server/classroom-service.ts')).ClassroomService(f.pool,f.options);
    assert.equal((await restarted.get(f.owner,row.id)).course.version,'2');
  });
  await t.test('actions are idempotent, stale ones fail, assisted selections never become independent',async t=>{
    const f=await fixture(t); const created=await f.service.create(f.owner,'picnic');
    const lease=await f.service.claim(f.owner,created.id);
    const first=lease.snapshot;
    const hint=await f.service.action(f.owner,created.id,{eventId:randomUUID(),expectedRevision:first.revision,type:'hint'});
    const step=hint.course.steps[hint.stepIndex];
    const action={eventId:randomUUID(),expectedRevision:hint.revision,type:'select' as const,objectIds:[step.targetId!]};
    const answered=await f.service.action(f.owner,created.id,action);
    assert.equal(answered.outcomes[0].status,'assisted');
    assert.equal(answered.stepIndex,1);
    assert.equal((await f.service.action(f.owner,created.id,action)).stepIndex,1);
    await assert.rejects(f.service.action(f.owner,created.id,{...action,eventId:randomUUID()}));
    await f.service.release(f.owner,created.id,lease.epoch,lease.ownerToken);
  });
  await t.test('spoken tools require recent server transcript and do not assess pronunciation',async t=>{
    const f=await fixture(t); const c=await f.service.create(f.owner,'picnic'); const lease=await f.service.claim(f.owner,c.id);
    const selected=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    const contextKey=`${c.id}:${lease.epoch}:1`;
    const forged=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'submit_spoken_answer',{contextKey,answer:'It is an apple.'});
    assert.equal(forged.output.status,'retry'); assert.equal(forged.snapshot.stepIndex,selected.stepIndex);
    await f.service.transcript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey,role:'child',text:'It is an apple.',final:true,itemId:'spoken-one'});
    const actual=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'submit_spoken_answer',{contextKey,answer:'It is an apple.'});
    assert.equal(actual.output.status,'confirmed'); assert.equal(actual.snapshot.stepIndex,2);
    assert(!JSON.stringify(actual).includes('pronunciationScore'));
  });
  await t.test('manual ending preserves a checkpoint for a new lesson without reusing its speaking evidence',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    const a=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:a.revision,type:'end'});
    const next=await f.service.create(f.owner,'picnic');assert.equal(next.stepIndex,1);assert.deepEqual(next.outcomes,[]);
  });
  await t.test('a received complete learner answer progresses without depending on a vendor tool call',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    const event={contextKey:`${c.id}:${lease.epoch}:1`,source:'speech' as const,role:'child' as const,text:'It is an apple.',final:false,itemId:'utterance'};
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,event);
    assert.equal((await f.service.get(f.owner,c.id)).stepIndex,1);
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{...event,final:true});
    assert.equal((await f.service.get(f.owner,c.id)).stepIndex,2);
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{...event,final:true});
    assert.equal((await f.service.get(f.owner,c.id)).stepIndex,2);
  });
  await t.test('lease expiry accounts only for its valid interval and stale model context cannot answer a new task',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    const selected=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    await f.service.transcript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:1`,role:'child',text:'an apple',final:true,itemId:'a'});
    const stale=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'submit_spoken_answer',{contextKey:`${c.id}:${lease.epoch}:0`,answer:'an apple'});
    assert.equal(stale.output.status,'retry');assert.equal(stale.snapshot.stepIndex,selected.stepIndex);
    f.advance(30_000);assert.equal(await f.service.heartbeat(f.owner,c.id,lease.epoch,lease.ownerToken),null);
    const paused=await f.service.get(f.owner,c.id);assert.equal(paused.status,'paused');assert.equal(paused.elapsedSeconds,15);
  });
  await t.test('negative or mixed answers and missing task context never count as correct',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    const contextKey=`${c.id}:${lease.epoch}:1`;
    await f.service.transcript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey,role:'child',text:'Not an apple. It is a banana.',final:true,itemId:'negative'});
    const negative=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'submit_spoken_answer',{contextKey,answer:'Not an apple. It is a banana.'});
    assert.equal(negative.output.status,'retry');assert.equal(negative.snapshot.stepIndex,1);
    f.advance(1);
    await f.service.transcript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey,role:'child',text:'an apple',final:true,itemId:'positive'});
    const missing=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'submit_spoken_answer',{answer:'an apple'});
    assert.equal(missing.output.status,'retry');assert.equal(missing.snapshot.stepIndex,1);
  });
  await t.test('an explicit completed request to stop pauses instead of demanding the answer again',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:0`,role:'child',text:'Please stop.',final:true,itemId:'stop'});
    const state=await f.service.get(f.owner,c.id);assert.equal(state.status,'paused');assert.equal(state.outcomes.length,0);
  });
  await t.test('a completed explicit request to skip is respected by the application for either provider',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:0`,role:'child',text:'Can we skip this?',final:true,itemId:'skip'});
    const state=await f.service.get(f.owner,c.id);assert.equal(state.stepIndex,1);assert.equal(state.outcomes[0].status,'skipped');
  });
  await t.test('stories mentioning a target and next weekend neither answer nor skip an activity',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    let state=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'select',objectIds:['apple']});
    const contextKey=`${c.id}:${lease.epoch}:1`;
    for(const [index,text] of ['My dog stole an apple yesterday.','Next weekend I will visit my grandma.','Tell me another story.'].entries()){
      f.advance(1);
      await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey,role:'child',text,final:true,itemId:`story-${index}`});
      const result=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'delegate',{contextKey});
      assert.equal(result.output.status,'conversation');assert.equal(result.snapshot.stepIndex,1);assert.equal(result.snapshot.outcomes.length,1);
      const attemptedSkip=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'skip',{contextKey});
      assert.equal(attemptedSkip.snapshot.stepIndex,1);
    }
    state=await f.service.get(f.owner,c.id);assert.equal(state.status,'active');
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey,role:'child',text:'It is an apple.',final:true,itemId:'real-answer'});
    assert.equal((await f.service.get(f.owner,c.id)).stepIndex,2);
  });
  await t.test('new picnic applied expressions lead to open conversation, not automatic hang-up',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);let state=lease.snapshot;
    for(let i=0;i<6;i++)state=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:state.revision,type:'skip'});
    for(const [index,text] of ['I like apples.',"Let's have a picnic!",'I will bring bananas.'].entries()){
      f.advance(1);await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:${state.stepIndex}`,role:'child',text,final:true,itemId:`answer-${index}`});
      state=await f.service.get(f.owner,c.id);assert.equal(state.status,'active');assert.equal(state.stepIndex,7+index);
    }
    assert.equal(state.course.steps[state.stepIndex].id,'picnic-chat');
    for(const [index,text] of ['I like strawberries.','I want to tell you about my dog.'].entries()){
      f.advance(1);await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:9`,role:'child',text,final:true,itemId:`chat-${index}`});
    }
    state=await f.service.get(f.owner,c.id);assert.equal(state.status,'active');assert.equal(state.stepIndex,9);assert.equal(state.outcomes.length,9);
    await f.service.receiveTranscript(f.owner,c.id,lease.epoch,lease.ownerToken,{contextKey:`${c.id}:${lease.epoch}:9`,role:'child',text:'Next.',final:true,itemId:'last-next'});
    const nextTopic=await f.service.tool(f.owner,c.id,lease.epoch,lease.ownerToken,'delegate',{contextKey:`${c.id}:${lease.epoch}:9`});
    assert.equal(nextTopic.snapshot.status,'active');assert.equal(nextTopic.snapshot.stepIndex,9);
    state=await f.service.get(f.owner,c.id);
    state=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:state.revision,type:'next'});
    assert.equal(state.status,'ended');assert.equal(state.endReason,'content_completed');assert.equal(state.outcomes.at(-1)?.status,'unassessed');
  });
  await t.test('publishing v2 keeps an old v1 session and checksum intact without transferring its checkpoint',async t=>{
    const f=await fixture(t);const c=await f.service.create(f.owner,'picnic');
    await f.pool.query("UPDATE teeko_classrooms SET course_version='1' WHERE id=$1",[c.id]);
    const checksum=(await f.pool.query("SELECT checksum FROM teeko_courses WHERE id='picnic' AND version='1'")).rows[0].checksum;
    await (await import('../lib/server/course-catalog.ts')).publishTrialCourses(f.pool);
    assert.equal((await f.pool.query("SELECT checksum FROM teeko_courses WHERE id='picnic' AND version='1'")).rows[0].checksum,checksum);
    const lease=await f.service.claim(f.owner,c.id);assert.equal(lease.snapshot.course.version,'1');assert.equal(lease.snapshot.course.steps.length,7);
    const skipped=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'skip'});
    await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:skipped.revision,type:'end'});
    const v2=await f.service.create(f.owner,'picnic');assert.equal(v2.course.version,'2');assert.equal(v2.stepIndex,0);assert.deepEqual(v2.outcomes,[]);
  });
  await t.test('usage is assigned to actual local calendar intervals and an old classroom cannot bypass a new daily cap',async t=>{
    const f=await fixture(t);f.advance(new Date('2026-11-01T15:59:55Z').getTime()-f.options.now().getTime());
    const c=await f.service.create(f.owner,'picnic');const lease=await f.service.claim(f.owner,c.id);
    f.advance(10_000);const state=await f.service.heartbeat(f.owner,c.id,lease.epoch,lease.ownerToken);assert(state);
    const buckets=(await f.pool.query('SELECT day_key,milliseconds FROM teeko_classroom_usage WHERE account_id=$1 ORDER BY day_key',[f.owner])).rows;
    assert.deepEqual(buckets.map(x=>[x.day_key,Number(x.milliseconds)]),[['2026-11-01',5000],['2026-11-02',5000]]);
    await f.service.release(f.owner,c.id,lease.epoch,lease.ownerToken);
    await f.pool.query('UPDATE teeko_classroom_usage SET milliseconds=120000 WHERE account_id=$1 AND day_key=$2',[f.owner,'2026-11-02']);
    await assert.rejects(f.service.claim(f.owner,c.id),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='DAILY_LIMIT');
  });
  await t.test('pause settles elapsed time; expired/revoked leases and ended classes cannot revive',async t=>{
    const f=await fixture(t); const c=await f.service.create(f.owner,'picnic'); const lease=await f.service.claim(f.owner,c.id);
    await assert.rejects(f.service.claim(f.owner,c.id));
    f.advance(11_000);
    const paused=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:lease.snapshot.revision,type:'pause'});
    assert.equal(paused.elapsedSeconds,11);
    assert.equal(await f.service.heartbeat(f.owner,c.id,lease.epoch,lease.ownerToken),null);
    const resumed=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:paused.revision,type:'resume'});
    const next=await f.service.claim(f.owner,c.id);
    assert(next.epoch>lease.epoch); assert.equal(next.snapshot.elapsedSeconds,11);
    for(let i=0;i<4;i++){f.advance(10_000);assert(await f.service.heartbeat(f.owner,c.id,next.epoch,next.ownerToken));}
    f.advance(10_000);assert.equal(await f.service.heartbeat(f.owner,c.id,next.epoch,next.ownerToken),null);
    const ended=await f.service.get(f.owner,c.id);
    assert.equal(ended.status,'ended'); assert.equal(ended.endReason,'time_limit'); assert.equal(ended.elapsedSeconds,60);
    await assert.rejects(f.service.claim(f.owner,c.id));
    assert.equal(resumed.status,'preflight');
  });
  await t.test('all steps can be skipped without claiming mastery and daily consumption survives new classes',async t=>{
    const f=await fixture(t); let c=await f.service.create(f.owner,'picnic'); const lease=await f.service.claim(f.owner,c.id); c=lease.snapshot;
    while(c.status!=='ended') c=await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:c.revision,type:'skip'});
    assert.equal(c.endReason,'content_completed'); assert(c.outcomes.every(x=>x.status==='skipped'));
    assert.equal((await f.service.courses(f.owner)).courses[0].progress.completed,true);
    const other=await f.service.create(f.owner,'picnic'); const a=await f.service.claim(f.owner,other.id);
    for(let i=0;i<6;i++){f.advance(10_000);await f.service.heartbeat(f.owner,other.id,a.epoch,a.ownerToken);}
    const last=await f.service.create(f.owner,'picnic'); const b=await f.service.claim(f.owner,last.id);
    for(let i=0;i<6;i++){f.advance(10_000);await f.service.heartbeat(f.owner,last.id,b.epoch,b.ownerToken);}
    await assert.rejects(f.service.create(f.owner,'picnic'));
  });
});
