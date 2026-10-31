export type PrototypeSound = 'correct' | 'retry' | 'hint' | 'celebrate';
const NOTES: Record<PrototypeSound, number[]> = {
  correct: [523.25, 659.25, 783.99], retry: [392, 349.23], hint: [440], celebrate: [523.25, 659.25, 783.99, 1046.5],
};

/** Short, local Web Audio effects. Audio is created only after an explicit interaction. */
export class PrototypeSounds {
  private context: AudioContext | null = null;
  private sources = new Set<OscillatorNode>();
  private epoch = 0;
  constructor(private createContext: () => AudioContext = () => new AudioContext()) {}
  async play(kind: PrototypeSound): Promise<boolean> {
    this.stop();
    const epoch = this.epoch;
    try {
      const context = this.context ??= this.createContext();
      if (context.state === 'suspended') await context.resume();
      if (epoch !== this.epoch || context.state !== 'running') return false;
      NOTES[kind].forEach((frequency, i) => {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const start = context.currentTime + i * .12, duration = kind === 'celebrate' ? .26 : .19;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.065, start + .018); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain); gain.connect(context.destination); this.sources.add(oscillator);
        oscillator.onended = () => { this.sources.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + duration + .01);
      });
      return true;
    } catch { return false; }
  }
  stop() {
    this.epoch++;
    for (const source of this.sources) { try { source.stop(); } catch { /* It may have ended already. */ } }
    this.sources.clear();
  }
  dispose() { this.stop(); void this.context?.close().catch(() => {}); this.context = null; }
}
