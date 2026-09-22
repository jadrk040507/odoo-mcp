import { hashOpaqueToken } from "./token.js";

export interface AuthContext {
  userId: string;
  connectionId: string;
  grantId: string;
  scopes: string[];
  tokenId: string;
}

interface BearerRow {
  id: string;
  user_id: string;
  connection_id: string;
  grant_id: string;
  scope: string;
  resource: string;
}

export async function authenticateBearer(
  request: Request,
  env: Pick<Env, "DB" | "TOKEN_HASH_PEPPER">,
  now = Math.floor(Date.now() / 1000),
): Promise<AuthContext> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !env.TOKEN_HASH_PEPPER) throw new Error("invalid_token");
  const row = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.connection_id, t.grant_id, t.scope, g.resource
     FROM oauth_tokens t
     JOIN oauth_grants g ON g.id = t.grant_id
     JOIN connections c ON c.id = t.connection_id
     WHERE t.token_hash = ? AND t.token_type = 'access' AND t.revoked_at IS NULL
       AND t.expires_at > ? AND c.active = 1`,
  )
    .bind(await hashOpaqueToken(match[1], env.TOKEN_HASH_PEPPER), now)
    .first<BearerRow>();
  if (!row || row.resource !== new URL(request.url).origin + "/mcp") {
    throw new Error("invalid_token");
  }
  return {
    userId: row.user_id,
    connectionId: row.connection_id,
    grantId: row.grant_id,
    scopes: row.scope.split(" "),
    tokenId: row.id,
  };
}
