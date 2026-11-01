CREATE TABLE IF NOT EXISTS teeko_model_credentials (
  model_id uuid PRIMARY KEY REFERENCES teeko_teacher_models(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('qwen','openai')),
  revision integer NOT NULL CHECK (revision > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  updated_at timestamptz NOT NULL,
  CHECK (
    (ciphertext IS NULL AND nonce IS NULL AND auth_tag IS NULL) OR
    (ciphertext IS NOT NULL AND nonce IS NOT NULL AND auth_tag IS NOT NULL AND
     octet_length(ciphertext) BETWEEN 1 AND 4096 AND
     octet_length(nonce) = 12 AND octet_length(auth_tag) = 16)
  )
);
