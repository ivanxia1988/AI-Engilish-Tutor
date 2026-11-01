CREATE TABLE IF NOT EXISTS teeko_admin_accounts (
  account_id uuid PRIMARY KEY REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teeko_teacher_models (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teeko_teacher_agents (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teeko_teacher_releases (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES teeko_teacher_agents(id),
  version integer NOT NULL CHECK (version > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES teeko_accounts(id) ON DELETE SET NULL,
  UNIQUE(agent_id,version)
);
CREATE TABLE IF NOT EXISTS teeko_teacher_active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  release_id uuid NOT NULL REFERENCES teeko_teacher_releases(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE teeko_classrooms ADD COLUMN IF NOT EXISTS teacher_config jsonb;
ALTER TABLE teeko_classrooms ADD COLUMN IF NOT EXISTS teaching_state jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS teeko_teaching_decisions (
  classroom_id uuid NOT NULL REFERENCES teeko_classrooms(id) ON DELETE CASCADE,
  connection_epoch integer NOT NULL CHECK (connection_epoch >= 0),
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  context_key text NOT NULL CHECK (length(context_key) BETWEEN 1 AND 200),
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(classroom_id,connection_epoch,item_id)
);
CREATE INDEX IF NOT EXISTS teeko_teaching_decisions_recent ON teeko_teaching_decisions(classroom_id,created_at DESC);
