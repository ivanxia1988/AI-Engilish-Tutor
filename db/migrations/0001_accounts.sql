CREATE TABLE IF NOT EXISTS teeko_accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS teeko_invitations (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  issued_by text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  disabled_at timestamptz,
  redeemed_by uuid REFERENCES teeko_accounts(id),
  redeemed_at timestamptz,
  CHECK ((redeemed_by IS NULL) = (redeemed_at IS NULL))
);
CREATE TABLE IF NOT EXISTS teeko_account_flows (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('register','reset')),
  invitation_id uuid REFERENCES teeko_invitations(id),
  email text,
  account_version integer,
  stage text NOT NULL CHECK (stage IN ('email','code','password')),
  otp_hash text,
  otp_expires_at timestamptz,
  otp_ready boolean NOT NULL DEFAULT false,
  delivery_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  sends integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS teeko_account_flows_expiry ON teeko_account_flows(expires_at);
CREATE TABLE IF NOT EXISTS teeko_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS teeko_sessions_account ON teeko_sessions(account_id);
CREATE INDEX IF NOT EXISTS teeko_sessions_expiry ON teeko_sessions(expires_at);
CREATE TABLE IF NOT EXISTS teeko_profiles (
  account_id uuid PRIMARY KEY REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  age_range text NOT NULL CHECK (age_range IN ('8–9','10–11','12–13')),
  level text NOT NULL CHECK (level IN ('starter','sentences','conversation','unsure')),
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS teeko_auth_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  started_at timestamptz NOT NULL
);
