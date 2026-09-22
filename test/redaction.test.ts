import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { audit } from "../src/observability/audit.js";
import { pseudonymizeTenant, redact } from "../src/observability/redact.js";

describe("observability redaction", () => {
  it("removes sensitive fields recursively without changing safe metadata", () => {
    expect(
      redact({
        requestId: "req-1",
        authorization: "Bearer secret",
        nested: { api_key: "key", client_assertion: "jwt", status: 401 },
        record: { name: "Customer" },
        payload: ["business data"],
      }),
    ).toEqual({
      requestId: "req-1",
      authorization: "[REDACTED]",
      nested: {
        api_key: "[REDACTED]",
        client_assertion: "[REDACTED]",
        status: 401,
      },
      record: "[REDACTED]",
      payload: "[REDACTED]",
    });
  });

  it("creates stable keyed tenant pseudonyms", async () => {
    const first = await pseudonymizeTenant("acme.odoo.com", "audit-secret");
    expect(first).toBe(
      await pseudonymizeTenant("acme.odoo.com", "audit-secret"),
    );
    expect(first).not.toContain("acme");
    expect(first).not.toBe(
      await pseudonymizeTenant("other.odoo.com", "audit-secret"),
    );
  });

  it("stores only the closed audit event shape and a tenant pseudonym", async () => {
    await audit(
      { DB: env.DB, AUDIT_HASH_KEY: "audit-secret" },
      {
        id: "audit-1",
        requestId: "request-1",
        tenantHost: "acme.odoo.com",
        tool: "search_contacts",
        durationMs: 25,
        statusClass: "2xx",
        timestamp: 100,
      },
    );

    const row = await env.DB.prepare("SELECT * FROM audit_events WHERE id = ?")
      .bind("audit-1")
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      request_id: "request-1",
      tool_name: "search_contacts",
      duration_ms: 25,
      status_class: "2xx",
    });
    expect(row?.tenant_hash).not.toBe("acme.odoo.com");
    expect(row).not.toHaveProperty("payload");
  });
});
