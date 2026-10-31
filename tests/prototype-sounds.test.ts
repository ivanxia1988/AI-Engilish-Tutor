import test from 'node:test';
import assert from 'node:assert/strict';
import { PrototypeSounds } from '../lib/prototype-sounds.ts';

function fakeContext() {
  const nodes: { stops: number[]; start: number | null; frequency: { value: number }; connect: () => void; disconnect: () => void; onended: (() => void) | null; type: string; stop: (at?: number) => void }[] = [];
  const context = {
    state: 'running', currentTime: 1, destination: {}, closed: false,
    resume: async () => {}, close: async () => { context.closed = true; },
    createOscillator: () => {
      const node = { stops: [] as number[], start: null as number | null, frequency: { value: 0 }, type: '', connect() {}, disconnect() {}, onended: null as (() => void) | null, stop(at = 0) { node.stops.push(at); } };
      const oscillator = { ...node, start: (at: number) => { node.start = at; } };
      nodes.push(node); return oscillator;
    },
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
  };
  return { context, nodes };
}

test('effects create audio lazily, replace earlier tones and close on disposal', async () => {
  const { context, nodes } = fakeContext(); let created = 0;
  const sound = new PrototypeSounds(() => { created++; return context as unknown as AudioContext; });
  assert.equal(created, 0);
  assert.equal(await sound.play('correct'), true);
  assert.equal(nodes.length, 3);
  assert.equal(await sound.play('hint'), true);
  assert.equal(created, 1);
  assert.equal(nodes[0].stops.length, 2);
  sound.dispose();
  assert.equal(context.closed, true);
  assert.equal(nodes.at(-1)!.stops.length, 2);
});

test('a sound waiting for browser permission cannot play after it is stopped', async () => {
  const { context, nodes } = fakeContext(); context.state = 'suspended';
  let resume!: () => void;
  context.resume = () => new Promise<void>(resolve => { resume = resolve; });
  const sound = new PrototypeSounds(() => context as unknown as AudioContext);
  const pending = sound.play('celebrate');
  sound.stop(); context.state = 'running'; resume();
  assert.equal(await pending, false);
  assert.equal(nodes.length, 0);
  sound.dispose();
});
