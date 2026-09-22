import {
  decryptCredential,
  encryptCredential,
  type CredentialKeys,
} from "../security/crypto.js";

interface RotationRow {
  id: string;
  credential_ciphertext: string;
  credential_nonce: string;
  key_version: number;
}

export async function reencryptConnections(
  db: D1Database,
  keys: CredentialKeys,
  batchSize: number,
  cursor = "",
): Promise<{ processed: number; nextCursor?: string }> {
  const limit = Math.max(1, Math.min(100, Math.trunc(batchSize)));
  const rows = await db
    .prepare(
      "SELECT id, credential_ciphertext, credential_nonce, key_version FROM connections WHERE active = 1 AND credential_ciphertext IS NOT NULL AND key_version <> ? AND id > ? ORDER BY id LIMIT ?",
    )
    .bind(keys.currentVersion, cursor, limit)
    .all<RotationRow>();
  let processed = 0;
  let nextCursor: string | undefined;
  for (const row of rows.results) {
    let plaintext = await decryptCredential(
      row.id,
      {
        ciphertext: row.credential_ciphertext,
        nonce: row.credential_nonce,
        keyVersion: row.key_version,
      },
      keys,
    );
    try {
      const encrypted = await encryptCredential(row.id, plaintext, keys);
      await db
        .prepare(
          "UPDATE connections SET credential_ciphertext = ?, credential_nonce = ?, key_version = ?, updated_at = ? WHERE id = ? AND key_version = ?",
        )
        .bind(
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.keyVersion,
          Math.floor(Date.now() / 1000),
          row.id,
          row.key_version,
        )
        .run();
      processed += 1;
      nextCursor = row.id;
    } finally {
      plaintext = "";
    }
  }
  return nextCursor ? { processed, nextCursor } : { processed };
}
