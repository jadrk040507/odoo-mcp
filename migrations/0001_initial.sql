PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_origin TEXT NOT NULL,
  tenant_hash TEXT NOT NULL,
  credential_ciphertext TEXT,
  credential_nonce TEXT,
  key_version INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_active_connection_per_user ON connections(user_id) WHERE active = 1;

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE TABLE oauth_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE INDEX oauth_codes_expiry ON oauth_codes(expires_at);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX oauth_tokens_expiry ON oauth_tokens(expires_at);

CREATE TABLE client_assertion_jti (
  client_id TEXT NOT NULL,
  jti_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, jti_hash)
) STRICT;

CREATE TABLE confirmation_intents (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  change_json TEXT NOT NULL,
  change_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE INDEX confirmation_intents_expiry ON confirmation_intents(expires_at);

CREATE TABLE idempotency_results (
  idempotency_key TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed_retryable', 'failed_terminal')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  tenant_hash TEXT,
  tool_name TEXT,
  duration_ms INTEGER NOT NULL,
  status_class TEXT NOT NULL,
  error_category TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX audit_events_created_at ON audit_events(created_at);
