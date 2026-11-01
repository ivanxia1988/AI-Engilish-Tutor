import type { ClassroomSnapshot } from './classroom-contract';

export type ClassroomSummary = {
 headline: string; description: string;
 completed: {stepId:string;label:string;status:'independent'|'assisted'}[];
 practice: {stepId:string;label:string;reason:string}[];
 nextStep: string; empty: boolean;
};

/** A factual recap of saved task outcomes, independent of any generated report. */
export function buildClassroomSummary(state:ClassroomSnapshot):ClassroomSummary {
 const completed:ClassroomSummary['completed']=[],practice:ClassroomSummary['practice']=[],seen=new Set<string>();
 for(const outcome of state.outcomes){
  const step=state.course.steps.find(item=>item.id===outcome.stepId);
  if(!step||seen.has(step.id))continue;
  seen.add(step.id);
  if(step.kind==='listen'||outcome.status==='unassessed')continue;
  const label=step.chinese||step.english;
  if(outcome.status==='independent'||outcome.status==='assisted')completed.push({stepId:step.id,label,status:outcome.status});
  if(outcome.status==='assisted')practice.push({stepId:step.id,label,reason:'这次在提示后完成，下次可以先自己试一次。'});
  if(outcome.status==='skipped')practice.push({stepId:step.id,label,reason:'这次选择跳过，有兴趣时再试；不据此判断能力。'});
 }
 const empty=completed.length===0&&practice.length===0;
 const reason=state.endReason==='content_completed'?'本课练习已完成。':state.endReason==='time_limit'?'本次课堂时间已到，进度已保留。':state.endReason==='daily_limit'?'今日练习时间已用完，进度已保留。':'本次中途结束，进度已保留。';
 const next=state.course.steps[state.stepIndex];
 const nextStep=practice[0]?`下次可以试试：${practice[0].label}。`:next&&state.endReason!=='content_completed'?`下次可以接着：${next.chinese||next.english}。`:'下次可以换一种情景，把今天的表达用起来。';
 return {headline:'这节课已保存',description:reason+(empty?'目前还没有足够的答题记录，不评价掌握情况。':'以下内容来自本次课堂记录。'),completed,practice,nextStep,empty};
}
