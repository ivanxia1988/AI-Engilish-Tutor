import type { LiveContext } from './live-protocol';

export type CoachAction = { type: 'nudge'; stage: number } | { type: 'advance' } | { type: 'missing_audio' };
export function coachControl(text: string): 'pause' | 'wait' | null {
  const value = text.trim();
  if (/\b(mean|means|meaning|translate|word|don't|do not)\b|什么意思|怎么读|翻译|不要停|别停/i.test(value)) return null;
  if (/^(?:(?:please|can you|could you)\s+)*(?:stop(?:\s+(?:talking|speaking|the lesson))?|pause(?:\s+(?:the lesson|for now))?|goodbye|end the (?:lesson|call))[.!?\s]*$/i.test(value) || /^(?:请|老师|小叶|，|\s)*(?:暂停(?:一下)?|停一下|结束(?:课堂|通话)?|再见)[。！!\s]*$/.test(value)) return 'pause';
  if (/^(?:please\s+)?(?:wait(?:\s+(?:a moment|a second))?|hold on|let me think)[.!?\s]*$/i.test(value) || /^(?:请|老师|，|\s)*(?:等等|等一下|让我想(?:一想|一下)?)[。！!\s]*$/.test(value)) return 'wait';
  return null;
}
/** Silence is based on media energy plus activity, never on transcript gaps alone. */
export class LessonCoach {
  enabled = true;
  private context?: LiveContext;
  private lastActivity = 0;
  private stage = 0;
  private inputReady = false;
  private outputReady = false;
  private inputSampleAt = -Infinity;
  private outputSampleAt = -Infinity;
  private heardTeacher = false;
  private speechRequestedAt: number | null = null;
  private blocked = false;
  private holdUntil = 0;
  reset(context: LiveContext, now: number) { this.context = context; this.stage = 0; this.lastActivity = now; this.holdUntil = 0; this.blocked = false; this.heardTeacher = false; this.speechRequestedAt ??= now; }
  update(context: LiveContext, now: number, learnerChanged: boolean) { this.context = context; if (learnerChanged) { this.stage = 0; this.lastActivity = now; this.blocked = false; } }
  setEnabled(value: boolean, now: number) { this.enabled = value; this.stage = 0; this.lastActivity = now; this.blocked = false; this.speechRequestedAt = null; }
  hold(now: number) { this.holdUntil = now + 45_000; this.lastActivity = now; }
  activity(now: number, learner = false) { this.lastActivity = now; if (learner) { this.stage = 0; this.blocked = false; } }
  speechRequested(now: number) { this.speechRequestedAt = now; this.lastActivity = now; }
  media(role: 'child' | 'teacher', level: number, now: number) {
    if (role === 'child') { this.inputReady = true; this.inputSampleAt = now; } else { this.outputReady = true; this.outputSampleAt = now; }
    if (level < (role === 'teacher' ? .006 : .02)) return;
    this.lastActivity = now;
    if (role === 'teacher') { this.heardTeacher = true; this.speechRequestedAt = null; }
    else { this.stage = 0; this.blocked = false; }
  }
  tick(now: number, suspended: boolean): CoachAction | null {
    if (!this.enabled || this.blocked || !this.context || suspended || now < this.holdUntil) return null;
    if (this.speechRequestedAt !== null) {
      if (now - this.speechRequestedAt < 20_000) return null;
      this.blocked = true; return { type: 'missing_audio' };
    }
    if (!this.inputReady || !this.outputReady || !this.heardTeacher || now - this.inputSampleAt > 1500 || now - this.outputSampleAt > 1500) return null;
    const quiet = now - this.lastActivity;
    if (this.context.answered || this.context.step.kind === 'listen') {
      if (quiet < 6000) return null;
      this.blocked = true; return { type: 'advance' };
    }
    if (this.stage >= 3 || quiet < [8000, 12000, 16000][this.stage]) return null;
    this.stage++; this.lastActivity = now;
    return { type: 'nudge', stage: this.stage };
  }
}
export function coachPrompt(context: LiveContext, stage: number) {
  const instruction = stage === 1 ? 'Rephrase the task as one concrete question or action. Give a useful starting point; do not just say take your time.' : stage === 2 ? 'Give one specific textbook hint and a simpler choice or sentence starter, then ask the learner to try. Do not pretend they answered.' : 'Demonstrate a short model answer or explain the first step, then invite one attempt. This is assisted practice, not a correct answer. Do not keep repeating requests if they remain silent.';
  return `Lead the current ${context.step.kind} exercise now. ${instruction} Use the verified coaching facts. Be respectful, no baby talk. Ask ONE thing, then listen.`;
}
