import {z} from 'zod';
import {accountResponse,boundedJson} from './account-http';
import {AdminAuthError,type AdminAuthService} from './admin-auth';
type Auth=Pick<AdminAuthService,'login'|'session'|'logout'>;
const loginSchema=z.object({username:z.string().trim().min(1).max(32),password:z.string().min(1).max(64)}).strict();
export function adminSessionCookie(request:Request):string|undefined{
 const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('teeko_admin_session='));if(values.length!==1)return undefined;
 const token=values[0].slice('teeko_admin_session='.length);return /^[A-Za-z0-9_-]{43}$/.test(token)?token:undefined;
}
export function createAdminAuthHandler({origin,auth}:{origin:string;auth:Auth}){return async(request:Request):Promise<Response>=>{
 try{
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/v1\/admin\/auth/,'');
  if(!['/state','/login','/logout'].includes(path))return accountResponse({ok:false,error:{code:'NOT_FOUND',message:'管理登录接口不存在。'}},404);
  if(url.origin!==origin)throw new AdminAuthError('ORIGIN','管理后台地址不正确。',403);
  const token=adminSessionCookie(request);
  if(request.method==='GET'&&path==='/state')return accountResponse({ok:true,user:await auth.session(token)});
  if(request.method!=='POST'||path==='/state')throw new AdminAuthError('METHOD','不支持此请求方式。',405);
  if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')throw new AdminAuthError('ORIGIN','请求来源无效，请刷新后重试。',403);
  const body=await boundedJson(request);
  const cookie=(response:Response,value:string,age:number)=>{response.headers.append('Set-Cookie',`teeko_admin_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`);return response;};
  if(path==='/login'){const value=loginSchema.parse(body),logged=await auth.login(value.username,value.password);return cookie(accountResponse({ok:true,next:'/admin'}),logged.sessionToken,28800);}
  z.object({}).strict().parse(body);await auth.logout(token);return cookie(accountResponse({ok:true,next:'/admin/login'}),'',0);
 }catch(error){
  if(error instanceof z.ZodError)return accountResponse({ok:false,error:{code:'INVALID_INPUT',message:'请填写用户名和密码。'}},400);
  if(error instanceof AdminAuthError)return accountResponse({ok:false,error:{code:error.code,message:error.message}},error.status);
  const code=error&&typeof error==='object'&&'code'in error?error.code:null;
  if(code==='BODY_TOO_LARGE')return accountResponse({ok:false,error:{code,message:'请求内容过长。'}},413);
  if(code==='CONTENT_TYPE'||code==='INVALID_INPUT')return accountResponse({ok:false,error:{code,message:'登录请求内容无效。'}},code==='CONTENT_TYPE'?415:400);
  return accountResponse({ok:false,error:{code:'UNAVAILABLE',message:'管理登录暂时不可用，请稍后重试。'}},503);
 }
};}
