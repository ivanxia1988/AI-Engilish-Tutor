import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {prepareProduction} from '../scripts/prepare-production';
import {AdminAuthService} from '../lib/server/admin-auth';
import {ModelCredentialsService} from '../lib/server/model-credentials';
import {DEFAULT_TEACHER_MODELS} from '../lib/teacher-agent';
const database=process.env.TEST_DATABASE_URL;
test('production preparation migrates, imports defaults and never rotates an existing administrator on redeploy',{skip:!database},async t=>{
 assert(database);const url=new URL(database);assert(['127.0.0.1','localhost'].includes(url.hostname)&&/test/.test(url.pathname));
 const admin=new Pool({connectionString:url.href}),schema=`bootstrap_test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema},public`);const pool=new Pool({connectionString:url.href});
 t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 const environment={DATABASE_URL:url.href,AUTH_SECRET:'synthetic-bootstrap-secret-at-least-32-bytes',ADMIN_BOOTSTRAP_PASSWORD:'synthetic-first-password',OPENAI_API_KEY:'synthetic-openai-key',DASHSCOPE_API_KEY:'synthetic-qwen-key',DASHSCOPE_WORKSPACE_ID:'fixture-space'};
 const first=await prepareProduction(environment);assert.equal(first.initializedAdmin,true);assert.equal(first.importedModels,5);
 const auth=new AdminAuthService(pool,{secret:environment.AUTH_SECRET}),login=await auth.login('admin',environment.ADMIN_BOOTSTRAP_PASSWORD);
 const second=await prepareProduction({...environment,ADMIN_USERNAME:' Admin ',ADMIN_BOOTSTRAP_PASSWORD:'synthetic-different-password'});assert.equal(second.initializedAdmin,false);assert.equal(second.importedModels,0);assert(await auth.session(login.sessionToken));
 await auth.login('admin',environment.ADMIN_BOOTSTRAP_PASSWORD);
 const credentials=new ModelCredentialsService(pool,{secret:environment.AUTH_SECRET,environment:key=>Reflect.get(environment,key)});
 for(const entry of DEFAULT_TEACHER_MODELS){const status=await credentials.status(login.user.id,entry.id);assert.equal(status.source,'model');assert.equal(status.configured,true);}
 const third=await prepareProduction({...environment,ADMIN_BOOTSTRAP_PASSWORD:undefined});assert.equal(third.initializedAdmin,false);
});
