import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { PublishedCourse } from '../classroom-contract';

/** A deliberately small, reviewed trial lesson, separate from prototype records. */
export const PICNIC_COURSE: PublishedCourse = {
  id:'picnic',version:'1',title:'一起去野餐',subtitle:"Let's have a picnic!",
  description:'看图找水果，聊聊你喜欢吃什么。',durationMinutes:10,
  words:['apple','banana','strawberry'],objectives:['找到并说出三种水果','用 I like… 表达自己的选择'],
  pages:[{id:'picnic-table',image:'/course-assets/picnic-v1.svg',width:900,height:720,objects:[
    {id:'apple',label:'apple',chinese:'苹果',box:{x:.15,y:.32,w:.22,h:.34}},
    {id:'banana',label:'banana',chinese:'香蕉',box:{x:.40,y:.32,w:.23,h:.34}},
    {id:'strawberry',label:'strawberry',chinese:'草莓',box:{x:.68,y:.32,w:.21,h:.34}},
  ]}],
  steps:[
    {id:'find-apple',kind:'select',pageId:'picnic-table',targetId:'apple',english:'Can you find the apple? Tap it or draw a circle around it.',chinese:'找一找苹果',hint:'The apple is round and red.',expected:'apple'},
    {id:'say-apple',kind:'speak',pageId:'picnic-table',targetId:'apple',english:'Tell me what you found. A word or a short sentence is fine.',chinese:'说说你找到了什么',hint:'You can say: an apple, or It is an apple.',expected:'apple'},
    {id:'find-banana',kind:'select',pageId:'picnic-table',targetId:'banana',english:'Which fruit is long and yellow? Can you find the banana?',chinese:'找一找香蕉',hint:'The banana is yellow and curved.',expected:'banana'},
    {id:'say-banana',kind:'speak',pageId:'picnic-table',targetId:'banana',english:'What is the yellow fruit called?',chinese:'说说黄色的水果叫什么',hint:'It is a banana.',expected:'banana'},
    {id:'find-strawberry',kind:'select',pageId:'picnic-table',targetId:'strawberry',english:'Can you find the strawberry? Tap it or circle it.',chinese:'找一找草莓',hint:'Look for the small red fruit with little seeds and green leaves.',expected:'strawberry'},
    {id:'say-strawberry',kind:'speak',pageId:'picnic-table',targetId:'strawberry',english:'What fruit did you find?',chinese:'说说刚才的水果',hint:'You can say: a strawberry.',expected:'strawberry'},
    {id:'my-choice',kind:'speak',pageId:'picnic-table',targetId:null,english:'Which fruit would you take on our picnic? Tell me one fruit you like. You can say I like…',chinese:'野餐你想带哪种水果？',hint:'Choose your own fruit: I like apples, I like bananas, or I like strawberries.',expected:'apple|banana|strawberry'},
  ],
};
export async function publishTrialCourses(pool:Pool) {
  const manifest=JSON.stringify(PICNIC_COURSE), checksum=createHash('sha256').update(manifest).digest('hex');
  await pool.query('INSERT INTO teeko_courses(id,version,manifest,checksum) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[PICNIC_COURSE.id,PICNIC_COURSE.version,manifest,checksum]);
  const result=await pool.query('SELECT checksum FROM teeko_courses WHERE id=$1 AND version=$2',[PICNIC_COURSE.id,PICNIC_COURSE.version]);
  if(result.rows[0]?.checksum!==checksum) throw new Error('Published course versions are immutable.');
}
