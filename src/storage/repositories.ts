import type {
  ConfirmationIntentRow,
  ConnectionRow,
  OAuthTokenRow,
} from "./schema.js";

export interface CreateConnection {
  id: string;
  userId: string;
  tenantOrigin: string;
  tenantHash: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  now: number;
}

export class ConnectionRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateConnection): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)")
        .bind(input.userId, input.now),
      this.db
        .prepare(
          `INSERT INTO connections
           (id, user_id, tenant_origin, tenant_hash, credential_ciphertext, credential_nonce, key_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.userId,
          input.tenantOrigin,
          input.tenantHash,
          input.ciphertext,
          input.nonce,
          input.keyVersion,
          input.now,
          input.now,
        ),
    ]);
  }

  findActiveByUser(userId: string): Promise<ConnectionRow | null> {
    return this.db
      .prepare("SELECT * FROM connections WHERE user_id = ? AND active = 1")
      .bind(userId)
      .first<ConnectionRow>();
  }
}

export class OAuthRepository {
  constructor(private readonly db: D1Database) {}

  async storeGrant(input: {
    id: string;
    userId: string;
    connectionId: string;
    clientId: string;
    scope: string;
    createdAt: number;
  }): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO oauth_grants (id, user_id, connection_id, client_id, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.id,
        input.userId,
        input.connectionId,
        input.clientId,
        input.scope,
        input.createdAt,
      )
      .run();
  }

  async storeAccessToken(input: {
    id: string;
    tokenHash: string;
    grantId: string;
    userId: string;
    connectionId: string;
    scope: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_tokens
         (id, token_hash, token_type, grant_id, user_id, connection_id, scope, created_at, expires_at)
         VALUES (?, ?, 'access', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.tokenHash,
        input.grantId,
        input.userId,
        input.connectionId,
        input.scope,
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  findAccessToken(
    tokenHash: string,
    now: number,
  ): Promise<OAuthTokenRow | null> {
    return this.db
      .prepare(
        "SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access' AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(tokenHash, now)
      .first<OAuthTokenRow>();
  }
}

export class IntentRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    id: string;
    tokenHash: string;
    connectionId: string;
    operation: string;
    changeJson: string;
    changeDigest: string;
    idempotencyKey: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO confirmation_intents
         (id, token_hash, connection_id, operation, change_json, change_digest, idempotency_key, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.tokenHash,
        input.connectionId,
        input.operation,
        input.changeJson,
        input.changeDigest,
        input.idempotencyKey,
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  consume(
    tokenHash: string,
    now: number,
  ): Promise<ConfirmationIntentRow | null> {
    return this.db
      .prepare(
        `UPDATE confirmation_intents SET consumed_at = ?
         WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING *`,
      )
      .bind(now, tokenHash, now)
      .first<ConfirmationIntentRow>();
  }
}

export class IdempotencyRepository {
  constructor(readonly db: D1Database) {}
}

export class AuditRepository {
  constructor(readonly db: D1Database) {}
}

export async function cleanupExpired(
  db: D1Database,
  now: number,
): Promise<{ tokens: number; intents: number }> {
  const results = await db.batch([
    db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?").bind(now),
    db
      .prepare("DELETE FROM confirmation_intents WHERE expires_at <= ?")
      .bind(now),
  ]);
  const [tokens, intents] = results;
  if (!tokens || !intents) throw new Error("D1 cleanup batch was incomplete");
  return { tokens: tokens.meta.changes, intents: intents.meta.changes };
}
