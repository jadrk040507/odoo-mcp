const accessLifetime = 60 * 60;
const refreshLifetime = 30 * 24 * 60 * 60;
const codeLifetime = 5 * 60;

export interface AuthorizationCodeInput {
  userId: string;
  connectionId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

interface GrantRow {
  grant_id: string;
  user_id: string;
  connection_id: string;
  client_id: string;
  scope: string;
  resource: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: number;
  consumed_at: number | null;
}

interface RefreshRow {
  id: string;
  grant_id: string;
  user_id: string;
  connection_id: string;
  scope: string;
  expires_at: number;
  revoked_at: number | null;
  consumed_at: number | null;
  family_id: string;
  client_id: string;
  resource: string;
}

function randomToken(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashOpaqueToken(
  token: string,
  pepper: string,
): Promise<string> {
  return hash(`${token}${pepper}`);
}

export async function issueAuthorizationCode(
  db: D1Database,
  input: AuthorizationCodeInput,
  now: number,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    throw new Error("invalid_request");
  }
  const grantId = crypto.randomUUID();
  const codeId = crypto.randomUUID();
  const code = randomToken();
  await db.batch([
    db
      .prepare(
        `INSERT INTO oauth_grants
         (id, user_id, connection_id, client_id, scope, created_at, resource)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        grantId,
        input.userId,
        input.connectionId,
        input.clientId,
        input.scope,
        now,
        input.resource,
      ),
    db
      .prepare(
        `INSERT INTO oauth_codes
         (id, code_hash, grant_id, redirect_uri, code_challenge, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        codeId,
        await hash(code),
        grantId,
        input.redirectUri,
        input.codeChallenge,
        now + codeLifetime,
      ),
  ]);
  return code;
}

async function issueTokenPair(
  db: D1Database,
  grant: Pick<RefreshRow, "grant_id" | "user_id" | "connection_id" | "scope">,
  pepper: string,
  now: number,
  familyId = crypto.randomUUID(),
  parentTokenId: string | null = null,
): Promise<TokenResponse> {
  const access = randomToken();
  const refresh = randomToken();
  const accessId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO oauth_tokens
         (id, token_hash, token_type, grant_id, user_id, connection_id, scope, created_at, expires_at, family_id, parent_token_id)
         VALUES (?, ?, 'access', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        accessId,
        await hashOpaqueToken(access, pepper),
        grant.grant_id,
        grant.user_id,
        grant.connection_id,
        grant.scope,
        now,
        now + accessLifetime,
        familyId,
        parentTokenId,
      ),
    db
      .prepare(
        `INSERT INTO oauth_tokens
         (id, token_hash, token_type, grant_id, user_id, connection_id, scope, created_at, expires_at, family_id, parent_token_id)
         VALUES (?, ?, 'refresh', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        refreshId,
        await hashOpaqueToken(refresh, pepper),
        grant.grant_id,
        grant.user_id,
        grant.connection_id,
        grant.scope,
        now,
        now + refreshLifetime,
        familyId,
        parentTokenId,
      ),
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: accessLifetime,
    scope: grant.scope,
  };
}

export async function exchangeAuthorizationCode(
  db: D1Database,
  input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
    resource: string;
  },
  pepper: string,
  now: number,
): Promise<TokenResponse> {
  const row = await db
    .prepare(
      `SELECT g.id AS grant_id, g.user_id, g.connection_id, g.client_id, g.scope, g.resource,
              c.redirect_uri, c.code_challenge, c.expires_at, c.consumed_at
       FROM oauth_codes c JOIN oauth_grants g ON g.id = c.grant_id
       WHERE c.code_hash = ?`,
    )
    .bind(await hash(input.code))
    .first<GrantRow>();
  const challenge = await hash(input.codeVerifier);
  if (
    !row ||
    row.consumed_at !== null ||
    row.expires_at <= now ||
    row.client_id !== input.clientId ||
    row.redirect_uri !== input.redirectUri ||
    row.resource !== input.resource ||
    challenge !== row.code_challenge
  ) {
    throw new Error("invalid_grant");
  }
  const claimed = await db
    .prepare(
      "UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(now, await hash(input.code), now)
    .run();
  if (claimed.meta.changes !== 1) throw new Error("invalid_grant");
  return issueTokenPair(db, row, pepper, now);
}

export async function refreshAccessToken(
  db: D1Database,
  refreshToken: string,
  clientId: string,
  resource: string,
  pepper: string,
  now: number,
): Promise<TokenResponse> {
  const tokenHash = await hashOpaqueToken(refreshToken, pepper);
  const row = await db
    .prepare(
      `SELECT t.*, g.client_id, g.resource
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
       WHERE t.token_hash = ? AND t.token_type = 'refresh'`,
    )
    .bind(tokenHash)
    .first<RefreshRow>();
  if (!row || row.client_id !== clientId || row.resource !== resource) {
    throw new Error("invalid_grant");
  }
  if (row.consumed_at !== null || row.revoked_at !== null) {
    await db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?",
      )
      .bind(now, row.family_id)
      .run();
    throw new Error("invalid_grant");
  }
  if (row.expires_at <= now) throw new Error("invalid_grant");
  const access = randomToken();
  const refresh = randomToken();
  const accessId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  const rotationNonce = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE oauth_tokens SET consumed_at = ?, rotation_nonce = ?
         WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now, rotationNonce, row.id, now),
    db
      .prepare(
        `INSERT INTO oauth_tokens
         (id, token_hash, token_type, grant_id, user_id, connection_id, scope, created_at, expires_at, family_id, parent_token_id)
         SELECT ?, ?, 'access', ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM oauth_tokens WHERE id = ? AND rotation_nonce = ? AND revoked_at IS NULL)`,
      )
      .bind(
        accessId,
        await hashOpaqueToken(access, pepper),
        row.grant_id,
        row.user_id,
        row.connection_id,
        row.scope,
        now,
        now + accessLifetime,
        row.family_id,
        row.id,
        row.id,
        rotationNonce,
      ),
    db
      .prepare(
        `INSERT INTO oauth_tokens
         (id, token_hash, token_type, grant_id, user_id, connection_id, scope, created_at, expires_at, family_id, parent_token_id)
         SELECT ?, ?, 'refresh', ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM oauth_tokens WHERE id = ? AND rotation_nonce = ? AND revoked_at IS NULL)`,
      )
      .bind(
        refreshId,
        await hashOpaqueToken(refresh, pepper),
        row.grant_id,
        row.user_id,
        row.connection_id,
        row.scope,
        now,
        now + refreshLifetime,
        row.family_id,
        row.id,
        row.id,
        rotationNonce,
      ),
  ]);
  if (
    results[0]?.meta.changes !== 1 ||
    results[1]?.meta.changes !== 1 ||
    results[2]?.meta.changes !== 1
  ) {
    await db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?",
      )
      .bind(now, row.family_id)
      .run();
    throw new Error("invalid_grant");
  }
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: accessLifetime,
    scope: row.scope,
  };
}
