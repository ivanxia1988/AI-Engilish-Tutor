import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {DUMMY_PASSWORD_HASH,hashPassword,newToken,protectedDigest,validPassword,verifyPassword} from './auth-crypto';

export type AdminUser={id:string;username:string};
export class AdminAuthError extends Error{constructor(public code:string,message:string,public status=400){super(message);}}
const TOKEN=/^[A-Za-z0-9_-]{43}$/,USERNAME=/^[a-z][a-z0-9_-]{2,31}$/,SESSION_MS=8*3600000;
const invalid=()=>new AdminAuthError('LOGIN_INVALID','用户名或密码不正确。',401);
type Credential={username:string;account_id:string;password_hash:string;auth_version:number};
export class AdminAuthService{
 private readonly secret:string;private readonly now:()=>Date;
 constructor(private readonly pool:Pool,options:{secret:string;now?:()=>Date}){
  if(Buffer.byteLength(options.secret,'utf8')<32)throw new Error('管理员保护密钥尚未配置。');this.secret=options.secret;this.now=options.now??(()=>new Date());
 }
 private async transaction<T>(work:(db:PoolClient)=>Promise<T>):Promise<T>{const db=await this.pool.connect();try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
 private username(value:string){return typeof value==='string'?value.trim().toLowerCase():'';}
 private digest(token:string){return protectedDigest(this.secret,'admin-session',token);}
 private async limit(scope:string,max:number,seconds:number){
  const now=this.now(),result=await this.pool.query(`INSERT INTO teeko_auth_limits(key,count,started_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN teeko_auth_limits.started_at <= $3 THEN 1 ELSE teeko_auth_limits.count+1 END,started_at=CASE WHEN teeko_auth_limits.started_at <= $3 THEN $2 ELSE teeko_auth_limits.started_at END RETURNING count`,[protectedDigest(this.secret,'admin-login-limit',scope),now,new Date(now.getTime()-seconds*1000)]);
  if(Number(result.rows[0].count)>max)throw new AdminAuthError('RATE_LIMITED','登录尝试过多，请稍后再试。',429);
 }
 /** Operator-only provisioning; no public registration route exists. */
 async provision(usernameInput:string,password:string):Promise<{accountId:string;username:string}>{
  const username=this.username(usernameInput);if(!USERNAME.test(username)||!validPassword(password))throw new AdminAuthError('INVALID_INPUT','用户名或密码格式无效。');
  const encoded=await hashPassword(password),ordinaryHash=await hashPassword(newToken());
  return this.transaction(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtext('teeko-admin-provision'))");
   const previous=(await db.query<Credential>('SELECT * FROM teeko_admin_credentials WHERE username=$1 FOR UPDATE',[username])).rows[0];
   const email=`${username}@operator.teeko.invalid`,now=this.now();
   const account=(await db.query<{id:string;consent_version:string;email:string}>('SELECT id,consent_version,email FROM teeko_accounts WHERE id=$1 OR email=$2 FOR UPDATE',[previous?.account_id??null,email])).rows;
   if(account.some(row=>row.consent_version!=='internal-admin'||row.email!==email)||account.length>1)throw new AdminAuthError('PROVISION_CONFLICT','管理员账号与已有记录冲突。',409);
   const accountId=account[0]?.id??randomUUID();
   if(!account.length)await db.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,$3,'internal-admin',$4,$4)",[accountId,email,ordinaryHash,now]);
   else{await db.query('UPDATE teeko_accounts SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1',[accountId,ordinaryHash]);await db.query('DELETE FROM teeko_sessions WHERE account_id=$1',[accountId]);}
   await db.query('INSERT INTO teeko_admin_accounts(account_id,granted_at) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING',[accountId,now]);
   await db.query('INSERT INTO teeko_admin_credentials(username,account_id,password_hash,auth_version,updated_at) VALUES($1,$2,$3,0,$4) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,auth_version=teeko_admin_credentials.auth_version+1,updated_at=EXCLUDED.updated_at',[username,accountId,encoded,now]);
   await db.query('DELETE FROM teeko_admin_sessions WHERE account_id=$1',[accountId]);return {accountId,username};
  });
 }
 async login(usernameInput:string,password:string):Promise<{sessionToken:string;user:AdminUser}>{
  const username=this.username(usernameInput);await this.limit('global',60,60);await this.limit(`username:${USERNAME.test(username)?username:'invalid'}`,10,900);
  const before=USERNAME.test(username)?(await this.pool.query<Credential>('SELECT * FROM teeko_admin_credentials WHERE username=$1',[username])).rows[0]:undefined;
  const matched=await verifyPassword(typeof password==='string'?password:'',before?.password_hash??DUMMY_PASSWORD_HASH);if(!before||!matched)throw invalid();
  return this.transaction(async db=>{
   const current=(await db.query<Credential>("SELECT c.* FROM teeko_admin_credentials c JOIN teeko_admin_accounts r ON r.account_id=c.account_id JOIN teeko_accounts a ON a.id=c.account_id WHERE c.username=$1 AND a.consent_version='internal-admin' FOR UPDATE OF c FOR SHARE OF r",[username])).rows[0];
   if(!current||current.password_hash!==before.password_hash||current.auth_version!==before.auth_version)throw invalid();
   const token=newToken(),now=this.now();await db.query('DELETE FROM teeko_admin_sessions WHERE account_id=$1 AND expires_at<=$2',[current.account_id,now]);
   await db.query('INSERT INTO teeko_admin_sessions(token_hash,account_id,auth_version,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',[this.digest(token),current.account_id,current.auth_version,new Date(now.getTime()+SESSION_MS),now]);return {sessionToken:token,user:{id:current.account_id,username:current.username}};
  });
 }
 async session(token?:string):Promise<AdminUser|null>{
  if(!TOKEN.test(token??''))return null;
  const row=(await this.pool.query<{id:string;username:string}>("SELECT c.account_id AS id,c.username FROM teeko_admin_sessions s JOIN teeko_admin_credentials c ON c.account_id=s.account_id AND c.auth_version=s.auth_version JOIN teeko_admin_accounts r ON r.account_id=c.account_id JOIN teeko_accounts a ON a.id=c.account_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND a.consent_version='internal-admin'",[this.digest(token!),this.now()])).rows[0];return row??null;
 }
 async logout(token?:string):Promise<void>{if(TOKEN.test(token??''))await this.pool.query('DELETE FROM teeko_admin_sessions WHERE token_hash=$1',[this.digest(token!)]);}
}
