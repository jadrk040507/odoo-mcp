import { pseudonymizeTenant } from "../observability/redact.js";
import { missingRequiredTools } from "../odoo/capabilities.js";
import { OdooClient, OdooUpstreamError } from "../odoo/client.js";
import { encryptCredential, type CredentialKeys } from "../security/crypto.js";
import {
  CloudflareDnsResolver,
  type DnsResolver,
  validateTenantOrigin,
} from "../security/tenant-url.js";
import { ConnectionRepository } from "../storage/repositories.js";

export interface ConnectionProfile {
  connectionId: string;
  tenantOrigin: string;
  healthy: true;
  tools: string[];
}

export interface ConnectionServiceDependencies {
  db: D1Database;
  keys: CredentialKeys;
  createClient?: (origin: string, apiKey: string) => OdooClient;
  now?: () => number;
  resolver?: DnsResolver;
}

export class ConnectionService {
  private readonly createClient: (origin: string, apiKey: string) => OdooClient;
  private readonly now: () => number;
  private readonly resolver: DnsResolver;

  constructor(private readonly dependencies: ConnectionServiceDependencies) {
    this.createClient =
      dependencies.createClient ??
      ((origin, apiKey) => new OdooClient(origin, apiKey));
    this.now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
    this.resolver = dependencies.resolver ?? new CloudflareDnsResolver();
  }

  async verifyAndSave(
    userId: string,
    origin: string,
    apiKey: string,
  ): Promise<ConnectionProfile> {
    const tenant = await validateTenantOrigin(origin, this.resolver);
    const client = this.createClient(tenant.origin, apiKey);
    let tools: string[];
    try {
      const profile = await client.initialize();
      tools = profile.tools;
      if (missingRequiredTools(tools).length > 0) {
        throw new OdooUpstreamError("capability_unavailable");
      }
    } finally {
      await client.close();
    }

    const connectionId = crypto.randomUUID();
    const encrypted = await encryptCredential(
      connectionId,
      apiKey,
      this.dependencies.keys,
    );
    const now = this.now();
    await new ConnectionRepository(this.dependencies.db).replaceActive({
      id: connectionId,
      userId,
      tenantOrigin: tenant.origin,
      tenantHash: await pseudonymizeTenant(
        tenant.origin,
        this.dependencies.keys.versions[
          this.dependencies.keys.currentVersion
        ] ?? "",
      ),
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      keyVersion: encrypted.keyVersion,
      now,
    });
    return {
      connectionId,
      tenantOrigin: tenant.origin,
      healthy: true,
      tools,
    };
  }

  async status(userId: string): Promise<{
    connected: boolean;
    connectionId?: string;
    tenantOrigin?: string;
  }> {
    const row = await new ConnectionRepository(
      this.dependencies.db,
    ).findActiveByUser(userId);
    return row
      ? {
          connected: true,
          connectionId: row.id,
          tenantOrigin: row.tenant_origin,
        }
      : { connected: false };
  }

  async delete(userId: string): Promise<void> {
    await this.dependencies.db
      .prepare(
        `UPDATE connections
         SET active = 0, credential_ciphertext = NULL, credential_nonce = NULL,
             key_version = NULL, updated_at = ?
         WHERE user_id = ? AND active = 1`,
      )
      .bind(this.now(), userId)
      .run();
  }
}
