import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ClassroomAction, ClassroomFeedback, ClassroomOutcome, ClassroomPreferences, ClassroomSnapshot, CourseCard, PublishedCourse } from '../classroom-contract';

export class ClassroomError extends Error {
  constructor(public code:string,message:string,public status=409){super(message);}
}
export const DEFAULT_CLASSROOM_PREFERENCES:ClassroomPreferences={provider:'qwen',language:'bilingual',style:'gentle',voice:'female',soundEffects:true};
type Row = {
  id:string;account_id:string;course_id:string;course_version:string;profile:ClassroomSnapshot['profile'];preferences:ClassroomPreferences;
  status:ClassroomSnapshot['status'];revision:number;connection_epoch:number;step_index:number;elapsed_ms:number|string;max_ms:number|string;
  limit_reason:'time_limit'|'daily_limit';active_since:Date|null;owner_token:string|null;lease_until:Date|null;
  outcomes:ClassroomOutcome[];helped_steps:string[];teacher_object_ids:string[];feedback:ClassroomFeedback|null;
  started_at:Date;ended_at:Date|null;end_reason:ClassroomSnapshot['endReason'];day_key:string;
};
type Transcript={role:'child'|'teacher';text:string;final:boolean;itemId?:string;contextKey?:string;source?:'speech'|'typed'};
type Options={now?:()=>Date;maxSeconds?:number;dailySeconds?:number};
const fail=(code:string,message:string,status=409):never=>{throw new ClassroomError(code,message,status);};
const day=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
const normalize=(text:string)=>text.toLowerCase().replace(/[^a-z\u4e00-\u9fff ]/g,' ').replace(/\s+/g,' ').trim();
export class ClassroomService {
  private now:()=>Date; private maxMs:number; private dailyMs:number;
  constructor(private pool:Pool,options:Options={}){
    this.now=options.now??(()=>new Date()); this.maxMs=(options.maxSeconds??900)*1000; this.dailyMs=(options.dailySeconds??3600)*1000;
    if(!Number.isFinite(this.maxMs)||!Number.isFinite(this.dailyMs)||this.maxMs<=0||this.dailyMs<this.maxMs) throw new Error('Invalid classroom limits.');
  }
  private async tx<T>(accountId:string,work:(db:PoolClient)=>Promise<T>):Promise<T>{
    const db=await this.pool.connect();
    try { await db.query('BEGIN'); const owner=await db.query('SELECT id FROM teeko_accounts WHERE id=$1 FOR UPDATE',[accountId]);
      if(!owner.rowCount) fail('UNAUTHORIZED','请重新登录。',401);
      const value=await work(db);await db.query('COMMIT');return value;
    } catch(error){await db.query('ROLLBACK');throw error;} finally{db.release();}
  }
  private async row(db:PoolClient,accountId:string,id:string):Promise<Row>{
    const result=await db.query('SELECT * FROM teeko_classrooms WHERE id=$1 AND account_id=$2 FOR UPDATE',[id,accountId]);
    if(!result.rowCount) fail('NOT_FOUND','没有找到这节课堂。',404);return result.rows[0];
  }
  private async course(db:PoolClient,row:Row):Promise<PublishedCourse>{
    const result=await db.query('SELECT manifest FROM teeko_courses WHERE id=$1 AND version=$2',[row.course_id,row.course_version]);
    if(!result.rowCount) fail('COURSE_UNAVAILABLE','这份课件暂时不可用。',503);return result.rows[0].manifest;
  }
  private async settle(db:PoolClient,row:Row){
    const now=this.now();
    if(row.status==='active'&&row.active_since&&row.lease_until){
      let cursor=row.active_since.getTime();
      const until=Math.min(now.getTime(),row.lease_until.getTime(),cursor+Number(row.max_ms)-Number(row.elapsed_ms));
      while(cursor<until){
        const bucket=day(new Date(cursor));
        const midnight=Date.parse(`${bucket}T00:00:00+08:00`)+86400000;
        const used=Number((await db.query('SELECT milliseconds FROM teeko_classroom_usage WHERE account_id=$1 AND day_key=$2',[row.account_id,bucket])).rows[0]?.milliseconds??0);
        const delta=Math.max(0,Math.min(until,midnight)-cursor),allowed=Math.max(0,Math.min(delta,this.dailyMs-used));
        if(allowed)await db.query('INSERT INTO teeko_classroom_usage(account_id,day_key,milliseconds) VALUES($1,$2,$3) ON CONFLICT(account_id,day_key) DO UPDATE SET milliseconds=teeko_classroom_usage.milliseconds+EXCLUDED.milliseconds',[row.account_id,bucket,allowed]);
        row.elapsed_ms=Number(row.elapsed_ms)+allowed;cursor+=allowed;
        if(allowed<delta){this.finish(row,'daily_limit');break;}
      }
      row.active_since=now;
      if(row.end_reason){row.active_since=null;}
      else if(Number(row.elapsed_ms)>=Number(row.max_ms)){this.finish(row,row.limit_reason);}
      else if(now>=row.lease_until){row.status='paused';row.owner_token=null;row.active_since=null;row.lease_until=null;row.revision++;}
    }
  }
  private finish(row:Row,reason:NonNullable<Row['end_reason']>){row.status='ended';row.end_reason=reason;row.ended_at=this.now();row.owner_token=null;row.lease_until=null;row.active_since=null;row.revision++;}
  private async save(db:PoolClient,row:Row){
    await db.query(`UPDATE teeko_classrooms SET status=$2,revision=$3,connection_epoch=$4,step_index=$5,elapsed_ms=$6,active_since=$7,owner_token=$8,lease_until=$9,outcomes=$10,helped_steps=$11,teacher_object_ids=$12,feedback=$13,ended_at=$14,end_reason=$15,max_ms=$16,limit_reason=$17 WHERE id=$1`,
      [row.id,row.status,row.revision,row.connection_epoch,row.step_index,row.elapsed_ms,row.active_since,row.owner_token,row.lease_until,JSON.stringify(row.outcomes),JSON.stringify(row.helped_steps),JSON.stringify(row.teacher_object_ids),JSON.stringify(row.feedback),row.ended_at,row.end_reason,row.max_ms,row.limit_reason]);
  }
  private async snapshot(db:PoolClient,row:Row):Promise<ClassroomSnapshot>{return {id:row.id,course:await this.course(db,row),profile:row.profile,preferences:row.preferences,status:row.status,revision:row.revision,connectionEpoch:row.connection_epoch,stepIndex:row.step_index,elapsedSeconds:Math.floor(Number(row.elapsed_ms)/1000),remainingSeconds:Math.max(0,Math.ceil((Number(row.max_ms)-Number(row.elapsed_ms))/1000)),maxSeconds:Number(row.max_ms)/1000,outcomes:row.outcomes,teacherObjectIds:row.teacher_object_ids,feedback:row.feedback,endReason:row.end_reason,startedAt:row.started_at.toISOString(),endedAt:row.ended_at?.toISOString()??null,reportStatus:'unavailable'};}
  async preferences(accountId:string):Promise<ClassroomPreferences>{const result=await this.pool.query('SELECT preferences FROM teeko_preferences WHERE account_id=$1',[accountId]);return result.rows[0]?.preferences??{...DEFAULT_CLASSROOM_PREFERENCES};}
  async savePreferences(accountId:string,preferences:ClassroomPreferences){await this.pool.query('INSERT INTO teeko_preferences(account_id,preferences,updated_at) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET preferences=EXCLUDED.preferences,updated_at=EXCLUDED.updated_at',[accountId,JSON.stringify(preferences),this.now()]);return preferences;}
  async courses(accountId:string){return this.tx(accountId,async db=>{
    const active=await db.query("SELECT * FROM teeko_classrooms WHERE account_id=$1 AND status<>'ended' FOR UPDATE",[accountId]);
    for(const row of active.rows){await this.settle(db,row);await this.save(db,row);}
    const result=await db.query('SELECT DISTINCT ON(id) manifest FROM teeko_courses ORDER BY id,published_at DESC');
    const history=await db.query('SELECT course_id,step_index,end_reason FROM teeko_classrooms WHERE account_id=$1 ORDER BY recorded_at DESC',[accountId]);
    const courses:CourseCard[]=result.rows.map(({manifest:course}:{manifest:PublishedCourse})=>{
      const last=history.rows.find(x=>x.course_id===course.id);const {pages:_pages,steps:_steps,...card}=course;void _pages;void _steps;
      return {...card,progress:{stepIndex:last?.step_index??0,completed:last?.end_reason==='content_completed'}};
    });
    const current=active.rows.find(row=>row.status!=='ended');
    return {courses,activeClassroom:current?{id:current.id,courseId:current.course_id,status:current.status}:null};
  });}
  async create(accountId:string,courseId:string,preferences?:ClassroomPreferences){return this.tx(accountId,async db=>{
    const unfinished=await db.query("SELECT * FROM teeko_classrooms WHERE account_id=$1 AND status<>'ended' FOR UPDATE",[accountId]);
    for(const row of unfinished.rows){await this.settle(db,row);await this.save(db,row);if(row.status!=='ended') fail('CLASSROOM_EXISTS','你还有一节未结束的课堂，请先继续或结束它。');}
    const profile=(await db.query('SELECT name,age_range,level FROM teeko_profiles WHERE account_id=$1',[accountId])).rows[0];
    if(!profile)fail('PROFILE_REQUIRED','请先填写孩子档案。');
    const selected=(await db.query('SELECT version FROM teeko_courses WHERE id=$1 ORDER BY published_at DESC LIMIT 1',[courseId])).rows[0];
    if(!selected)fail('COURSE_UNAVAILABLE','这门课程暂时不可用。',404);
    const used=Number((await db.query('SELECT milliseconds FROM teeko_classroom_usage WHERE account_id=$1 AND day_key=$2',[accountId,day(this.now())])).rows[0]?.milliseconds??0);
    const remaining=this.dailyMs-used;if(remaining<1000)fail('DAILY_LIMIT','今天的试上课时长已用完，明天再来。');
    const saved=(await db.query('SELECT preferences FROM teeko_preferences WHERE account_id=$1',[accountId])).rows[0]?.preferences;
    const id=randomUUID(),max=Math.min(this.maxMs,remaining),prefs=preferences??saved??{...DEFAULT_CLASSROOM_PREFERENCES};
    await db.query(`INSERT INTO teeko_classrooms(id,account_id,course_id,course_version,profile,preferences,status,max_ms,limit_reason,started_at,day_key) VALUES($1,$2,$3,$4,$5,$6,'preflight',$7,$8,$9,$10)`,[id,accountId,courseId,selected.version,JSON.stringify({name:profile.name,ageRange:profile.age_range,level:profile.level}),JSON.stringify(prefs),max,max<this.maxMs?'daily_limit':'time_limit',this.now(),day(this.now())]);
    const previous=(await db.query('SELECT step_index,helped_steps,end_reason FROM teeko_classrooms WHERE account_id=$1 AND course_id=$2 AND course_version=$3 AND id<>$4 ORDER BY recorded_at DESC LIMIT 1',[accountId,courseId,selected.version,id])).rows[0];
    if(previous&&previous.end_reason!=='content_completed')await db.query('UPDATE teeko_classrooms SET step_index=$2,helped_steps=$3 WHERE id=$1',[id,previous.step_index,JSON.stringify(previous.helped_steps)]);
    return this.snapshot(db,await this.row(db,accountId,id));
  });}
  async get(accountId:string,id:string){return this.tx(accountId,async db=>{const row=await this.row(db,accountId,id);await this.settle(db,row);await this.save(db,row);return this.snapshot(db,row);});}
  async claim(accountId:string,id:string){return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    if(row.status==='ended')fail('ENDED','这节课堂已经结束。');
    if(row.owner_token&&row.lease_until&&row.lease_until>this.now())fail('CONNECTION_EXISTS','这节课堂已在另一个窗口连接。');
    const used=Number((await db.query('SELECT milliseconds FROM teeko_classroom_usage WHERE account_id=$1 AND day_key=$2',[accountId,day(this.now())])).rows[0]?.milliseconds??0);
    if(used>=this.dailyMs)fail('DAILY_LIMIT','今天的试上课时长已用完，明天再来。');
    const available=Number(row.elapsed_ms)+this.dailyMs-used;
    if(available<Number(row.max_ms)){row.max_ms=available;row.limit_reason='daily_limit';}
    row.status='active';row.connection_epoch++;row.revision++;row.owner_token=randomUUID();row.active_since=this.now();row.lease_until=new Date(this.now().getTime()+15_000);
    await this.save(db,row);return {snapshot:await this.snapshot(db,row),epoch:row.connection_epoch,ownerToken:row.owner_token};
  });}
  async heartbeat(accountId:string,id:string,epoch:number,ownerToken:string){return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    if(row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==ownerToken){await this.save(db,row);return null;}
    row.lease_until=new Date(this.now().getTime()+15_000);await this.save(db,row);return this.snapshot(db,row);
  });}
  async release(accountId:string,id:string,epoch:number,ownerToken:string){return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);if(row.connection_epoch!==epoch||row.owner_token!==ownerToken)return;
    await this.settle(db,row);if(row.status==='active'){row.status='paused';row.revision++;row.active_since=null;row.owner_token=null;row.lease_until=null;}await this.save(db,row);
  });}
  async providerStarted(accountId:string,id:string,epoch:number,ownerToken:string,sessionId:string){return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    if(row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==ownerToken)fail('STALE','连接已过期。');
    if(!sessionId||sessionId.length>300)fail('PROVIDER_SESSION','上游没有返回有效会话。',502);
    await db.query('UPDATE teeko_classrooms SET provider_session_id=$2 WHERE id=$1',[id,sessionId]);await this.save(db,row);
  });}
  private feedback(row:Row,kind:ClassroomFeedback['kind'],message:string){row.feedback={id:randomUUID(),kind,message};}
  private advance(row:Row,course:PublishedCourse,status:ClassroomOutcome['status']){
    const step=course.steps[row.step_index];row.outcomes.push({stepId:step.id,status});row.step_index++;row.teacher_object_ids=[];
    if(row.step_index>=course.steps.length)this.finish(row,'content_completed');
  }
  async action(accountId:string,id:string,action:ClassroomAction){return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    const duplicate=await db.query('SELECT 1 FROM teeko_classroom_actions WHERE classroom_id=$1 AND event_id=$2',[id,action.eventId]);
    if(duplicate.rowCount){await this.save(db,row);return this.snapshot(db,row);}
    if(row.revision!==action.expectedRevision)fail('STALE','课堂状态已更新，请重试。');
    if(row.status==='ended'){if(action.type==='end')return this.snapshot(db,row);fail('ENDED','这节课堂已经结束。');}
    const course=await this.course(db,row),step=course.steps[row.step_index];
    if(action.type==='end')this.finish(row,'manual');
    else if(action.type==='pause'){row.status='paused';row.active_since=null;row.owner_token=null;row.lease_until=null;}
    else if(action.type==='resume'){if(row.status!=='paused')fail('STATE','这节课堂没有暂停。');row.status='preflight';}
    else {
      if(row.status!=='active')fail('STATE','请先连接课堂。');
      if(action.type==='hint'){if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);row.teacher_object_ids=step.targetId?[step.targetId]:[];this.feedback(row,'hint',step.hint);}
      else if(action.type==='skip'||action.type==='next'){this.feedback(row,'skipped','换一个试试。');this.advance(row,course,step.kind==='listen'&&action.type==='next'?'unassessed':'skipped');}
      else if(action.type==='select'){
        const ids=action.objectIds??[];
        if(step.kind!=='select'||ids.length!==1||!course.pages.find(x=>x.id===step.pageId)?.objects.some(x=>x.id===ids[0]))this.feedback(row,'ambiguous','请只选一个图案。');
        else if(ids[0]!==step.targetId){if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);this.feedback(row,'retry','再看看，'+step.hint);}
        else{this.feedback(row,'correct','找到了！');this.advance(row,course,row.helped_steps.includes(step.id)?'assisted':'independent');}
      }
    }
    row.revision++;await this.save(db,row);await db.query('INSERT INTO teeko_classroom_actions(classroom_id,event_id) VALUES($1,$2)',[id,action.eventId]);return this.snapshot(db,row);
  });}
  async transcript(accountId:string,id:string,epoch:number,token:string,event:Transcript){
    if(!event.final||!event.text.trim())return;
    return this.tx(accountId,async db=>{
      const row=await this.row(db,accountId,id);await this.settle(db,row);
      if(row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==token||event.contextKey!==`${id}:${epoch}:${row.step_index}`){await this.save(db,row);return;}
      await db.query('INSERT INTO teeko_classroom_transcripts(classroom_id,connection_epoch,item_id,role,text,step_index,created_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id,epoch,(event.itemId??randomUUID()).slice(0,200),event.role,event.text.slice(0,1000),row.step_index,this.now(),event.source??'speech']);
      await db.query('DELETE FROM teeko_classroom_transcripts WHERE classroom_id=$1 AND (connection_epoch,item_id,role) NOT IN (SELECT connection_epoch,item_id,role FROM teeko_classroom_transcripts WHERE classroom_id=$1 ORDER BY created_at DESC LIMIT 64)',[id]);
      await this.save(db,row);
    });
  }
  /** Vendor tool adherence is optional; only completed, task-bound evidence can progress. */
  async receiveTranscript(accountId:string,id:string,epoch:number,token:string,event:Transcript){
    await this.transcript(accountId,id,epoch,token,event);
    if(event.role==='child'&&event.final&&event.contextKey)await this.tool(accountId,id,epoch,token,'submit_spoken_answer',{contextKey:event.contextKey,answer:event.text});
  }
  async tool(accountId:string,id:string,epoch:number,token:string,name:string,args:unknown):Promise<{output:{status:string;english?:string;highlighted?:string[]};snapshot:ClassroomSnapshot}>{return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    if(row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==token){await this.save(db,row);return {output:{status:'unavailable'},snapshot:await this.snapshot(db,row)};}
    const course=await this.course(db,row),step=course.steps[row.step_index],data=(args&&typeof args==='object'?args:{}) as Record<string,unknown>;
    if(data.contextKey!==`${id}:${epoch}:${row.step_index}`){await this.save(db,row);return {output:{status:'retry',english:'That task is obsolete. Use only the newest application task.'},snapshot:await this.snapshot(db,row)};}
    const recent=(await db.query("SELECT item_id,text FROM teeko_classroom_transcripts WHERE classroom_id=$1 AND connection_epoch=$2 AND role='child' AND step_index=$3 AND consumed=false AND created_at>$4 ORDER BY created_at DESC LIMIT 1",[id,epoch,row.step_index,new Date(this.now().getTime()-60000)])).rows[0];
    let output:{status:string;english?:string;highlighted?:string[]}={status:'unavailable',english:'That check is unavailable. Continue with the current picture; do not claim to have inspected unknown marks.'};
    if(name==='delegate'){
      const spoken=recent?.text??'';const normalized=normalize(spoken);
      if(/\b(skip|another|next)\b|跳过|换一/.test(normalized)&&recent){name='skip';}
      else if(/circle|highlight|圈|标/.test(normalized)&&recent){name='highlight_objects';data.objectIds=course.pages[0].objects.filter(x=>normalized.includes(x.label)||normalized.includes(x.chinese)).map(x=>x.id);}
      else if(step.kind==='speak'&&recent){name='submit_spoken_answer';data.answer=spoken;}
      else output={status:'retry',english:`Continue naturally without forcing repetition. The current objective is: ${step.english}`};
    }
    if(name==='highlight_objects'){
      const ids=Array.isArray(data.objectIds)?data.objectIds.filter((x):x is string=>typeof x==='string'):[];
      if(ids.length&&ids.length<=5&&ids.every(x=>course.pages.find(p=>p.id===step.pageId)?.objects.some(o=>o.id===x))){row.teacher_object_ids=ids;if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);row.revision++;this.feedback(row,'hint','老师标出了图案。');output={status:'confirmed',highlighted:ids,english:'The application has drawn the requested highlight. You may refer to it. This is help, not an independently correct answer.'};}
    }else if(name==='skip'&&recent){this.advance(row,course,'skipped');row.revision++;output={status:'confirmed',english:'The learner chose to skip. Respect the choice and continue with the next objective.'};}
    else if(name==='submit_spoken_answer'){
      const answer=typeof data.answer==='string'?normalize(data.answer):'';const evidence=recent?normalize(recent.text):'';
      const matches=step.expected?.split('|').some(word=>new RegExp(`\\b${word.endsWith('y')?word.slice(0,-1)+'(?:y|ies)':word+'s?'}\\b`,'i').test(evidence));
      const negativeOrUnclear=/\b(not|no|never|don t|doesn t|can t|cannot|won t|skip|help|wait|stop|maybe|or)\b|不|没|别|跳过|不会|等等/.test(evidence);
      const fruitCount=course.words.filter(word=>new RegExp(`\\b${word.endsWith('y')?word.slice(0,-1)+'(?:y|ies)':word+'s?'}\\b`,'i').test(evidence)).length;
      if(step.kind==='speak'&&recent&&answer&&evidence&&(evidence.includes(answer)||answer.includes(evidence))&&matches&&!negativeOrUnclear&&fruitCount===1){
        await db.query('UPDATE teeko_classroom_transcripts SET consumed=true WHERE classroom_id=$1 AND connection_epoch=$2 AND item_id=$3 AND role=\'child\'',[id,epoch,recent.item_id]);
        this.feedback(row,'correct','说出来了！');this.advance(row,course,row.helped_steps.includes(step.id)?'assisted':'independent');row.revision++;
        output={status:'confirmed',english:'The completed transcript contains the target expression. Give brief specific encouragement, then follow the next application objective. This confirms words only, not pronunciation quality.'};
      }else output={status:'retry',english:'A completed matching learner answer has not been confirmed. Give one gentle cue or accept skipping. Never claim a pronunciation score or force repetition.'};
    }
    await this.save(db,row);return {output,snapshot:await this.snapshot(db,row)};
  });}
}
