export type TeekoMouth = 'closed' | 'small' | 'wide' | 'oo';
export type TeacherAvatarInput = {
  level: number; connected: boolean; childSpeaking: boolean; celebrating: boolean;
  paused?: boolean; allowHandoff?: boolean;
};
export type TeacherAvatarVisual = { mouth: TeekoMouth; handingOff: boolean };

/** Playback energy is a visual approximation, not phoneme recognition. */
export class TeacherAvatarMotion {
  private mouth: TeekoMouth = 'closed';
  private mouthChangedAt = -Infinity;
  private lastAudibleAt: number | null = null;
  private speechSeen = false;
  sample(input: TeacherAvatarInput, now: number): TeacherAvatarVisual {
    if (!input.connected || input.paused || !Number.isFinite(now)) {
      this.mouth = 'closed'; this.mouthChangedAt = -Infinity; this.lastAudibleAt = null; this.speechSeen = false;
      return { mouth: 'closed', handingOff: false };
    }
    const level = Number.isFinite(input.level) ? Math.max(0, Math.min(1, input.level)) : 0;
    const energy = Math.min(1, level * 10), audible = energy >= .08;
    if (input.childSpeaking) this.speechSeen = false;
    let target = this.mouth;
    if (audible) {
      this.lastAudibleAt = now;
      if (!input.childSpeaking) this.speechSeen = true;
      target = energy >= .32 ? 'wide' : energy >= .2 ? 'oo' : 'small';
    } else if (this.lastAudibleAt === null || now - this.lastAudibleAt >= 100) target = 'closed';
    if (target !== this.mouth && now - this.mouthChangedAt >= 80) { this.mouth = target; this.mouthChangedAt = now; }
    const handingOff = this.speechSeen && !audible && !input.childSpeaking && !input.celebrating && input.allowHandoff !== false && this.lastAudibleAt !== null && now - this.lastAudibleAt >= 1200;
    return { mouth: this.mouth, handingOff };
  }
}
