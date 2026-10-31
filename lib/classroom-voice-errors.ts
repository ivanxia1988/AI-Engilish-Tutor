/** Stable, non-content diagnostics. Never forward provider errors or recorded input. */
export const CLASSROOM_VOICE_ERRORS = {
  transport_error: '实时语音连接异常，请检查网络后重新连接。',
  provider_error: '语音服务返回异常，课堂连接已停止，请重新连接。',
  upstream_closed: '老师的语音连接中断了，请重新连接课堂。',
  protocol_error: '语音连接收到异常消息，请重新连接。',
  response_timeout: '老师的语音回复未能完成，请重新连接。',
  configuration_timeout: '语音服务配置确认超时，请重新连接。',
  startup_timeout: '语音服务连接超时，请重试。',
  input_rate_limited: '麦克风声音突发积压，连接已停止，请重新连接。',
  invalid_audio: '实时声音格式异常，连接已停止，请重新连接。',
  output_audio_failed: '老师声音积压或格式异常，连接已停止，请重新连接。',
  audio_capture_backlog: '浏览器麦克风采集积压，连接已停止，请重新连接。',
  audio_playback_backlog: '浏览器播放声音积压，连接已停止，请重新连接。',
  audio_capture_failed: '浏览器无法继续采集麦克风声音，请重新连接。',
  audio_playback_failed: '浏览器无法继续播放老师声音，请重新连接。',
  microphone_denied: '无法打开麦克风，请检查浏览器权限后重试。',
  lease_lost: '课堂连接已失效，请重新连接；课堂进度会保留。',
  lease_check_failed: '课堂连接状态检查失败，请重新连接。',
  session_persist_failed: '无法保存语音连接状态，请重新连接。',
  audio_sync_timeout: '老师的声音暂时无法重新同步，请重新连接课堂。',
  deadline_reached: '本次课堂已到时间，请查看课堂小结。',
} as const;
export type ClassroomVoiceErrorCode = keyof typeof CLASSROOM_VOICE_ERRORS;
export type ClassroomVoiceFailure = { code: ClassroomVoiceErrorCode; message: string };
export function classroomVoiceFailure(code: unknown): ClassroomVoiceFailure {
  const safeCode = typeof code === 'string' && Object.hasOwn(CLASSROOM_VOICE_ERRORS, code) ? code as ClassroomVoiceErrorCode : 'transport_error';
  return { code: safeCode, message: CLASSROOM_VOICE_ERRORS[safeCode] };
}
