type Issued = { id: string; code: string; expiresAt: Date };
type Issuer = { issueInvitations(input: { count: number; expiresAt: Date; issuedBy: string }): Promise<Issued[]>; disableInvitation(id: string): Promise<void> };
export class InvitationExportError extends Error {
  constructor(readonly pendingDisableIds: string[]) { super('邀请码导出失败，新生成的码已请求停用。'); }
}
export async function exportInvitationBatch(service: Issuer, input: { count: number; expiresAt: Date; issuedBy: string }, write: (csv: string) => Promise<void>) {
  const invitations = await service.issueInvitations(input);
  try { await write('id,code,expires_at\n' + invitations.map(item => `${item.id},${item.code},${item.expiresAt.toISOString()}`).join('\n') + '\n'); }
  catch {
    const results = await Promise.allSettled(invitations.map(item => service.disableInvitation(item.id)));
    throw new InvitationExportError(invitations.filter((_item, index) => results[index].status === 'rejected').map(item => item.id));
  }
}
