import type { LessonStep } from '../types';

export const normalizeClassroomSpeech=(text:string)=>text.toLowerCase().replace(/[^a-z\u4e00-\u9fff ]/g,' ').replace(/\s+/g,' ').trim();

/** Controls require a complete request; words inside a story cannot move a task. */
export function classroomControl(text:string):'skip'|'pause'|null{
 const input=normalizeClassroomSpeech(text);
 if(/^(?:(?:please|can we|let s) )?(?:stop|pause)(?: please)?$|^(?:暂停|停一下|停止)$/.test(input))return 'pause';
 if(/^(?:please )?(?:skip|next)(?: this| one| question| please)?$|^(?:can we|let s) skip(?: this)?$|^(?:跳过|换一题|不想重复了)$/.test(input))return 'skip';
 return null;
}
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plural=(word:string)=>word.endsWith('y')?`${escape(word.slice(0,-1))}(?:y|ies)`:`${escape(word)}s?`;

/** Conservative task evidence, separate from the tutor's unrestricted conversation. */
export function spokenTaskAttempt(step:LessonStep,text:string,words:string[]):'correct'|'retry'|'conversation'{
 if(step.kind!=='speak'||!step.expected)return 'conversation';
 const input=normalizeClassroomSpeech(text),alternatives=step.expected.split('|').map(normalizeClassroomSpeech);
 if(!input||/^(?:can|could|would|will|do|does|did|is|are|what|why|how|where|when|who)\b/.test(input)&&!/^would you like to (?:have|go on) a picnic$/.test(input))return 'conversation';
 const negative=/\b(not|no|never|don t|doesn t|can t|cannot|won t|skip|help|wait|stop|maybe|or)\b|不|没|别|跳过|不会|等等/.test(input);
 const fruitPattern=words.map(plural).join('|');
 const fruitCount=words.filter(word=>new RegExp(`\\b${plural(word)}\\b`).test(input)).length;
 const fruit=`(?:an? |the )?(?:(?:red|yellow|green|sweet) )?(?:${fruitPattern})`;
 const naming=new RegExp(`^(?:(?:it is|it s|this is|that is|i found|i see|i can see) )?${fruit}$`);
 const choice=new RegExp(`^(?:i (?:like|love|want|choose|would take|will take)|my (?:favorite|favourite) fruit is) ${fruit}(?: because [a-z ]{1,80})?$`);
 const packing=new RegExp(`^i (?:will bring|ll bring|would bring|d bring|will pack|ll pack|want to bring|am bringing) ${fruit}(?: (?:to|for) (?:our |the |a )?picnic)?$`);
 let answer=false;
 if(step.id==='invite-friend')answer=alternatives.includes(input);
 else if(step.id==='pack-picnic')answer=packing.test(input)&&fruitCount===1;
 else if(step.id==='my-choice'&&step.expected==='apple|banana|strawberry')answer=choice.test(input)&&fruitCount===1;
 else {
  const target=alternatives.some(word=>new RegExp(`\\b${plural(word)}\\b`).test(input));
  answer=target&&fruitCount===1&&(naming.test(input)||choice.test(input));
 }
 if(answer&&!negative)return 'correct';
 const attempted=naming.test(input)||choice.test(input)||packing.test(input)||input.split(' ').length<=2||(fruitCount>1&&input.split(' ').length<=5)||/^(?:not|no|maybe|it is|it s|this is|that is|i like|i love|i will bring|i want to bring|let s have)\b/.test(input);
 return attempted?'retry':'conversation';
}
