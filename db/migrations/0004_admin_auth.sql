CREATE TABLE IF NOT EXISTS teeko_admin_credentials (
  username text PRIMARY KEY CHECK (username ~ '^[a-z][a-z0-9_-]{2,31}$'),
  account_id uuid NOT NULL UNIQUE REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS teeko_admin_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES teeko_admin_credentials(account_id) ON DELETE CASCADE REFERENCES teeko_admin_accounts(account_id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS teeko_admin_sessions_account ON teeko_admin_sessions(account_id);
CREATE INDEX IF NOT EXISTS teeko_admin_sessions_expiry ON teeko_admin_sessions(expires_at);
