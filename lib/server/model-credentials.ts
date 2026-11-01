import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {modelCredentialInputSchema,modelCredentialResetSchema,type ModelCredentialInput,type ModelCredentialReset,type ModelCredentialStatus,type ResolvedModelCredentials} from '../model-credentials';
import {DEFAULT_TEACHER_MODELS,type TeacherModel} from '../teacher-agent';

type Provider=TeacherModel['provider'];
type ModelIdentity=Pick<TeacherModel,'id'|'provider'>;
type Environment=(name:string)=>string|undefined;
type CredentialRow={model_id:string;provider:Provider;revision:number;version:number;ciphertext:Buffer|null;nonce:Buffer|null;auth_tag:Buffer|null;updated_at:Date};
export class ModelCredentialsError extends Error{constructor(public code:string,message:string,public status=409){super(message);}}
const fail=(code:string,message:string,status=409):never=>{throw new ModelCredentialsError(code,message,status);};
const unavailable=():never=>fail('CREDENTIALS_UNAVAILABLE','模型凭据暂时不可用，请检查配置。',503);
const identifier=(value:string)=>{if(!z.string().uuid().safeParse(value).success)fail('INVALID_INPUT','模型或账号标识无效。',400);return value;};
const providerSchema=z.enum(['qwen','openai']);
const normalized=(value:ModelCredentialInput):ResolvedModelCredentials=>value.provider==='qwen'?{apiKey:value.apiKey,workspaceId:value.workspaceId,region:value.region}:{apiKey:value.apiKey};
const aad=(identity:ModelIdentity)=>Buffer.from(JSON.stringify({version:1,modelId:identity.id,provider:identity.provider}));

export class ModelCredentialsService{
 private readonly key:Buffer;private readonly environment:Environment;private readonly now:()=>Date;
 constructor(private readonly pool:Pool,options:{secret:string;environment?:Environment;now?:()=>Date}){
  if(typeof options.secret!=='string'||Buffer.byteLength(options.secret,'utf8')<32)throw new ModelCredentialsError('PROTECTION_UNAVAILABLE','模型凭据保护密钥尚未配置。',503);
  this.key=Buffer.from(hkdfSync('sha256',options.secret,'teeko-credentials','model-credentials/aes-256-gcm/v1',32));
  this.environment=options.environment??(name=>process.env[name]);this.now=options.now??(()=>new Date());
 }
 private async safely<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof ModelCredentialsError)throw error;throw new ModelCredentialsError('UNAVAILABLE','模型凭据服务暂时不可用，请稍后重试。',503);}}
 private async transaction<T>(work:(db:PoolClient)=>Promise<T>):Promise<T>{
  const db=await this.pool.connect();
  try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 private async authorized<T>(accountId:string,work:(db:PoolClient)=>Promise<T>):Promise<T>{
  identifier(accountId);
  return this.safely(()=>this.transaction(async db=>{
   if(!(await db.query('SELECT account_id FROM teeko_admin_accounts WHERE account_id=$1 FOR SHARE',[accountId])).rowCount)fail('FORBIDDEN','此账号没有管理权限。',403);
   return work(db);
  }));
 }
 private async identity(db:PoolClient,id:string):Promise<ModelIdentity>{
  identifier(id);const row=(await db.query('SELECT config FROM teeko_teacher_models WHERE id=$1 FOR SHARE',[id])).rows[0];if(!row)fail('NOT_FOUND','模型配置不存在。',404);
  const provider=providerSchema.safeParse(row.config?.provider);if(!provider.success)return unavailable();return{id,provider:provider.data};
 }
 private async row(db:Pick<PoolClient,'query'>,id:string):Promise<CredentialRow|undefined>{return(await db.query<CredentialRow>('SELECT * FROM teeko_model_credentials WHERE model_id=$1',[id])).rows[0];}
 private defaults(provider:Provider):ResolvedModelCredentials|undefined{
  try{
   const value=provider==='qwen'?{provider,expectedRevision:0,apiKey:this.environment('DASHSCOPE_API_KEY')??'',workspaceId:this.environment('DASHSCOPE_WORKSPACE_ID')??'',region:this.environment('DASHSCOPE_REGION')||'cn-beijing'}:{provider,expectedRevision:0,apiKey:this.environment('OPENAI_API_KEY')??''};
   const result=modelCredentialInputSchema.safeParse(value);return result.success?normalized(result.data):undefined;
  }catch{return undefined;}
 }
 private seal(identity:ModelIdentity,value:ResolvedModelCredentials){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(aad(identity));
  return{nonce,ciphertext:Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]),authTag:cipher.getAuthTag()};
 }
 private open(identity:ModelIdentity,row:CredentialRow):ResolvedModelCredentials{
  try{
   if(row.provider!==identity.provider||row.version!==1||!Buffer.isBuffer(row.ciphertext)||!Buffer.isBuffer(row.nonce)||!Buffer.isBuffer(row.auth_tag)||row.nonce.length!==12||row.auth_tag.length!==16)return unavailable();
   const cipher=createDecipheriv('aes-256-gcm',this.key,row.nonce);cipher.setAAD(aad(identity));cipher.setAuthTag(row.auth_tag);
   const value:unknown=JSON.parse(Buffer.concat([cipher.update(row.ciphertext),cipher.final()]).toString('utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value))return unavailable();
   const parsed=modelCredentialInputSchema.safeParse({...value,provider:identity.provider,expectedRevision:0});if(!parsed.success)return unavailable();return normalized(parsed.data);
  }catch{return unavailable();}
 }
 private describe(identity:ModelIdentity,row?:CredentialRow):ModelCredentialStatus{
  const base={provider:identity.provider,revision:row?.revision??0,updatedAt:row?.updated_at.toISOString()??null};
  if(row&&(row.provider!==identity.provider||row.ciphertext!==null)){
   let configured=false;try{this.open(identity,row);configured=true;}catch{}
   return{...base,source:'model',configured};
  }
  const configured=Boolean(this.defaults(identity.provider));return{...base,source:configured?'environment':'missing',configured};
 }
 async status(accountId:string,modelId:string):Promise<ModelCredentialStatus>{return this.authorized(accountId,async db=>{const identity=await this.identity(db,modelId);return this.describe(identity,await this.row(db,modelId));});}
 private async lock(db:PoolClient,id:string){await db.query("SELECT pg_advisory_xact_lock(hashtext('teeko-model-credential:' || $1))",[id]);}
 private validate<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);if(parsed.success)return parsed.data;return fail('INVALID_INPUT','请检查密钥、服务与配置版本。',400);}
 private async write(db:PoolClient,identity:ModelIdentity,expectedRevision:number,value:ResolvedModelCredentials|null):Promise<ModelCredentialStatus>{
  await this.lock(db,identity.id);const previous=await this.row(db,identity.id);if((previous?.revision??0)!==expectedRevision)fail('STALE','模型凭据已更新，请重新读取后再保存。');
  const sealed=value?this.seal(identity,value):null;
  const row=(await db.query<CredentialRow>('INSERT INTO teeko_model_credentials(model_id,provider,revision,version,ciphertext,nonce,auth_tag,updated_at) VALUES($1,$2,$3,1,$4,$5,$6,$7) ON CONFLICT(model_id) DO UPDATE SET provider=EXCLUDED.provider,revision=EXCLUDED.revision,version=EXCLUDED.version,ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,updated_at=EXCLUDED.updated_at RETURNING *',[identity.id,identity.provider,expectedRevision+1,sealed?.ciphertext??null,sealed?.nonce??null,sealed?.authTag??null,this.now()])).rows[0];
  return this.describe(identity,row);
 }
 async set(accountId:string,modelId:string,value:ModelCredentialInput):Promise<ModelCredentialStatus>{
  return this.authorized(accountId,async db=>{const input=this.validate(modelCredentialInputSchema,value),identity=await this.identity(db,modelId);if(identity.provider!==input.provider)fail('PROVIDER_MISMATCH','模型服务已变化，请重新读取后配置。');return this.write(db,identity,input.expectedRevision,normalized(input));});
 }
 async reset(accountId:string,modelId:string,value:ModelCredentialReset):Promise<ModelCredentialStatus>{
  return this.authorized(accountId,async db=>{const input=this.validate(modelCredentialResetSchema,value),identity=await this.identity(db,modelId);if(identity.provider!==input.provider)fail('PROVIDER_MISMATCH','模型服务已变化，请重新读取后配置。');return this.write(db,identity,input.expectedRevision,null);});
 }
 /** Internal runtime only. Keep plaintext out of snapshots, metadata and HTTP responses. */
 async resolve(identity:ModelIdentity):Promise<ResolvedModelCredentials>{
  identifier(identity.id);if(!providerSchema.safeParse(identity.provider).success)fail('INVALID_INPUT','模型服务无效。',400);
  return this.safely(async()=>{
   const row=await this.row(this.pool,identity.id);if(row?.provider&&row.provider!==identity.provider)return unavailable();
   if(row?.ciphertext!==null&&row?.ciphertext!==undefined)return this.open(identity,row);
   const value=this.defaults(identity.provider);return value??unavailable();
  });
 }
 /** Explicit operator import; a reset tombstone is an existing row and is never overwritten. */
 async importDefaults(accountId:string):Promise<number>{return this.authorized(accountId,async db=>{
  let count=0;
  for(const entry of DEFAULT_TEACHER_MODELS){
   const existing=(await db.query('SELECT config FROM teeko_teacher_models WHERE id=$1 FOR SHARE',[entry.id])).rows[0];if(!existing||existing.config?.provider!==entry.input.provider)continue;
   await this.lock(db,entry.id);if(await this.row(db,entry.id))continue;
   const value=this.defaults(entry.input.provider);if(!value)continue;
   await this.write(db,{id:entry.id,provider:entry.input.provider},0,value);count++;
  }
  return count;
 });}
}
