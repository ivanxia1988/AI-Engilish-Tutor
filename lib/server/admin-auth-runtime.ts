import {getAccountPool} from '../../db/postgres';
import {readRuntimeEnv} from './runtime-env';
import {AdminAuthService} from './admin-auth';
import {createAdminAuthHandler} from './admin-auth-http';
import {adminOrigin} from './admin-origin';
import {accountResponse} from './account-http';
export function getAdminAuthService():AdminAuthService{return new AdminAuthService(getAccountPool(readRuntimeEnv('DATABASE_URL')),{secret:readRuntimeEnv('AUTH_SECRET')??''});}
export async function handleAdminAuthRequest(request:Request):Promise<Response>{
 try{return await createAdminAuthHandler({origin:adminOrigin(),auth:getAdminAuthService()})(request);}
 catch{return accountResponse({ok:false,error:{code:'UNAVAILABLE',message:'管理登录暂时不可用，请稍后重试。'}},503);}
}
