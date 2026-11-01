import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {ClassroomService} from '../lib/server/classroom-service';
import {publishTrialCourses} from '../lib/server/course-catalog';

const database=process.env.TEST_DATABASE_URL;
if(database){const url=new URL(database);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/.test(url.pathname))throw new Error('A loopback disposable test database is required.');}
test('recent classroom summaries are bounded, newest first, persisted and owned by the signed-in account',{skip:!database},async t=>{
 const admin=new Pool({connectionString:database}),schema=`classroom_history_test_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:database,options:`-c search_path=${schema},public`});
 t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 for(const file of ['0001_accounts.sql','0002_classrooms.sql'])await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
 await publishTrialCourses(pool);
 const owner=randomUUID(),other=randomUUID();
 for(const id of [owner,other]){
  await pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,'synthetic','v1',now(),now())",[id,`${id}@example.test`]);
  await pool.query("INSERT INTO teeko_profiles(account_id,name,age_range,level,updated_at) VALUES($1,'Test learner','10–11','unsure',now())",[id]);
 }
 let clock=new Date('2026-11-01T00:00:00Z');const service=new ClassroomService(pool,{now:()=>new Date(clock)});
 const ids:string[]=[];
 for(let i=0;i<8;i++){
  const state=await service.create(owner,'picnic');ids.unshift(state.id);
  await service.action(owner,state.id,{eventId:randomUUID(),expectedRevision:state.revision,type:'end'});
  clock=new Date(clock.getTime()+1000);
 }
 const foreign=await service.create(other,'picnic');await service.action(other,foreign.id,{eventId:randomUUID(),expectedRevision:foreign.revision,type:'end'});
 const current=await service.create(owner,'picnic');
 const catalog=await service.courses(owner);
 assert.deepEqual(catalog.recentClassrooms.map(item=>item.id),ids.slice(0,6));
 assert.equal(catalog.activeClassroom?.id,current.id);
 assert(catalog.recentClassrooms.every(item=>item.courseTitle==='一起去野餐'&&item.endReason==='manual'&&item.endedAt&&item.elapsedSeconds===0));
 const reloaded=new ClassroomService(pool);
 assert.equal((await reloaded.get(owner,ids[0])).status,'ended');
 await assert.rejects(reloaded.get(other,ids[0]));
 assert(!JSON.stringify(catalog.recentClassrooms).includes('password_hash'));
});
