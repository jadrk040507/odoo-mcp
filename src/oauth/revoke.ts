import { hashOpaqueToken } from "./token.js";

export async function revokeToken(
  db: D1Database,
  token: string,
  pepper: string,
  now: number,
): Promise<void> {
  const row = await db
    .prepare("SELECT family_id FROM oauth_tokens WHERE token_hash = ?")
    .bind(await hashOpaqueToken(token, pepper))
    .first<{ family_id: string | null }>();
  if (!row) return;
  if (row.family_id) {
    await db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?",
      )
      .bind(now, row.family_id)
      .run();
  }
}
