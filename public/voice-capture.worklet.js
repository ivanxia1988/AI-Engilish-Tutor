/* Real-time mono PCM capture. No recordings, network requests, or credentials. */
class LittleleafCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = options.processorOptions || {};
    this.targetRate = settings.sampleRate;
    this.frameSamples = Math.round(this.targetRate * settings.frameMs / 1000);
    if (!Number.isInteger(this.targetRate) || this.targetRate < 8000 || this.targetRate > 48000 || !Number.isInteger(this.frameSamples) || this.frameSamples < 1 || this.frameSamples > 12000) throw new Error('Invalid PCM capture settings.');
    this.step = sampleRate / this.targetRate;
    this.muted = false; this.stopped = false; this.epoch = 0;
    // A small windowed-sinc low-pass prevents high frequencies folding into
    // speech when downsampling a 44.1/48 kHz device to the provider's 16 kHz.
    this.taps = [];
    if (this.targetRate < sampleRate) {
      const cutoff = .45 * this.targetRate / sampleRate, count = 33, middle = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        const distance = i - middle;
        const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
        this.taps.push(sinc * (.5 - .5 * Math.cos(2 * Math.PI * i / (count - 1))));
      }
      const total = this.taps.reduce((sum, value) => sum + value, 0);
      this.taps = this.taps.map(value => value / total);
    }
    this.reset();
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') { this.stopped = true; this.reset(); }
      if (event.data?.type === 'mute') { this.muted = Boolean(event.data.muted); this.epoch = event.data.epoch; this.reset(); }
    };
  }
  reset() {
    this.history = new Float32Array(this.taps.length || 1); this.head = 0;
    this.index = 0; this.nextAt = 0; this.previous = 0;
    this.frame = new ArrayBuffer(this.frameSamples * 2); this.view = new DataView(this.frame); this.position = 0; this.energy = 0;
  }
  filtered(value) {
    if (!this.taps.length) return value;
    this.history[this.head] = value;
    let result = 0;
    for (let i = 0; i < this.taps.length; i++) result += this.taps[i] * this.history[(this.head - i + this.history.length) % this.history.length];
    this.head = (this.head + 1) % this.history.length;
    return result;
  }
  push(value, at) {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    this.view.setInt16(this.position * 2, clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767), true);
    this.energy += clamped * clamped; this.position++;
    if (this.position < this.frameSamples) return;
    const audio = this.frame;
    this.port.postMessage({ type: 'frame', audio, level: Math.sqrt(this.energy / this.frameSamples), at, epoch: this.epoch }, [audio]);
    this.frame = new ArrayBuffer(this.frameSamples * 2); this.view = new DataView(this.frame); this.position = 0; this.energy = 0;
  }
  process(inputs, outputs) {
    // Keep the graph active without ever feeding microphone audio to speakers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.stopped) return false;
    if (this.muted) return true;
    const channels = inputs[0]; if (!channels?.length || !channels[0]?.length) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      const value = this.filtered(mono / channels.length);
      // Absolute fractional position is retained between render quanta: do not
      // round each 128-frame block independently or lose boundary samples.
      while (this.nextAt <= this.index) {
        const fraction = this.index === 0 ? 1 : this.nextAt - (this.index - 1);
        const sample = this.index === 0 ? value : this.previous + (value - this.previous) * fraction;
        this.push(sample, currentTime + i / sampleRate);
        this.nextAt += this.step;
      }
      this.previous = value; this.index++;
    }
    return true;
  }
}
registerProcessor('littleleaf-pcm-capture', LittleleafCaptureProcessor);
