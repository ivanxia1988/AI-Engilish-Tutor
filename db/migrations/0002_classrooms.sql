CREATE TABLE IF NOT EXISTS teeko_courses (
  id text NOT NULL,
  version text NOT NULL,
  manifest jsonb NOT NULL,
  checksum text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS teeko_preferences (
  account_id uuid PRIMARY KEY REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS teeko_classrooms (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  course_version text NOT NULL,
  profile jsonb NOT NULL,
  preferences jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('preflight','active','paused','ended')),
  revision integer NOT NULL DEFAULT 0,
  connection_epoch integer NOT NULL DEFAULT 0,
  step_index integer NOT NULL DEFAULT 0,
  elapsed_ms bigint NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  max_ms bigint NOT NULL CHECK (max_ms > 0),
  limit_reason text NOT NULL DEFAULT 'time_limit',
  active_since timestamptz,
  owner_token uuid,
  lease_until timestamptz,
  provider_session_id text,
  outcomes jsonb NOT NULL DEFAULT '[]',
  helped_steps jsonb NOT NULL DEFAULT '[]',
  teacher_object_ids jsonb NOT NULL DEFAULT '[]',
  feedback jsonb,
  started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  end_reason text,
  day_key text NOT NULL,
  FOREIGN KEY (course_id,course_version) REFERENCES teeko_courses(id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS teeko_one_active_classroom ON teeko_classrooms(account_id) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS teeko_classroom_history ON teeko_classrooms(account_id,started_at DESC);
CREATE TABLE IF NOT EXISTS teeko_classroom_actions (
  classroom_id uuid NOT NULL REFERENCES teeko_classrooms(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  PRIMARY KEY (classroom_id,event_id)
);
CREATE TABLE IF NOT EXISTS teeko_classroom_usage (
  account_id uuid NOT NULL REFERENCES teeko_accounts(id) ON DELETE CASCADE,
  day_key text NOT NULL,
  milliseconds bigint NOT NULL CHECK(milliseconds >= 0),
  PRIMARY KEY(account_id,day_key)
);
CREATE TABLE IF NOT EXISTS teeko_classroom_transcripts (
  classroom_id uuid NOT NULL REFERENCES teeko_classrooms(id) ON DELETE CASCADE,
  connection_epoch integer NOT NULL,
  item_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('child','teacher')),
  source text NOT NULL DEFAULT 'speech' CHECK (source IN ('speech','typed')),
  text text NOT NULL CHECK (length(text) <= 1000),
  step_index integer NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (classroom_id,connection_epoch,item_id,role)
);
