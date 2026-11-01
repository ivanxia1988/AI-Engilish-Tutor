import {z} from 'zod';

export const teacherProviderSchema=z.enum(['qwen','openai']);
export const teacherModelInputSchema=z.object({
 name:z.string().trim().min(1).max(60),provider:teacherProviderSchema,purpose:z.enum(['realtime','reasoning','vision']),
 model:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).refine(value=>!/^sk-|^bearer/i.test(value),'请填写模型名称，不是密钥'),enabled:z.boolean(),
}).strict().refine(value=>value.provider!=='qwen'||value.purpose!=='vision','通义课堂使用原生视觉，无需独立视觉模型');
export type TeacherModelInput=z.infer<typeof teacherModelInputSchema>;
export type TeacherModel=TeacherModelInput&{id:string;revision:number;createdAt:string;updatedAt:string};
const levelPolicy=z.object({maxTeacherSentences:z.number().int().min(1).max(4),maxWordsPerSentence:z.number().int().min(3).max(30),followUpDepth:z.number().int().min(0).max(4),thinkingSeconds:z.number().int().min(3).max(25)}).strict();
export const teacherPolicySchema=z.object({
 levels:z.object({starter:levelPolicy,sentences:levelPolicy,conversation:levelPolicy}).strict(),
 hintLimit:z.number().int().min(0).max(3),digression:z.enum(['limited','balanced','open']),digressionTurns:z.number().int().min(1).max(6),
 correction:z.enum(['recast','focused']),adaptationEvidence:z.number().int().min(2).max(6),
}).strict();
export type TeacherPolicy=z.infer<typeof teacherPolicySchema>;
const modelReference=z.string().uuid().nullable();
export const teacherAgentInputSchema=z.object({
 name:z.string().trim().min(1).max(60),description:z.string().trim().max(300),systemPrompt:z.string().trim().min(20).max(8000),enabled:z.boolean(),policy:teacherPolicySchema,
 routes:z.object({qwen:z.object({realtimeModelId:modelReference,reasoningModelId:modelReference}).strict(),openai:z.object({realtimeModelId:modelReference,reasoningModelId:modelReference,visionModelId:modelReference}).strict()}).strict(),
 voices:z.object({qwen:z.object({female:z.enum(['Jennifer','Tina']),male:z.literal('Aiden')}).strict(),openai:z.object({female:z.literal('gleam'),male:z.literal('meridian')}).strict()}).strict(),
}).strict();
export type TeacherAgentInput=z.infer<typeof teacherAgentInputSchema>;
export type TeacherAgent=TeacherAgentInput&{id:string;revision:number;createdAt:string;updatedAt:string};
export type TeacherRelease={id:string;agentId:string;agentName:string;version:number;publishedAt:string};
export type FrozenTeacherConfig=TeacherRelease&{
 systemPrompt:string;policy:TeacherPolicy;voices:TeacherAgentInput['voices'];
 routes:{qwen:{realtime:TeacherModel;reasoning:TeacherModel|null}|null;openai:{realtime:TeacherModel;reasoning:TeacherModel|null;vision:TeacherModel|null}|null};
};
export type AdminConfig={models:TeacherModel[];agents:TeacherAgent[];releases:TeacherRelease[];activeRelease:TeacherRelease|null};
export type AdminOverview={days:number;registeredUsers:number;profiledUsers:number;newUsers:number;activeUsers:number;classroomCount:number;endedCount:number;usageSeconds:number;providerUsage:{provider:'qwen'|'openai';seconds:number;classrooms:number}[];endings:{reason:string;count:number}[]};
export type AdminUser={id:string;email:string;name:string|null;createdAt:string;profileComplete:boolean;classroomCount:number;usageSeconds:number;lastClassroomAt:string|null};
export type AdminUsers={users:AdminUser[];total:number;page:number;pageSize:number};

export const DEFAULT_TEACHER_POLICY:TeacherPolicy={
 levels:{starter:{maxTeacherSentences:1,maxWordsPerSentence:8,followUpDepth:1,thinkingSeconds:8},sentences:{maxTeacherSentences:2,maxWordsPerSentence:12,followUpDepth:2,thinkingSeconds:10},conversation:{maxTeacherSentences:2,maxWordsPerSentence:18,followUpDepth:3,thinkingSeconds:12}},
 hintLimit:2,digression:'balanced',digressionTurns:3,correction:'recast',adaptationEvidence:3,
};
export const DEFAULT_TEACHER_SYSTEM_PROMPT=`你是 Teeko，一位有耐心、认真倾听孩子的英语老师。你的目标是帮助孩子用英语表达真实的意思，同时围绕本课少量目标逐步学习。
先回应孩子说了什么，再决定是否追问、提示或继续活动。不要把课堂变成问答案、表扬、下一题的机械循环。
根据孩子实际英语水平调整句子长度、问题难度和支架。刚开始学的孩子可以用指认、单词或中英混合表达；能够聊天的孩子可以解释、提问和参与角色互动。
区分没有听清、没有听懂、知道但表达困难、明确不想回答、正在思考和想聊其他话题。声音或识别问题不代表能力不足。
接受合理的同义表达、自选内容和超出教材的例子；不要只认固定答案。先理解表达是否符合目标，再由应用确认完成记录。
卡住时改变帮助方式：线索、选择、句子开头、自然示范。尊重跳过，不要求反复跟读。提示后能回答与独立表达应分别记录。
孩子提出合适的话题时认真接话，在自然停顿时邀请回到活动；持续主动交流时可以延展，不因话题变化判错。
鼓励应具体、简短，与孩子实际完成的表达相关。聊天时关注交流，不逐句纠错。不要虚构分数、掌握情况或课堂结束。
教材是活动素材，学习目标是方向。每次只问一个问题，给孩子思考时间，允许插话和改变主意。`;
const ids={qwenLive:'20000000-0000-4000-8000-000000000001',openaiLive:'20000000-0000-4000-8000-000000000002',qwenReasoning:'20000000-0000-4000-8000-000000000003',openaiReasoning:'20000000-0000-4000-8000-000000000004',openaiVision:'20000000-0000-4000-8000-000000000005'};
export const DEFAULT_TEACHER_MODELS:{id:string;input:TeacherModelInput}[]=[
 {id:ids.qwenLive,input:{name:'通义实时课堂',provider:'qwen',purpose:'realtime',model:'qwen3.8-omni-flash-realtime',enabled:true}},
 {id:ids.openaiLive,input:{name:'GPT Live 实时课堂',provider:'openai',purpose:'realtime',model:'gpt-live-1',enabled:true}},
 {id:ids.qwenReasoning,input:{name:'通义教学判断',provider:'qwen',purpose:'reasoning',model:'qwen-plus',enabled:true}},
 {id:ids.openaiReasoning,input:{name:'OpenAI 教学判断',provider:'openai',purpose:'reasoning',model:'gpt-4.1-mini',enabled:true}},
 {id:ids.openaiVision,input:{name:'OpenAI 视觉观察',provider:'openai',purpose:'vision',model:'gpt-4.1-mini',enabled:true}},
];
export const DEFAULT_TEACHER_AGENT:TeacherAgentInput={name:'Teeko · 陪伴式英语老师',description:'有目标、能接话，按孩子的英语水平和反应调整教法。',systemPrompt:DEFAULT_TEACHER_SYSTEM_PROMPT,policy:DEFAULT_TEACHER_POLICY,enabled:true,
 routes:{qwen:{realtimeModelId:ids.qwenLive,reasoningModelId:ids.qwenReasoning},openai:{realtimeModelId:ids.openaiLive,reasoningModelId:ids.openaiReasoning,visionModelId:ids.openaiVision}},
 voices:{qwen:{female:'Jennifer',male:'Aiden'},openai:{female:'gleam',male:'meridian'}},
};
export const DEFAULT_TEACHER_AGENT_ID='30000000-0000-4000-8000-000000000001';
