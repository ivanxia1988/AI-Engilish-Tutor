export type ClassroomConnectionQuality={status:'checking'|'good'|'fair'|'poor'|'unavailable';rttMs:number|null};
export type ClassroomConnectionUpdate={link:'device'|'teacher';quality:ClassroomConnectionQuality};
export const CLASSROOM_CONNECTION_INTERVAL_MS=5000;
export const CLASSROOM_CONNECTION_TIMEOUT_MS=8000;
const statusFor=(milliseconds:number)=>milliseconds<250?'good':milliseconds<800?'fair':'poor';
export function isClassroomConnectionQuality(value:unknown):value is ClassroomConnectionQuality{
 if(!value||typeof value!=='object')return false;
 const {status,rttMs}=value as ClassroomConnectionQuality;
 if(rttMs===null)return ['checking','poor','unavailable'].includes(status);
 return typeof rttMs==='number'&&Number.isFinite(rttMs)&&rttMs>=0&&rttMs<=60000&&status===statusFor(rttMs);
}

/** Three recent measured round trips smooth transient jitter; no bandwidth claim. */
export class ClassroomConnectionSamples{
 private samples:number[]=[];
 value:ClassroomConnectionQuality={status:'checking',rttMs:null};
 record(milliseconds:number):ClassroomConnectionQuality{
  if(!Number.isFinite(milliseconds)||milliseconds<0||milliseconds>60000)return this.value;
  this.samples.push(Math.round(milliseconds));this.samples=this.samples.slice(-3);
  const sorted=[...this.samples].sort((a,b)=>a-b),rttMs=sorted[Math.floor(sorted.length/2)];
  return this.value={status:statusFor(rttMs),rttMs};
 }
 missed():ClassroomConnectionQuality{this.samples=[];return this.value={status:'poor',rttMs:null};}
 reset():ClassroomConnectionQuality{this.samples=[];return this.value={status:'unavailable',rttMs:null};}
}
