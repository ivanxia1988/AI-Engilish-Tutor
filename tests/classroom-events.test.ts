import test from 'node:test';
import assert from 'node:assert/strict';
test('committed classroom changes notify the connection owner and unsubscribe releases it',async()=>{
  const {subscribeClassroomRefresh,refreshClassroom}=await import('../lib/server/classroom-events.ts');
  let count=0;const off=subscribeClassroomRefresh('test-classroom',async()=>{count++;});
  await refreshClassroom('different');assert.equal(count,0);
  await refreshClassroom('test-classroom');assert.equal(count,1);
  off();await refreshClassroom('test-classroom');assert.equal(count,1);
});
