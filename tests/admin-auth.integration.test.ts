import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {AdminAuthService,AdminAuthError} from '../lib/server/admin-auth';
import {AccountService} from '../lib/server/account-service';
import {newToken,protectedDigest,verifyPassword} from '../lib/server/auth-crypto';
const database=process.env.TEST_DATABASE_URL,secret='synthetic-admin-protection-value-over-thirty-two-bytes',password='fixture-admin-password';
if(database){const url=new URL(database);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/.test(url.pathname))throw new Error('A loopback disposable test database is required.');}
async function fixture(t:TestContext){
 const admin=new Pool({connectionString:database}),schema=`admin_auth_test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:database,options:`-c search_path=${schema},public`,max:8});t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 for(const name of ['0001_accounts.sql','0002_classrooms.sql','0003_teacher_agents.sql','0004_admin_auth.sql'])await pool.query(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
 let now=new Date('2026-11-01T01:00:00Z');const options={secret,now:()=>new Date(now)},auth=new AdminAuthService(pool,options);
 return {pool,auth,options,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
const rejectsCode=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,error=>error instanceof AdminAuthError&&error.code===code);
test('dedicated admin credentials and sessions are isolated, revocable and bounded',{skip:!database},async t=>{
 await t.test('provision creates an internal actor and only the dedicated credential authenticates',async t=>{
  const f=await fixture(t);const created=await f.auth.provision('admin',password),logged=await f.auth.login('admin',password);
  assert.equal(logged.user.id,created.accountId);assert.equal(logged.user.username,'admin');assert.equal((await f.auth.session(logged.sessionToken))?.id,created.accountId);
  const row=(await f.pool.query('SELECT * FROM teeko_accounts WHERE id=$1',[created.accountId])).rows[0];assert.equal(row.consent_version,'internal-admin');assert.equal(await verifyPassword(password,row.password_hash),false);
  const stored=(await f.pool.query('SELECT token_hash FROM teeko_admin_sessions')).rows[0];assert.notEqual(stored.token_hash,logged.sessionToken);
  const ordinary=new AccountService(f.pool,{...f.options,sendCode:async()=>{throw new Error('not used');}});assert.equal(await ordinary.session(logged.sessionToken),null);
  await assert.rejects(ordinary.login(row.email,password));
 });
 await t.test('student tokens never grant admin and admin logout does not revoke students',async t=>{
  const f=await fixture(t),id=randomUUID(),studentToken=newToken();
  await f.pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,'student@example.test','synthetic','v1',$2,$2)",[id,f.options.now()]);
  await f.pool.query('INSERT INTO teeko_sessions(token_hash,account_id,auth_version,expires_at,created_at) VALUES($1,$2,0,$3,$4)',[protectedDigest(secret,'session',studentToken),id,new Date(f.options.now().getTime()+86400000),f.options.now()]);
  const ordinary=new AccountService(f.pool,{...f.options,sendCode:async()=>{throw new Error('not used');}});
  assert.equal(await f.auth.session(studentToken),null);await f.auth.provision('admin',password);const logged=await f.auth.login('admin',password);
  await f.auth.logout(logged.sessionToken);assert.equal(await f.auth.session(logged.sessionToken),null);assert.equal((await ordinary.session(studentToken))?.id,id);
 });
 await t.test('reprovision preserves the actor, changes the credential version and revokes old sessions',async t=>{
  const f=await fixture(t),created=await f.auth.provision('admin',password),old=await f.auth.login('admin',password);
  const updated=await f.auth.provision('admin','fixture-changed-password');assert.equal(updated.accountId,created.accountId);assert.equal(await f.auth.session(old.sessionToken),null);
  await rejectsCode(f.auth.login('admin',password),'LOGIN_INVALID');assert((await f.auth.login('admin','fixture-changed-password')).sessionToken);
  assert.equal((await f.pool.query('SELECT count(*)::int count FROM teeko_accounts')).rows[0].count,1);
 });
 await t.test('expiry, credential version and administrator role are rechecked for every session',async t=>{
  const f=await fixture(t),created=await f.auth.provision('admin',password),logged=await f.auth.login('admin',password);
  f.advance(8*3600000);assert.equal(await f.auth.session(logged.sessionToken),null);
  const next=await f.auth.login('admin',password);await f.pool.query('UPDATE teeko_admin_credentials SET auth_version=auth_version+1 WHERE account_id=$1',[created.accountId]);assert.equal(await f.auth.session(next.sessionToken),null);
  const third=await f.auth.login('admin',password);await f.pool.query('DELETE FROM teeko_admin_accounts WHERE account_id=$1',[created.accountId]);assert.equal(await f.auth.session(third.sessionToken),null);
  await f.pool.query('INSERT INTO teeko_admin_accounts(account_id) VALUES($1)',[created.accountId]);assert.equal(await f.auth.session(third.sessionToken),null);
 });
 await t.test('bad credentials have one safe error and persisted rate limits contain no usernames',async t=>{
  const f=await fixture(t);await f.auth.provision('admin',password);
  for(let i=0;i<10;i++)await rejectsCode(f.auth.login('admin','wrong-fixture-password'),'LOGIN_INVALID');
  await rejectsCode(f.auth.login('admin',password),'RATE_LIMITED');
  const limits=(await f.pool.query('SELECT key FROM teeko_auth_limits')).rows;assert(limits.length>=2);assert(limits.every(row=>/^[a-f0-9]{64}$/.test(row.key)));
  f.advance(901000);await rejectsCode(f.auth.login('missing','wrong-fixture-password'),'LOGIN_INVALID');
 });
});
