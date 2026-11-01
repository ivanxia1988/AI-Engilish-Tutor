'use client';

import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {modelCredentialInputSchema,type ModelCredentialStatus} from '../../lib/model-credentials';
import {AccountRequestError} from '../product/account-request';
import {adminRequest,modelCredentialResponse} from './admin-request';

type Provider='qwen'|'openai';
type Props={modelId?:string;provider:Provider;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;onSaved?:()=>void};
const ignoreBusy=()=>{};
function safeFailure(error:unknown,reading=false){
 if(error instanceof AccountRequestError){
  if(error.status===409)return '配置已更新，请重新读取后再试。';
  if(error.status===401||error.status===403)return '登录已失效或没有管理权限，请重新登录。';
  if(error.status===429)return '操作太频繁，请稍后再试。';
  if(error.status===400)return '请检查密钥与通义配置。';
 }
 return reading?'密钥状态读取失败，请重试。':'操作未完成，请稍后重试。';
}

export function ModelCredentialsEditor(props:Props){
 if(!props.modelId)return <section className="ta-model-credentials"><h3>模型密钥</h3><p className="ta-help">先保存模型，再配置密钥。</p></section>;
 return <CredentialFields key={`${props.modelId}:${props.provider}`} {...props} modelId={props.modelId}/>;
}

function CredentialFields({modelId,provider,disabled=false,onBusyChange=ignoreBusy,onSaved}:Props&{modelId:string}){
 const titleId=useId(),[credential,setCredential]=useState<ModelCredentialStatus|null>(null),[apiKey,setApiKey]=useState(''),[workspaceId,setWorkspaceId]=useState(''),[region,setRegion]=useState<'cn-beijing'|'ap-southeast-1'>('cn-beijing');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false),[confirm,setConfirm]=useState(false);
 const active=useRef(true),controller=useRef<AbortController|null>(null),locked=useRef(false),busyCallback=useRef(onBusyChange),resetButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{busyCallback.current=onBusyChange;},[onBusyChange]);
 useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();busyCallback.current(false);};},[]);
 useEffect(()=>{
  const request=new AbortController();controller.current=request;
  adminRequest(`/models/${modelId}/credentials`,modelCredentialResponse,{signal:request.signal}).then(result=>{
   if(request.signal.aborted||!active.current)return;
   if(result.credential.provider!==provider)throw new Error('Provider mismatch');
   setCredential(result.credential);setConflict(false);setError('');setLoading(false);
  }).catch(failure=>{if(request.signal.aborted||!active.current)return;setCredential(null);setError(safeFailure(failure,true));setLoading(false);});
  return()=>request.abort();
 },[modelId,provider,attempt]);
 const input=()=>({provider,expectedRevision:credential?.revision??0,apiKey,...(provider==='qwen'?{workspaceId,region}:{})});
 const valid=modelCredentialInputSchema.safeParse(input()).success,blocked=disabled||loading||saving||conflict||!credential;
 function reload(){if(locked.current)return;setLoading(true);setCredential(null);setNotice('');setError('');setAttempt(value=>value+1);}
 async function write(reset=false){
  if(locked.current||blocked||!credential)return;
  if(!reset&&!valid){setError('请填写完整的密钥配置。');return;}
  locked.current=true;setSaving(true);busyCallback.current(true);setError('');setNotice('');
  controller.current?.abort();const request=new AbortController();controller.current=request;
  try{
   const result=await adminRequest(`/models/${modelId}/credentials${reset?'/reset':''}`,modelCredentialResponse,{body:reset?{provider,expectedRevision:credential.revision}:modelCredentialInputSchema.parse(input()),signal:request.signal});
   if(request.signal.aborted||!active.current)return;
   if(result.credential.provider!==provider)throw new Error('Provider mismatch');
   setCredential(result.credential);setApiKey('');setWorkspaceId('');setNotice(reset?'已恢复环境默认配置。':'密钥已保存，后续请求生效。');setConfirm(false);onSaved?.();
  }catch(failure){
   if(request.signal.aborted||!active.current)return;
   setError(safeFailure(failure));if(failure instanceof AccountRequestError&&failure.status===409){setConflict(true);setConfirm(false);}
  }finally{locked.current=false;if(active.current){setSaving(false);busyCallback.current(false);}}
 }
 function keyDown(event:KeyboardEvent<HTMLElement>){
  if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();if(!blocked&&valid)void write();}
 }
 const label=loading?'正在读取密钥状态…':!credential?'密钥状态未读取':!credential.configured?'尚未配置密钥':credential.source==='model'?'已配置单模型密钥':'使用环境默认密钥';
 return <section className="ta-model-credentials" aria-labelledby={titleId} onKeyDown={keyDown}>
  <header><h3 id={titleId}>模型密钥</h3><span className="ta-chip" role="status">{label}</span></header>
  <p className="ta-help">保存后供后续请求和重连使用。已保存密钥不回显，留空不会修改。</p>
  {disabled&&<p className="ta-help">请先保存模型配置，再设置密钥。</p>}
  <fieldset disabled={blocked} inert={confirm}>
   <div className="ta-form-grid"><label>API Key<input type="password" name="model-api-key" autoComplete="off" autoCapitalize="none" spellCheck={false} value={apiKey} maxLength={1024} onChange={event=>{setApiKey(event.target.value);setNotice('');}} placeholder={credential?.configured?'输入新密钥以替换':'输入 API Key'}/></label>
    {provider==='qwen'&&<><label>工作空间 ID<input autoComplete="off" autoCapitalize="none" spellCheck={false} value={workspaceId} maxLength={128} onChange={event=>{setWorkspaceId(event.target.value);setNotice('');}} placeholder="填写本次密钥对应的工作空间"/></label><label>地域<select value={region} onChange={event=>setRegion(event.target.value as typeof region)}><option value="cn-beijing">中国北京</option><option value="ap-southeast-1">新加坡</option></select></label></>}
   </div>
   <div className="ta-credential-actions"><button type="button" className="ta-primary" disabled={blocked||!valid} onClick={()=>{void write();}}>{saving?'正在保存…':'保存密钥'}</button><button type="button" ref={resetButton} disabled={blocked||credential?.source!=='model'} onClick={()=>{setError('');setConfirm(true);}}>恢复环境默认</button></div>
  </fieldset>
  {error&&!confirm&&<p className="ta-error" role="alert">{error}</p>}{notice&&<p className="ta-notice" role="status">{notice}</p>}
  {(!credential||conflict)&&!loading&&<button type="button" disabled={saving} onClick={reload}>重新读取密钥状态</button>}
  {confirm&&<ResetConfirmation busy={saving} error={error} onCancel={()=>setConfirm(false)} onConfirm={()=>{void write(true);}} returnFocus={resetButton}/>}
 </section>;
}

function ResetConfirmation({busy,error,onCancel,onConfirm,returnFocus}:{busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void;returnFocus:{current:HTMLButtonElement|null}}){
 const cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{cancel.current?.focus();const previous=returnFocus.current;return()=>previous?.focus();},[returnFocus]);
 return <div className="ta-scrim"><section className="ta-dialog" role="dialog" aria-modal="true" aria-label="恢复环境默认密钥？" onKeyDown={event=>{
  if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();onCancel();}
  if(event.key==='Tab'){const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}><h2>恢复环境默认密钥？</h2><p>移除这个模型的独立密钥。后续请求使用服务环境中的默认配置。</p>{error&&<p className="ta-error" role="alert">{error}</p>}<footer><button type="button" ref={cancel} disabled={busy} onClick={onCancel}>取消</button><button type="button" className="ta-primary" disabled={busy} onClick={onConfirm}>{busy?'正在恢复…':'确认恢复'}</button></footer></section></div>;
}
