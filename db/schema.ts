import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, boolean, index, check } from 'drizzle-orm/pg-core';

const instant = (name: string) => timestamp(name, { withTimezone: true });
export const accounts = pgTable('teeko_accounts', {
  id: uuid('id').primaryKey(), email: text('email').notNull().unique(), passwordHash: text('password_hash').notNull(),
  authVersion: integer('auth_version').notNull().default(0), consentVersion: text('consent_version').notNull(), consentedAt: instant('consented_at').notNull(), createdAt: instant('created_at').notNull(),
});
export const invitations = pgTable('teeko_invitations', {
  id: uuid('id').primaryKey(), codeHash: text('code_hash').notNull().unique(), issuedBy: text('issued_by').notNull(), issuedAt: instant('issued_at').notNull(), expiresAt: instant('expires_at').notNull(),
  disabledAt: instant('disabled_at'), redeemedBy: uuid('redeemed_by').references(() => accounts.id), redeemedAt: instant('redeemed_at'),
}, table => [check('teeko_invitations_check', sql`(${table.redeemedBy} IS NULL) = (${table.redeemedAt} IS NULL)`)]);
export const accountFlows = pgTable('teeko_account_flows', {
  id: uuid('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(), purpose: text('purpose').notNull(), invitationId: uuid('invitation_id').references(() => invitations.id), email: text('email'), accountVersion: integer('account_version'), stage: text('stage').notNull(),
  otpHash: text('otp_hash'), otpExpiresAt: instant('otp_expires_at'), otpReady: boolean('otp_ready').notNull().default(false), deliveryId: uuid('delivery_id'), attempts: integer('attempts').notNull().default(0), sends: integer('sends').notNull().default(0),
  sentAt: instant('sent_at'), verifiedAt: instant('verified_at'), expiresAt: instant('expires_at').notNull(), consumedAt: instant('consumed_at'), createdAt: instant('created_at').notNull(),
}, table => [index('teeko_account_flows_expiry').on(table.expiresAt), check('teeko_account_flows_purpose_check', sql`${table.purpose} IN ('register','reset')`), check('teeko_account_flows_stage_check', sql`${table.stage} IN ('email','code','password')`)]);
export const sessions = pgTable('teeko_sessions', {
  tokenHash: text('token_hash').primaryKey(), accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }), authVersion: integer('auth_version').notNull(), expiresAt: instant('expires_at').notNull(), createdAt: instant('created_at').notNull(),
}, table => [index('teeko_sessions_account').on(table.accountId), index('teeko_sessions_expiry').on(table.expiresAt)]);
export const profiles = pgTable('teeko_profiles', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }), name: text('name').notNull(), ageRange: text('age_range').notNull(), level: text('level').notNull(), updatedAt: instant('updated_at').notNull(),
}, table => [check('teeko_profiles_name_check', sql`length(${table.name}) BETWEEN 1 AND 20`), check('teeko_profiles_age_range_check', sql`${table.ageRange} IN ('8–9','10–11','12–13')`), check('teeko_profiles_level_check', sql`${table.level} IN ('starter','sentences','conversation','unsure')`)]);
export const authLimits = pgTable('teeko_auth_limits', { key: text('key').primaryKey(), count: integer('count').notNull(), startedAt: instant('started_at').notNull() });
