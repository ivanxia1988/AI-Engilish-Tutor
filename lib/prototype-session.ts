export type EndReason = 'manual' | 'content' | 'time' | 'session-limit' | 'daily-limit';
export const END_REASONS: { id: EndReason; label: string }[] = [
  { id: 'manual', label: '中途结束' }, { id: 'content', label: '内容学完' },
  { id: 'time', label: '课时结束' }, { id: 'session-limit', label: '单课上限' }, { id: 'daily-limit', label: '每日上限' },
];
export function endPresentation(reason: EndReason) {
  const values = {
    manual: { title: '要结束这节课吗？', description: '点击“结束并保存”才会退出，学习进度会保留。', canResume: true },
    content: { title: '这节课学完了。', description: '学习进度已保存，可以查看本次小结。', canResume: false },
    time: { title: '这节课的时间到了。', description: '今天先学到这里，学习进度已保存。', canResume: false },
    'session-limit': { title: '已达到本节课时长上限。', description: '课堂已结束，学习进度已保存。', canResume: false },
    'daily-limit': { title: '今天的学习时间用完了。', description: '课堂已结束，明天可以继续学习。', canResume: false },
  };
  return values[reason];
}

export function shouldProtectLessonExit(screen: string, reason: EndReason): boolean {
  return ['06', '07', '08', '09', '10', '11', '18', '20', '21'].includes(screen) || (screen === '19' && reason === 'manual');
}

export function bindLessonExitProtection(target: EventTarget): () => void {
  const beforeUnload = (event: Event) => {
    event.preventDefault();
    // Browsers control the prompt wording; this also supports older implementations.
    (event as BeforeUnloadEvent).returnValue = '';
  };
  target.addEventListener('beforeunload', beforeUnload);
  return () => target.removeEventListener('beforeunload', beforeUnload);
}
export type ConnectionQuality = 'good' | 'weak' | 'disconnected' | 'unknown';
export const CONNECTION_LABELS: Record<ConnectionQuality, string> = { good: '连接良好', weak: '网络较弱', disconnected: '连接中断', unknown: '尚未检测' };
export function participantConnection(side: 'teacher' | 'student', teacher: ConnectionQuality, student: ConnectionQuality, reconnecting: boolean): ConnectionQuality {
  if (reconnecting && teacher !== 'disconnected' && student !== 'disconnected' && side === 'teacher') return 'disconnected';
  return side === 'teacher' ? teacher : student;
}
export const INTERACTION_PAUSES = [
  { id: 'silence', label: '持续无回应', title: '我好一会儿没听到你说话了。', description: '先休息一下，准备好了我们再继续。' },
  { id: 'noise', label: '环境嘈杂', title: '周围有点吵，我听不清你的声音。', description: '我们先停一下，换个安静的地方再继续。' },
  { id: 'ineffective', label: '交流不清楚', title: '刚才我没听清，我们先停一下。', description: '看看麦克风有没有挡住，准备好了再继续。' },
] as const;
export type InteractionPause = (typeof INTERACTION_PAUSES)[number]['id'];
