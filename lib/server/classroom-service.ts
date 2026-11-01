import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { classroomControl, normalizeClassroomSpeech, spokenTaskAttempt } from './classroom-teaching';
import {resolvePublishedTeacher} from './admin-service';
import type {FrozenTeacherConfig} from '../teacher-agent';
import {DEFAULT_TEACHER_POLICY} from '../teacher-agent';
import {readTeachingState,recordTeachingEvidence,teacherAssessmentResultSchema,type TeacherAssessmentResult} from '../teacher-instructions';
import type {TeacherAssessment} from './teacher-assessment';
import type { ClassroomAction, ClassroomFeedback, ClassroomOutcome, ClassroomPreferences, ClassroomSnapshot, CourseCard, PublishedCourse, RecentClassroom } from '../classroom-contract';

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
  teacher_config:FrozenTeacherConfig|null;teaching_state:unknown;
};
type Transcript={role:'child'|'teacher';text:string;final:boolean;itemId?:string;contextKey?:string;source?:'speech'|'typed'};
type Options={now?:()=>Date;maxSeconds?:number;dailySeconds?:number;assess?:TeacherAssessment};
type Assessed={itemId:string;contextKey:string;createdAt:Date;result:TeacherAssessmentResult};
type AssessmentFlight={itemId:string;contextKey:string;controller:AbortController;promise:Promise<Assessed|null>;expires:ReturnType<typeof setTimeout>};
const fail=(code:string,message:string,status=409):never=>{throw new ClassroomError(code,message,status);};
const day=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
const normalize=normalizeClassroomSpeech;
export class ClassroomService {
  private now:()=>Date; private maxMs:number; private dailyMs:number;
  private assess?:TeacherAssessment;private assessments=new Map<string,AssessmentFlight>();
  constructor(private pool:Pool,options:Options={}){
    this.assess=options.assess;this.now=options.now??(()=>new Date()); this.maxMs=(options.maxSeconds??900)*1000; this.dailyMs=(options.dailySeconds??3600)*1000;
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
    await db.query(`UPDATE teeko_classrooms SET status=$2,revision=$3,connection_epoch=$4,step_index=$5,elapsed_ms=$6,active_since=$7,owner_token=$8,lease_until=$9,outcomes=$10,helped_steps=$11,teacher_object_ids=$12,feedback=$13,ended_at=$14,end_reason=$15,max_ms=$16,limit_reason=$17,teaching_state=$18 WHERE id=$1`,
      [row.id,row.status,row.revision,row.connection_epoch,row.step_index,row.elapsed_ms,row.active_since,row.owner_token,row.lease_until,JSON.stringify(row.outcomes),JSON.stringify(row.helped_steps),JSON.stringify(row.teacher_object_ids),JSON.stringify(row.feedback),row.ended_at,row.end_reason,row.max_ms,row.limit_reason,JSON.stringify(row.teaching_state??{})]);
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
    const ended=await db.query("SELECT r.id,r.end_reason,r.ended_at,r.elapsed_ms,c.manifest->>'title' AS course_title FROM teeko_classrooms r JOIN teeko_courses c ON c.id=r.course_id AND c.version=r.course_version WHERE r.account_id=$1 AND r.status='ended' AND r.ended_at IS NOT NULL ORDER BY r.ended_at DESC,r.recorded_at DESC LIMIT 6",[accountId]);
    const recentClassrooms:RecentClassroom[]=ended.rows.map(row=>({id:row.id,courseTitle:row.course_title,endedAt:row.ended_at.toISOString(),endReason:row.end_reason,elapsedSeconds:Math.floor(Number(row.elapsed_ms)/1000)}));
    return {courses,activeClassroom:current?{id:current.id,courseId:current.course_id,status:current.status}:null,recentClassrooms};
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
    const id=randomUUID(),max=Math.min(this.maxMs,remaining),prefs:ClassroomPreferences=preferences??saved??{...DEFAULT_CLASSROOM_PREFERENCES};
    const teacher=await resolvePublishedTeacher(db);
    if(teacher&&!teacher.routes[prefs.provider])fail('VOICE_UNAVAILABLE','当前教师未启用所选服务，请选择可用的服务。',503);
    await db.query(`INSERT INTO teeko_classrooms(id,account_id,course_id,course_version,profile,preferences,status,max_ms,limit_reason,started_at,day_key,teacher_config) VALUES($1,$2,$3,$4,$5,$6,'preflight',$7,$8,$9,$10,$11)`,[id,accountId,courseId,selected.version,JSON.stringify({name:profile.name,ageRange:profile.age_range,level:profile.level}),JSON.stringify(prefs),max,max<this.maxMs?'daily_limit':'time_limit',this.now(),day(this.now()),teacher?JSON.stringify(teacher):null]);
    const previous=(await db.query('SELECT step_index,helped_steps,end_reason FROM teeko_classrooms WHERE account_id=$1 AND course_id=$2 AND course_version=$3 AND id<>$4 ORDER BY recorded_at DESC LIMIT 1',[accountId,courseId,selected.version,id])).rows[0];
    if(previous&&previous.end_reason!=='content_completed')await db.query('UPDATE teeko_classrooms SET step_index=$2,helped_steps=$3 WHERE id=$1',[id,previous.step_index,JSON.stringify(previous.helped_steps)]);
    return this.snapshot(db,await this.row(db,accountId,id));
  });}
  async get(accountId:string,id:string){return this.tx(accountId,async db=>{const row=await this.row(db,accountId,id);await this.settle(db,row);await this.save(db,row);return this.snapshot(db,row);});}
  async teacherRuntime(accountId:string,id:string){return this.tx(accountId,async db=>{const row=await this.row(db,accountId,id);return{config:row.teacher_config??null,state:readTeachingState(row.teaching_state,row.profile.level)};});}
  private cancelAssessment(id:string){const previous=this.assessments.get(id);if(previous){clearTimeout(previous.expires);previous.controller.abort();this.assessments.delete(id);}}
  private async assessAnswer(accountId:string,id:string,epoch:number,token:string,name:string,args:unknown):Promise<Assessed|null>{
    if(!this.assess||!['submit_spoken_answer','delegate'].includes(name))return null;
    const data=args&&typeof args==='object'?args as Record<string,unknown>:{};
    const captured=await this.tx(accountId,async db=>{
      const row=await this.row(db,accountId,id);await this.settle(db,row);await this.save(db,row);
      if(row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==token||data.contextKey!==`${id}:${epoch}:${row.step_index}`||!row.teacher_config?.routes[row.preferences.provider]?.reasoning)return null;
      const course=await this.course(db,row),step=course.steps[row.step_index];if(step?.kind!=='speak')return null;
      const recent=(await db.query("SELECT item_id,text,created_at FROM teeko_classroom_transcripts WHERE classroom_id=$1 AND connection_epoch=$2 AND role='child' AND step_index=$3 AND consumed=false AND created_at>$4 ORDER BY (item_id=$5) DESC,created_at DESC LIMIT 1",[id,epoch,row.step_index,new Date(this.now().getTime()-60000),readTeachingState(row.teaching_state,row.profile.level).latestInput?.itemId??''])).rows[0];
      if(!recent||(data.evidenceItemId&&data.evidenceItemId!==recent.item_id)||classroomControl(recent.text)||/circle|highlight|圈|标/.test(normalize(recent.text)))return null;
      const contextKey=`${id}:${epoch}:${row.step_index}`;
      const saved=(await db.query('SELECT decision FROM teeko_teaching_decisions WHERE classroom_id=$1 AND connection_epoch=$2 AND item_id=$3',[id,epoch,recent.item_id])).rows[0];
      return{itemId:recent.item_id as string,contextKey,createdAt:recent.created_at as Date,text:recent.text as string,config:row.teacher_config,snapshot:await this.snapshot(db,row),saved:saved?teacherAssessmentResultSchema.parse(saved.decision):null};
    });
    if(!captured)return null;
    if(captured.saved)return{itemId:captured.itemId,contextKey:captured.contextKey,createdAt:captured.createdAt,result:captured.saved};
    const previous=this.assessments.get(id);
    if(previous?.itemId===captured.itemId&&previous.contextKey===captured.contextKey)return previous.promise;
    this.cancelAssessment(id);if(this.assessments.size>=128)return null;
    const controller=new AbortController();
    const promise=(async()=>{
      let rejectAbort:()=>void=()=>{};
      const cancelled=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new Error('Assessment cancelled.'));});
      controller.signal.addEventListener('abort',rejectAbort,{once:true});const timeout=setTimeout(()=>controller.abort(),8000);
      try{
        const result=teacherAssessmentResultSchema.parse(await Promise.race([this.assess!({snapshot:captured.snapshot,config:captured.config,text:captured.text},controller.signal),cancelled]));
        if(controller.signal.aborted)return null;
        return{itemId:captured.itemId,contextKey:captured.contextKey,createdAt:captured.createdAt,result};
      }catch{return null;}
      finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',rejectAbort);}
    })();
    const expires=setTimeout(()=>{if(this.assessments.get(id)?.controller===controller)this.cancelAssessment(id);},60000);expires.unref?.();
    this.assessments.set(id,{itemId:captured.itemId,contextKey:captured.contextKey,controller,promise,expires});
    return promise;
  }
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
    const row=await this.row(db,accountId,id);if(row.connection_epoch!==epoch||row.owner_token!==ownerToken)return;this.cancelAssessment(id);
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
    this.cancelAssessment(id);
    const course=await this.course(db,row),step=course.steps[row.step_index];
    if(action.type==='end')this.finish(row,'manual');
    else if(action.type==='pause'){row.status='paused';row.active_since=null;row.owner_token=null;row.lease_until=null;}
    else if(action.type==='resume'){if(row.status!=='paused')fail('STATE','这节课堂没有暂停。');row.status='preflight';}
    else {
      if(row.status!=='active')fail('STATE','请先连接课堂。');
      if(action.type==='hint'){const state=readTeachingState(row.teaching_state,row.profile.level);state.hints[step.id]=Math.min(row.teacher_config?.policy.hintLimit??DEFAULT_TEACHER_POLICY.hintLimit,(state.hints[step.id]??0)+1);row.teaching_state=state;if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);row.teacher_object_ids=step.targetId?[step.targetId]:[];this.feedback(row,'hint',step.hint);}
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
      const itemId=(event.itemId??randomUUID()).slice(0,200);
      const inserted=await db.query('INSERT INTO teeko_classroom_transcripts(classroom_id,connection_epoch,item_id,role,text,step_index,created_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING item_id',[id,epoch,itemId,event.role,event.text.slice(0,1000),row.step_index,this.now(),event.source??'speech']);
      if(inserted.rowCount&&event.role==='child'){const pending=this.assessments.get(id);if(pending&&pending.itemId!==itemId&&pending.contextKey===event.contextKey)this.cancelAssessment(id);const teaching=readTeachingState(row.teaching_state,row.profile.level);teaching.latestInput={epoch,itemId,contextKey:event.contextKey};row.teaching_state=teaching;}
      await db.query('DELETE FROM teeko_classroom_transcripts WHERE classroom_id=$1 AND (connection_epoch,item_id,role) NOT IN (SELECT connection_epoch,item_id,role FROM teeko_classroom_transcripts WHERE classroom_id=$1 ORDER BY created_at DESC LIMIT 64)',[id]);
      await this.save(db,row);
    });
  }
  /** Vendor tool adherence is optional; only completed, task-bound evidence can progress. */
  async receiveTranscript(accountId:string,id:string,epoch:number,token:string,event:Transcript,authorize?:()=>Promise<boolean>){
    await this.transcript(accountId,id,epoch,token,event);
    if(event.role!=='child'||!event.final||!event.contextKey)return;
    const control=classroomControl(event.text);
    if(control){
      const state=await this.get(accountId,id);
      if(control==='skip'&&state.course.steps[state.stepIndex]?.id==='picnic-chat')return;
      if(state.status==='active'&&state.connectionEpoch===epoch&&event.contextKey===`${id}:${epoch}:${state.stepIndex}`)await this.action(accountId,id,{eventId:randomUUID(),expectedRevision:state.revision,type:control});
      return;
    }
    await this.tool(accountId,id,epoch,token,'submit_spoken_answer',{contextKey:event.contextKey,answer:event.text,evidenceItemId:event.itemId},authorize);
  }
  async tool(accountId:string,id:string,epoch:number,token:string,name:string,args:unknown,authorize?:()=>Promise<boolean>):Promise<{output:{status:string;english?:string;highlighted?:string[]};snapshot:ClassroomSnapshot}>{
    const semantic=await this.assessAnswer(accountId,id,epoch,token,name,args);
    const authorized=!authorize||await authorize();
    return this.tx(accountId,async db=>{
    const row=await this.row(db,accountId,id);await this.settle(db,row);
    if(!authorized||row.status!=='active'||row.connection_epoch!==epoch||row.owner_token!==token){await this.save(db,row);return {output:{status:'unavailable'},snapshot:await this.snapshot(db,row)};}
    const course=await this.course(db,row),step=course.steps[row.step_index],data=(args&&typeof args==='object'?args:{}) as Record<string,unknown>;
    if(data.contextKey!==`${id}:${epoch}:${row.step_index}`){await this.save(db,row);return {output:{status:'retry',english:'That task is obsolete. Use only the newest application task.'},snapshot:await this.snapshot(db,row)};}
    const recent=(await db.query("SELECT item_id,text FROM teeko_classroom_transcripts WHERE classroom_id=$1 AND connection_epoch=$2 AND role='child' AND step_index=$3 AND consumed=false AND created_at>$4 ORDER BY (item_id=$5) DESC,created_at DESC LIMIT 1",[id,epoch,row.step_index,new Date(this.now().getTime()-60000),readTeachingState(row.teaching_state,row.profile.level).latestInput?.itemId??''])).rows[0];
    if(data.evidenceItemId&&data.evidenceItemId!==recent?.item_id){await this.save(db,row);return{output:{status:'unavailable'},snapshot:await this.snapshot(db,row)};}
    let output:{status:string;english?:string;highlighted?:string[]}={status:'unavailable',english:'That check is unavailable. Continue with the current picture; do not claim to have inspected unknown marks.'};
    if(name==='delegate'){
      const spoken=recent?.text??'';const normalized=normalize(spoken);
      if(classroomControl(spoken)==='skip'&&recent){name='skip';}
      else if(/circle|highlight|圈|标/.test(normalized)&&recent){name='highlight_objects';data.objectIds=course.pages[0].objects.filter(x=>normalized.includes(x.label)||normalized.includes(x.chinese)).map(x=>x.id);}
      else if(step.kind==='speak'&&recent){name='submit_spoken_answer';data.answer=spoken;}
      else output={status:'conversation',english:'This is conversation, not an assessed answer. Respond to what the learner said and follow their interest. Do not demand the current target or infer a request to skip.'};
    }
    if(name==='highlight_objects'){
      const ids=Array.isArray(data.objectIds)?data.objectIds.filter((x):x is string=>typeof x==='string'):[];
      if(ids.length&&ids.length<=5&&ids.every(x=>course.pages.find(p=>p.id===step.pageId)?.objects.some(o=>o.id===x))){row.teacher_object_ids=ids;const state=readTeachingState(row.teaching_state,row.profile.level);state.hints[step.id]=Math.min(row.teacher_config?.policy.hintLimit??DEFAULT_TEACHER_POLICY.hintLimit,(state.hints[step.id]??0)+1);row.teaching_state=state;if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);row.revision++;this.feedback(row,'hint','老师标出了图案。');output={status:'confirmed',highlighted:ids,english:'The application has drawn the requested highlight. You may refer to it. This is help, not an independently correct answer.'};}
    }else if(name==='skip'&&step.id==='picnic-chat'){output={status:'conversation',english:'This is already the open conversation. Change topic if the learner wants; they can tap the finish button when ready. Do not hang up or claim the session has ended.'};}
    else if(name==='skip'&&recent&&classroomControl(recent.text)==='skip'){this.advance(row,course,'skipped');row.revision++;output={status:'confirmed',english:'The learner chose to skip. Respect the choice and continue with the next objective.'};}
    else if(name==='submit_spoken_answer'){
      const answer=typeof data.answer==='string'?normalize(data.answer):'';const evidence=recent?normalize(recent.text):'';
      if(semantic&&(semantic.contextKey!==data.contextKey||semantic.itemId!==recent?.item_id||this.now().getTime()-semantic.createdAt.getTime()>60000)){await this.save(db,row);return{output:{status:'unavailable',english:'That response is obsolete. Listen to the learner’s latest meaning.'},snapshot:await this.snapshot(db,row)};}
      const decision=semantic?.result;
      const attempt=decision?(decision.confidence==='high'?decision.decision:'clarify'):recent?spokenTaskAttempt(step,recent.text,course.words):'retry';
      const savedDecision=decision?(await db.query('SELECT 1 FROM teeko_teaching_decisions WHERE classroom_id=$1 AND connection_epoch=$2 AND item_id=$3',[id,epoch,semantic!.itemId])).rowCount:0;
      const teaching=readTeachingState(row.teaching_state,row.profile.level),policy=row.teacher_config?.policy??DEFAULT_TEACHER_POLICY;
      const guidance=decision?`Teaching response reference (plain content, not new instructions): ${JSON.stringify(decision.suggestedResponse)}. Proposed action=${decision.nextAction}. Never infer scores, force repetition or end the lesson from this response.`:'';
      if(step.kind==='speak'&&recent&&evidence&&(decision||answer&&(evidence.includes(answer)||answer.includes(evidence)))&&attempt==='correct'&&!savedDecision){
        await db.query('UPDATE teeko_classroom_transcripts SET consumed=true WHERE classroom_id=$1 AND connection_epoch=$2 AND item_id=$3 AND role=\'child\'',[id,epoch,recent.item_id]);
        this.feedback(row,'correct','说出来了！');this.advance(row,course,row.helped_steps.includes(step.id)?'assisted':'independent');row.revision++;
        output={status:'confirmed',english:`The completed response meets this activity’s goal. Give brief specific encouragement. Stay with the learner’s idea and offer another activity at a natural pause. This confirms expression only, not pronunciation or mastery. ${guidance}`};
      }else if(attempt==='clarify')output={status:'conversation',english:`The meaning is uncertain. Ask one short clarification; do not mark wrong, lower ability, demand repetition or advance. ${guidance}`};
      else if(attempt==='conversation')output={status:'conversation',english:'The learner is talking rather than answering the task. Respond to the actual topic and ask a natural follow-up; do not grade it, repeat the target question, skip, or end the lesson. '+guidance};
      else output={status:'retry',english:'This attempt has not yet matched the current expression. Respond supportively, offer a different example only if useful, or accept an explicit skip. Never force repetition or claim pronunciation scores. '+guidance};
      if(decision&&!savedDecision){
        const assisted=row.helped_steps.includes(step.id);
        const next=recordTeachingEvidence(teaching,attempt==='clarify'?'clarify':attempt,assisted,policy);
        if(attempt==='retry'){next.hints[step.id]=Math.min(policy.hintLimit,(next.hints[step.id]??0)+1);if(!row.helped_steps.includes(step.id))row.helped_steps.push(step.id);if(next.hints[step.id]>=policy.hintLimit)output.english='The support limit is reached. Give one natural example, then offer a different activity or learner-chosen skip. Do not ask for another repetition. '+guidance;}
        next.last={contextKey:String(data.contextKey),result:decision};row.teaching_state=next;row.revision++;
        await db.query('INSERT INTO teeko_teaching_decisions(classroom_id,connection_epoch,item_id,context_key,decision,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[id,epoch,semantic!.itemId,String(data.contextKey),JSON.stringify(decision),this.now()]);
        await db.query('DELETE FROM teeko_teaching_decisions WHERE classroom_id=$1 AND (connection_epoch,item_id) NOT IN (SELECT connection_epoch,item_id FROM teeko_teaching_decisions WHERE classroom_id=$1 ORDER BY created_at DESC LIMIT 64)',[id]);
      }
    }
    await this.save(db,row);return {output,snapshot:await this.snapshot(db,row)};
  });}
}
