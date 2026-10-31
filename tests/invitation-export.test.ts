import test from 'node:test';
import assert from 'node:assert/strict';
import { exportInvitationBatch, InvitationExportError } from '../lib/server/invitation-export.ts';
test('a failed private export disables the just-issued batch without putting codes into errors', async () => {
  const disabled: string[] = [];
  const service = { async issueInvitations() { return [{ id: 'id-a', code: 'fixture-private-code', expiresAt: new Date() }]; }, async disableInvitation(id: string) { disabled.push(id); } };
  await assert.rejects(exportInvitationBatch(service, { count: 1, expiresAt: new Date(), issuedBy: 'test' }, async () => { throw new Error('disk failure'); }), error => {
    assert(error instanceof InvitationExportError); assert.deepEqual(error.pendingDisableIds, []); assert.doesNotMatch(String(error), /fixture-private-code/); return true;
  });
  assert.deepEqual(disabled, ['id-a']);
});
test('failed compensation reports only metadata identifiers for operator recovery', async () => {
  const service = { async issueInvitations() { return [{ id: 'id-a', code: 'fixture-private-code', expiresAt: new Date() }]; }, async disableInvitation() { throw new Error('db unavailable'); } };
  await assert.rejects(exportInvitationBatch(service, { count: 1, expiresAt: new Date(), issuedBy: 'test' }, async () => { throw new Error('disk failure'); }), error => {
    assert(error instanceof InvitationExportError); assert.deepEqual(error.pendingDisableIds, ['id-a']); assert.doesNotMatch(JSON.stringify(error), /fixture-private-code/); return true;
  });
});
