import { GatewayError } from "../errors.js";
import type { McpServices } from "../mcp/context.js";
import type { AuthContext } from "../oauth/bearer.js";
import { OdooClient, OdooUpstreamError } from "../odoo/client.js";
import { requiredOdooTools } from "../odoo/capabilities.js";
import { decryptCredential } from "../security/crypto.js";
import type { ConnectionRow } from "../storage/schema.js";
import type { AccountToolService } from "./account.js";
import { BusinessReadService, type ReadUpstream } from "./read.js";

function gatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof OdooUpstreamError) {
    const mapping = {
      credential_rejected: "credential_expired_or_revoked",
      permission_denied: "permission_denied",
      rate_limited: "rate_limited",
      capability_unavailable: "capability_unavailable",
      malformed_response: "tenant_unreachable",
      tenant_unreachable: "tenant_unreachable",
    } as const;
    return new GatewayError(mapping[error.category]);
  }
  return new GatewayError("internal_error");
}

function unwrapToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const typed = result as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (typed.structuredContent !== undefined) return typed.structuredContent;
  const text = typed.content?.find((entry) => entry.type === "text")?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError("tenant_unreachable");
  }
}

async function activeConnection(
  db: D1Database,
  connectionId: string,
): Promise<ConnectionRow> {
  const row = await db
    .prepare("SELECT * FROM connections WHERE id = ? AND active = 1")
    .bind(connectionId)
    .first<ConnectionRow>();
  if (
    !row?.credential_ciphertext ||
    !row.credential_nonce ||
    !row.key_version
  ) {
    throw new GatewayError("connection_required");
  }
  return row;
}

export async function createDefaultToolServices(
  env: Pick<Env, "DB" | "CREDENTIAL_KEY_V1">,
  auth: AuthContext,
  publicOrigin: string,
): Promise<McpServices> {
  const account: AccountToolService = {
    profile: async () => {
      const row = await activeConnection(env.DB, auth.connectionId);
      return {
        tenantHost: new URL(row.tenant_origin).hostname,
        user: null,
        activeCompany: null,
        companies: [],
        locale: null,
        health: "ok",
      };
    },
    capabilities: async () => ({
      nativeTools: [...requiredOdooTools],
      reads: true,
      previewedWrites: auth.scopes.includes("odoo.write"),
    }),
    disconnect: async () => ({
      confirmationUrl: `${publicOrigin}/connection/delete`,
    }),
  };

  const upstream: ReadUpstream = {
    capabilities: new Set(requiredOdooTools),
    callTool: async (name, args) => {
      const row = await activeConnection(env.DB, auth.connectionId);
      if (!env.CREDENTIAL_KEY_V1 || row.key_version !== 1) {
        throw new GatewayError("credential_expired_or_revoked");
      }
      let apiKey = "";
      let client: OdooClient | undefined;
      try {
        apiKey = await decryptCredential(
          row.id,
          {
            ciphertext: row.credential_ciphertext!,
            nonce: row.credential_nonce!,
            keyVersion: row.key_version!,
          },
          { currentVersion: 1, versions: { 1: env.CREDENTIAL_KEY_V1 } },
        );
        client = new OdooClient(row.tenant_origin, apiKey);
        await client.initialize();
        return unwrapToolResult(await client.callTool(name, args));
      } catch (error) {
        throw gatewayError(error);
      } finally {
        apiKey = "";
        if (client) await client.close();
      }
    },
  };
  return { db: env.DB, account, read: new BusinessReadService(upstream) };
}
