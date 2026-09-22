export async function disconnect(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const active = await db
    .prepare("SELECT id FROM connections WHERE user_id = ? AND active = 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!active) return;
  await db.batch([
    db
      .prepare(
        "UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      )
      .bind(now, userId),
    db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      )
      .bind(now, userId),
    db
      .prepare("DELETE FROM confirmation_intents WHERE connection_id = ?")
      .bind(active.id),
    db
      .prepare("DELETE FROM idempotency_results WHERE connection_id = ?")
      .bind(active.id),
    db
      .prepare(
        "UPDATE connections SET active = 0, credential_ciphertext = NULL, credential_nonce = NULL, key_version = NULL, updated_at = ? WHERE id = ? AND active = 1",
      )
      .bind(now, active.id),
  ]);
}

export async function cleanupOperationalData(
  db: D1Database,
  now: number,
  retention: { auditBefore: number; idempotencyBefore: number },
) {
  const results = await db.batch([
    db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?").bind(now),
    db
      .prepare("DELETE FROM client_assertion_jti WHERE expires_at <= ?")
      .bind(now),
    db
      .prepare("DELETE FROM confirmation_intents WHERE expires_at <= ?")
      .bind(now),
    db
      .prepare(
        "DELETE FROM idempotency_results WHERE updated_at <= ? AND state <> 'pending'",
      )
      .bind(retention.idempotencyBefore),
    db
      .prepare("DELETE FROM audit_events WHERE created_at <= ?")
      .bind(retention.auditBefore),
  ]);
  const [codes, tokens, assertions, intents, idempotency, audit] = results;
  return {
    codes: codes!.meta.changes,
    tokens: tokens!.meta.changes,
    assertions: assertions!.meta.changes,
    intents: intents!.meta.changes,
    idempotency: idempotency!.meta.changes,
    audit: audit!.meta.changes,
  };
}
