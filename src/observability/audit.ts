import { pseudonymizeTenant } from "./redact.js";

export interface AuditEvent {
  id: string;
  requestId: string;
  tenantHost?: string;
  tool?: string;
  durationMs: number;
  statusClass: string;
  errorCategory?: string;
  timestamp: number;
}

export async function audit(
  env: Pick<Env, "DB" | "AUDIT_HASH_KEY">,
  event: AuditEvent,
): Promise<void> {
  if (!env.AUDIT_HASH_KEY) {
    throw new Error("AUDIT_HASH_KEY is required");
  }

  const tenantHash = event.tenantHost
    ? await pseudonymizeTenant(event.tenantHost, env.AUDIT_HASH_KEY)
    : null;

  await env.DB.prepare(
    `INSERT INTO audit_events
     (id, request_id, tenant_hash, tool_name, duration_ms, status_class, error_category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.id,
      event.requestId,
      tenantHash,
      event.tool ?? null,
      event.durationMs,
      event.statusClass,
      event.errorCategory ?? null,
      event.timestamp,
    )
    .run();
}
