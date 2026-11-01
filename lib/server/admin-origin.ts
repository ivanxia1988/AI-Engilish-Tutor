import {readRuntimeEnv} from './runtime-env';
// Next's custom Node server builds request.url from its internal listener address.
export function hasAdminHost(request:Request,origin:string):boolean{
 return (request.headers.get('host')??new URL(request.url).host)===new URL(origin).host;
}
export function adminOrigin():string{
 const configured=readRuntimeEnv('ADMIN_ORIGIN')||readRuntimeEnv('APP_ORIGIN');if(!configured)throw new Error('管理后台地址尚未配置。');
 const parsed=new URL(configured),local=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
 if(configured!==parsed.origin||parsed.username||parsed.password||(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&local)))throw new Error('管理后台地址配置无效。');return parsed.origin;
}
