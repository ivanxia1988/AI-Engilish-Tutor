import test from 'node:test';
import assert from 'node:assert/strict';
import {ClassroomConnectionSamples} from '../lib/classroom-connection';

test('connection quality starts unknown and uses actual bounded median RTT samples',()=>{
 const samples=new ClassroomConnectionSamples();
 assert.deepEqual(samples.value,{status:'checking',rttMs:null});
 assert.deepEqual(samples.record(24),{status:'good',rttMs:24});
 samples.record(400);assert.equal(samples.record(500).status,'fair');
 samples.record(1500);assert.equal(samples.record(1100).status,'poor');
});
test('invalid samples do not create a healthy result and missed samples have no invented latency',()=>{
 const samples=new ClassroomConnectionSamples();
 for(const invalid of [NaN,Infinity,-10,1e8])assert.deepEqual(samples.record(invalid),{status:'checking',rttMs:null});
 assert.deepEqual(samples.missed(),{status:'poor',rttMs:null});
 samples.record(12);assert.equal(samples.value.status,'good');
 assert.deepEqual(samples.reset(),{status:'unavailable',rttMs:null});
});
