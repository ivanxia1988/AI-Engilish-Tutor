import assert from 'node:assert/strict';
import test from 'node:test';
import { PcmOutputPacer, type PcmOutputClock } from '../lib/server/classroom-audio';

function clockHarness() {
  let now = 0, nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: PcmOutputClock = {
    now: () => now,
    schedule: (callback, milliseconds) => { const id = ++nextId; timers.set(id, { at: now + milliseconds, callback }); return id; },
    cancel: handle => { timers.delete(handle as number); },
  };
  const sent: { at: number; bytes: Buffer }[] = [], errors: string[] = [];
  const pacer = new PcmOutputPacer({ send: audio => { sent.push({ at: now, bytes: Buffer.from(audio, 'base64') }); return true; }, error: message => { errors.push(message); } }, clock);
  function advance(milliseconds: number) {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].callback();
    }
    now = end;
  }
  return { clock, pacer, sent, errors, timers, advance, late(milliseconds: number) { now += milliseconds; const next = [...timers][0]; if (next) { timers.delete(next[0]); next[1].callback(); } } };
}
const pcm = (seconds: number, value = 0) => Buffer.alloc(Math.round(seconds * 48000), value).toString('base64');

test('six seconds of burst PCM is sent at the audio rate in at most 50ms frames', () => {
  const h = clockHarness();
  assert(h.pacer.enqueue(pcm(3))); assert(h.pacer.enqueue(pcm(3))); assert.equal(h.sent.length, 0);
  h.advance(0); assert.equal(h.sent.length, 1); assert.equal(h.sent[0].bytes.length, 2400);
  h.advance(1000);
  assert.equal(h.sent.length, 21); assert.equal(h.sent.reduce((total, frame) => total + frame.bytes.length, 0), 50400);
  assert.equal(h.timers.size, 1); assert(h.pacer.queuedBytes <= 576000);
  h.advance(5000);
  assert.equal(h.sent.reduce((total, frame) => total + frame.bytes.length, 0), 288000);
  assert.equal(h.pacer.queuedBytes, 0); assert.equal(h.timers.size, 0); assert.equal(h.errors.length, 0);
});

test('clear discards queued audio and invalidates a stale callback before new-topic audio starts', () => {
  const h = clockHarness(); h.pacer.enqueue(pcm(3, 0x11)); h.advance(0);
  const stale = [...h.timers.values()][0].callback;
  h.pacer.clear(); assert.equal(h.pacer.queuedBytes, 0); assert.equal(h.timers.size, 0);
  h.pacer.enqueue(pcm(.05, 0x22)); stale(); assert.equal(h.sent.length, 1);
  h.advance(0); assert.equal(h.sent.length, 2); assert.equal(h.sent[1].bytes[0], 0x22);
  h.advance(5000); assert.equal(h.sent.length, 2); assert.equal(h.errors.length, 0);
});

test('over twelve seconds, malformed PCM, too many fragments and output failure each stop once', () => {
  const over = clockHarness(); for (let i = 0; i < 4; i++) assert(over.pacer.enqueue(pcm(3)));
  assert.equal(over.pacer.enqueue('AAA='), false); assert.equal(over.errors.length, 1); assert.equal(over.pacer.queuedBytes, 0); assert.equal(over.timers.size, 0);
  assert.equal(over.pacer.enqueue(pcm(.05)), false); assert.equal(over.errors.length, 1);
  for (const value of ['AA==', '____', 'AA', pcm(4) + 'AAAA']) {
    const h = clockHarness(); assert.equal(h.pacer.enqueue(value), false); assert.equal(h.errors.length, 1); assert.equal(h.timers.size, 0);
  }
  const fragments = clockHarness(); for (let i = 0; i < 1024; i++) assert(fragments.pacer.enqueue('AAA='));
  assert.equal(fragments.pacer.enqueue('AAA='), false); assert.equal(fragments.errors.length, 1);
  let failures = 0;
  const output = clockHarness(); const failed = new PcmOutputPacer({ send: () => false, error: () => { failures++; } }, output.clock);
  failed.enqueue(pcm(.05)); output.advance(0); assert.equal(failures, 1); assert.equal(failed.queuedBytes, 0); assert.equal(output.timers.size, 0);
  failed.enqueue(pcm(.05)); output.advance(100); assert.equal(failures, 1);
});

test('a late event loop never catches up by dumping several seconds into the client', () => {
  const h = clockHarness(); h.pacer.enqueue(pcm(3)); h.advance(0); assert.equal(h.sent.length, 1);
  h.late(1500); assert.equal(h.sent.length, 2);
  h.advance(49); assert.equal(h.sent.length, 2); h.advance(1); assert.equal(h.sent.length, 3);
  h.pacer.close(); h.advance(5000); assert.equal(h.sent.length, 3); assert.equal(h.pacer.queuedBytes, 0);
});

test('small timely provider chunks add no more than a single frame of scheduling latency', () => {
  const h = clockHarness(); h.pacer.enqueue(pcm(.02)); h.advance(0); assert.equal(h.sent[0].at, 0);
  h.advance(15); h.pacer.enqueue(pcm(.02)); h.advance(5); assert.equal(h.sent[1].at, 20);
  assert.equal(h.sent[1].bytes.length, 960); assert.equal(h.errors.length, 0); h.pacer.close();
});
