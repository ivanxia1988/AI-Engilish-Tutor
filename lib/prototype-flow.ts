export type PrototypeScreenId = '00' | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29';
export type PrototypeMode = 'full' | 'p0';
export type PrototypeEvent = 'landing-enter' | 'profile-saved' | 'lesson-selected' | 'lesson-finished' | 'reconnect-failed' | 'checks-passed';
export type PrototypeGroup = '开始学习' | '课堂互动' | '学习记录' | '我的与设置';
export interface PrototypeScreen { id: PrototypeScreenId; title: string; phase: 'P0' | 'P1' | 'P2'; group: PrototypeGroup; note: string }

export const PROTOTYPE_SCREENS: PrototypeScreen[] = [
  { id: '00', title: '认识 Teeko', phase: 'P0', group: '开始学习', note: '爸爸陪学分享长页；邀请码进入注册，人物和课堂为示意。' },
  { id: '01', title: '登录 / 注册', phase: 'P0', group: '开始学习', note: '邀请码注册、邮箱密码登录和找回；账号仅当前原型会话有效。' },
  { id: '02', title: '孩子档案', phase: 'P0', group: '开始学习', note: '一屏填写称呼、年龄和英语基础。' },
  { id: '03', title: '学习首页', phase: 'P1', group: '开始学习', note: '继续上次、选课和报告入口都在首屏。' },
  { id: '04', title: '选一课', phase: 'P0', group: '开始学习', note: '主题课程介绍与单一开课入口；课件为演示内容。' },
  { id: '05', title: '开课检查', phase: 'P0', group: '开始学习', note: '演示麦克风、连接和响应检查，不申请权限。' },
  { id: '06', title: 'Teeko 在讲', phase: 'P0', group: '课堂互动', note: '共享课本、师生窗口与本地标注；连接状态为演示。' },
  { id: '07', title: '轮到你了', phase: 'P0', group: '课堂互动', note: '点图、点词或圈选可答题；课堂情景可触发表扬烟花。' },
  { id: '08', title: 'Teeko 在想', phase: 'P0', group: '课堂互动', note: '思考状态只在老师头像周围表达。' },
  { id: '09', title: '卡住 · 给台阶', phase: 'P0', group: '课堂互动', note: '提示画在原词上，降低难度，不循环逼读。' },
  { id: '10', title: '发音纠正', phase: 'P0', group: '课堂互动', note: '原词下标音节和重音，等孩子说完再纠正。' },
  { id: '11', title: '互动暂停', phase: 'P0', group: '课堂互动', note: '无有效互动或持续噪声时暂停；关摄像头不会暂停。' },
  { id: '12', title: '课后小结', phase: 'P0', group: '学习记录', note: '即时小结与后台报告状态分开表达。' },
  { id: '13', title: '单节报告', phase: 'P1', group: '学习记录', note: '概览、再练和针对性建议分页切换，主要操作固定。' },
  { id: '14', title: '权限说明', phase: 'P0', group: '开始学习', note: '先解释，再由用户操作进入检查；摄像头默认关闭。' },
  { id: '15', title: '检查失败', phase: 'P0', group: '开始学习', note: '说明原因并提供重新检查，不把失败显示为成功。' },
  { id: '16', title: '第一次首页', phase: 'P1', group: '开始学习', note: '新用户空状态与第一次上课入口。' },
  { id: '17', title: '认识 Teeko', phase: 'P0', group: '开始学习', note: '直接开口、暂停和定级的前端演示。' },
  { id: '18', title: '课堂暂停', phase: 'P0', group: '课堂互动', note: '暂停后只提供继续和结束。' },
  { id: '19', title: '课堂结束', phase: 'P0', group: '课堂互动', note: '中途结束、内容完成、课时到及上限分别处理。' },
  { id: '20', title: '断线重连', phase: 'P0', group: '课堂互动', note: '可演示重连成功和失败返回，不调用真实服务。' },
  { id: '21', title: '再学一页？', phase: 'P0', group: '学习记录', note: '继续或下课；可切换到每日上限状态。' },
  { id: '23', title: '报告列表', phase: 'P1', group: '学习记录', note: '分页查看，包含生成中、失败和简版。' },
  { id: '25', title: '我的', phase: 'P1', group: '我的与设置', note: '档案、报告、教学偏好和退出登录首屏可达。' },
  { id: '27', title: '教学偏好', phase: 'P1', group: '我的与设置', note: '教学偏好、服务与音效；手动连接检测为真实。' },
  { id: '28', title: '隐私与数据', phase: 'P1', group: '我的与设置', note: '删除和注销均为演示确认，不操作真实数据。' },
  { id: '29', title: '帮助与反馈', phase: 'P1', group: '我的与设置', note: '问题详情和反馈表单分区呈现，不发送网络请求。' },
];

export function prototypeDestination(event: PrototypeEvent, mode: PrototypeMode, firstLesson = false): PrototypeScreenId {
  if (event === 'landing-enter') return '01';
  if (event === 'profile-saved') return mode === 'p0' ? '04' : '16';
  if (event === 'lesson-selected') return firstLesson ? '14' : '05';
  if (event === 'checks-passed') return firstLesson ? '17' : '06';
  return mode === 'p0' ? '04' : '03';
}

export function resumeLesson(previous: PrototypeScreenId): PrototypeScreenId {
  return ['06', '07', '08', '09', '10'].includes(previous) ? previous : '06';
}

export function cancelLessonEnd(origin: PrototypeScreenId, previousLesson: PrototypeScreenId): PrototypeScreenId {
  return ['20', '11', '18'].includes(origin) ? origin : resumeLesson(previousLesson);
}

export function restoreLessonConnection(origin: PrototypeScreenId, previousLesson: PrototypeScreenId): PrototypeScreenId {
  return origin === '11' || origin === '18' ? origin : resumeLesson(previousLesson);
}

export function resolvePrototypeScreen(id: string): PrototypeScreenId | null {
  if (id === '22') return '12';
  if (id === '24') return '03';
  if (id === '26') return '27';
  return PROTOTYPE_SCREENS.find(screen => screen.id === id)?.id ?? null;
}
