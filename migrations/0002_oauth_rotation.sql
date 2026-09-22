ALTER TABLE oauth_grants ADD COLUMN resource TEXT NOT NULL DEFAULT '';

ALTER TABLE oauth_tokens ADD COLUMN family_id TEXT;
ALTER TABLE oauth_tokens ADD COLUMN parent_token_id TEXT;
ALTER TABLE oauth_tokens ADD COLUMN consumed_at INTEGER;
ALTER TABLE oauth_tokens ADD COLUMN rotation_nonce TEXT;

CREATE INDEX oauth_tokens_family ON oauth_tokens(family_id);
