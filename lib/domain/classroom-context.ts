import { z } from 'zod';

const identifierSchema = z.string().min(1).max(128).refine(
  value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value),
  'Identifiers cannot have surrounding whitespace or control characters.',
);
const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const contextSchema = z.object({
  logicalSessionId: identifierSchema,
  courseVersion: identifierSchema,
  connectionEpoch: versionSchema,
  stateRevision: versionSchema,
  pageId: identifierSchema,
  activityId: identifierSchema,
}).strict().readonly();

const stateSchema = z.object({
  status: z.enum(['created', 'preflight', 'active', 'paused', 'ending', 'ended']),
  context: contextSchema,
}).strict().readonly();

const candidateSchema = z.object({
  context: contextSchema,
  payload: z.object({
    text: z.string().min(1).max(2000),
    objectIds: z.array(identifierSchema).max(20).readonly(),
  }).strict().readonly(),
}).strict().readonly();

export type ClassroomTaskContext = z.infer<typeof contextSchema>;
export type ClassroomStateSnapshot = z.infer<typeof stateSchema>;
export type CandidateTaskResult = z.infer<typeof candidateSchema>;
export type ClassroomStateCapture =
  | { ok: true; snapshot: ClassroomStateSnapshot }
  | { ok: false; reason: 'invalid_state' };
export type TaskResultRejectionReason =
  | 'invalid_state'
  | 'invalid_result'
  | 'not_active'
  | 'session_mismatch'
  | 'course_version_mismatch'
  | 'connection_epoch_mismatch'
  | 'stale_revision'
  | 'future_revision'
  | 'page_mismatch'
  | 'activity_mismatch';
export type TaskResultValidation =
  | { accepted: true; candidate: CandidateTaskResult }
  | { accepted: false; reason: TaskResultRejectionReason };

/** Copies and freezes one observation; it does not keep that observation current. */
export function captureClassroomState(input: unknown): ClassroomStateCapture {
  const parsed = stateSchema.safeParse(input);
  return parsed.success
    ? { ok: true, snapshot: parsed.data }
    : { ok: false, reason: 'invalid_state' };
}

/**
 * Scope check only: accepted output remains a candidate, never an executed action.
 * The caller must read current authoritative state when the result arrives, bump
 * stateRevision on pause/resume/task/page/end changes and connectionEpoch on
 * reconnect/takeover. An active→paused→active history with unchanged versions
 * cannot be detected here. Commit must still check versions atomically, identity,
 * object existence, lease, quota and idempotency outside this module.
 */
export function validateClassroomTaskResult(current: unknown, envelope: unknown): TaskResultValidation {
  const captured = captureClassroomState(current);
  if (!captured.ok) return { accepted: false, reason: 'invalid_state' };
  const parsed = candidateSchema.safeParse(envelope);
  if (!parsed.success) return { accepted: false, reason: 'invalid_result' };
  if (captured.snapshot.status !== 'active') return { accepted: false, reason: 'not_active' };

  const expected = captured.snapshot.context;
  const actual = parsed.data.context;
  if (actual.logicalSessionId !== expected.logicalSessionId) return { accepted: false, reason: 'session_mismatch' };
  if (actual.courseVersion !== expected.courseVersion) return { accepted: false, reason: 'course_version_mismatch' };
  if (actual.connectionEpoch !== expected.connectionEpoch) return { accepted: false, reason: 'connection_epoch_mismatch' };
  if (actual.stateRevision < expected.stateRevision) return { accepted: false, reason: 'stale_revision' };
  if (actual.stateRevision > expected.stateRevision) return { accepted: false, reason: 'future_revision' };
  if (actual.pageId !== expected.pageId) return { accepted: false, reason: 'page_mismatch' };
  if (actual.activityId !== expected.activityId) return { accepted: false, reason: 'activity_mismatch' };
  return { accepted: true, candidate: parsed.data };
}
