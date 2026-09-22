import { GatewayError } from "../errors.js";
import type { McpServices } from "../mcp/context.js";
import type { AuthContext } from "../oauth/bearer.js";
import { OdooClient, OdooUpstreamError } from "../odoo/client.js";
import { requiredOdooTools } from "../odoo/capabilities.js";
import { decryptCredential } from "../security/crypto.js";
import type { ConnectionRow } from "../storage/schema.js";
import type { AccountToolService } from "./account.js";
import { BusinessReadService, type ReadUpstream } from "./read.js";
import { WriteService } from "../writes/confirm.js";
import type { WriteOperation, WriteUpstream } from "../writes/types.js";
import { disconnect } from "../operations/cleanup.js";

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
  env: Pick<Env, "DB" | "CREDENTIAL_KEY_V1" | "TOKEN_HASH_PEPPER">,
  auth: AuthContext,
): Promise<McpServices> {
  if (!env.TOKEN_HASH_PEPPER) throw new GatewayError("internal_error");
  const tokenHashPepper = env.TOKEN_HASH_PEPPER;
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
    disconnect: async () => {
      await disconnect(env.DB, auth.userId, Math.floor(Date.now() / 1000));
      return { disconnected: true };
    },
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
  const operationModel: Record<WriteOperation, string> = {
    "contact.change": "res.partner",
    "opportunity.change": "crm.lead",
    "quotation.create": "sale.order",
    "quotation.update": "sale.order",
  };
  const writes: WriteUpstream = {
    read: async (operation, targetId) => {
      const result = await upstream.callTool("search", {
        model: operationModel[operation],
        domain: [["id", "=", targetId]],
        fields: [],
        limit: 1,
        offset: 0,
      });
      const records =
        result && typeof result === "object"
          ? (result as { records?: unknown }).records
          : undefined;
      return Array.isArray(records) &&
        records[0] &&
        typeof records[0] === "object"
        ? (records[0] as Record<string, unknown>)
        : null;
    },
    write: async (operation, change) => {
      if (operation === "quotation.create") {
        return upstream.callTool("create_records", {
          model: operationModel[operation],
          values: [change.changes],
        });
      }
      return upstream.callTool("update_records", {
        model: operationModel[operation],
        ids: [change.targetId],
        values: change.changes,
      });
    },
  };
  return {
    db: env.DB,
    account,
    read: new BusinessReadService(upstream),
    write: new WriteService(env.DB, tokenHashPepper, writes),
  };
}
