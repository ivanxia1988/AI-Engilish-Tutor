'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,Eye,EyeOff} from 'lucide-react';
import {z} from 'zod';
import {accountRequest,errorMessage} from '../product/account-request';

const stateSchema=z.object({ok:z.literal(true),user:z.object({id:z.string().min(1),username:z.string().min(1)}).nullable()});
const loginSchema=z.object({ok:z.literal(true),next:z.literal('/admin')});
const navigateAdmin=(path:string)=>window.location.assign(path);
export function AdminLogin({navigate=navigateAdmin}:{navigate?:(path:string)=>void}){
 const [username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[show,setShow]=useState(false),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),locked=useRef(false);
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();
  accountRequest('/admin/auth/state',stateSchema,{signal:controller.signal}).then(value=>{if(controller.signal.aborted)return;if(value.user){navigate('/admin');return;}setChecking(false);}).catch(failure=>{if(controller.signal.aborted)return;setChecking(false);setError(errorMessage(failure));});
  return()=>{mounted.current=false;controller.abort();};
 },[navigate]);
 async function submit(event:FormEvent){
  event.preventDefault();if(checking||locked.current)return;if(!username.trim()||!password){setError('请填写用户名和密码。');return;}
  locked.current=true;setBusy(true);setError('');
  try{const value=await accountRequest('/admin/auth/login',loginSchema,{body:{username:username.trim(),password}});if(mounted.current)navigate(value.next);}
  catch(failure){if(mounted.current)setError(errorMessage(failure));}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 return <main className="tk-product tk-admin-login" style={{display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
  <section style={{width:'100%',maxWidth:420,padding:'32px clamp(24px,5vw,40px)',border:'1px solid #e6ddcd',borderRadius:14,background:'#fff',boxShadow:'0 8px 28px #1f2a4409'}}>
   <span className="tk-wordmark" style={{fontSize:34,marginBottom:28}}>Tee<span>ko</span></span>
   <h1 style={{fontSize:26,lineHeight:1.4,marginBottom:28}}>管理后台</h1>
   <form onSubmit={event=>{void submit(event);}} noValidate style={{display:'flex',flexDirection:'column',gap:20}}>
    <label htmlFor="teeko-admin-username">用户名<input id="teeko-admin-username" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} disabled={busy||checking}/></label>
    <label htmlFor="teeko-admin-password">密码<span style={{display:'flex',alignItems:'center',border:'1px solid #ddd3c0',borderRadius:8,overflow:'hidden'}}><input id="teeko-admin-password" type={show?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" maxLength={64} disabled={busy||checking} style={{border:0}}/><button type="button" aria-label={show?'隐藏密码':'显示密码'} aria-pressed={show} onClick={()=>setShow(value=>!value)} style={{display:'grid',placeItems:'center',minWidth:48,minHeight:48}}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
    {error&&<p className="tk-account-error" role="alert">{error}</p>}
    <button type="submit" className="tk-submit" disabled={checking||busy}>{checking?'正在检查登录…':busy?'正在登录…':<>登录后台<ArrowRight size={18}/></>}</button>
   </form>
  </section>
 </main>;
}
