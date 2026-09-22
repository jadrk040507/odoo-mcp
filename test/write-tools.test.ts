import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "../src/errors.js";
import { WriteService } from "../src/writes/confirm.js";
import { normalizeWrite } from "../src/writes/normalize.js";

describe("write pipeline", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM idempotency_results"),
      env.DB.prepare("DELETE FROM confirmation_intents"),
      env.DB.prepare("DELETE FROM connections"),
      env.DB.prepare("DELETE FROM users"),
      env.DB.prepare("INSERT INTO users (id, created_at) VALUES ('user-a', 0)"),
      env.DB.prepare(
        "INSERT INTO connections (id, user_id, tenant_origin, tenant_hash, credential_ciphertext, credential_nonce, key_version, created_at, updated_at) VALUES ('connection-a', 'user-a', 'https://a.odoo.com', 'h', 'c', 'n', 1, 0, 0)",
      ),
      env.DB.prepare("INSERT INTO users (id, created_at) VALUES ('user-b', 0)"),
      env.DB.prepare(
        "INSERT INTO connections (id, user_id, tenant_origin, tenant_hash, credential_ciphertext, credential_nonce, key_version, created_at, updated_at) VALUES ('connection-b', 'user-b', 'https://b.odoo.com', 'h', 'c', 'n', 1, 0, 0)",
      ),
    ]);
  });

  it("normalizes approved changes and rejects immutable or status fields", () => {
    expect(
      normalizeWrite("contact.change", {
        targetId: 7,
        changes: { name: " Ada ", email: " ADA@example.com " },
      }),
    ).toEqual({
      targetId: 7,
      changes: { email: "ADA@example.com", name: "Ada" },
    });
    expect(() =>
      normalizeWrite("contact.change", { targetId: 7, changes: { id: 8 } }),
    ).toThrow(GatewayError);
    expect(() =>
      normalizeWrite("quotation.update", {
        targetId: 7,
        changes: { state: "sale" },
      }),
    ).toThrow(GatewayError);
    expect(() =>
      normalizeWrite("quotation.create", { changes: { unlink: true } }),
    ).toThrow(GatewayError);
  });

  it("requires explicit confirmation and binds token to connection and operation", async () => {
    const upstream = {
      read: vi.fn().mockResolvedValue({ name: "Old" }),
      write: vi.fn().mockResolvedValue({ id: 7 }),
    };
    const service = new WriteService(env.DB, "pepper", upstream);
    const preview = await service.preview(
      "connection-a",
      "contact.change",
      { targetId: 7, changes: { name: "New" } },
      1_000,
    );
    await expect(
      service.confirm(
        "connection-a",
        "contact.change",
        { intentToken: preview.intentToken, confirmed: false as true },
        1_001,
      ),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await expect(
      service.confirm(
        "connection-b",
        "contact.change",
        { intentToken: preview.intentToken, confirmed: true },
        1_001,
      ),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await expect(
      service.confirm(
        "connection-a",
        "opportunity.change",
        { intentToken: preview.intentToken, confirmed: true },
        1_001,
      ),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(upstream.write).not.toHaveBeenCalled();
  });

  it("expires intents and stores neither API keys nor upstream payloads", async () => {
    const secret = "ODOO_TEST_SECRET";
    const upstream = {
      read: vi.fn().mockResolvedValue({ name: "Old" }),
      write: vi.fn().mockResolvedValue({ id: 7, secret }),
    };
    const service = new WriteService(env.DB, "pepper", upstream);
    const preview = await service.preview(
      "connection-a",
      "contact.change",
      { targetId: 7, changes: { name: "New" } },
      1_000,
    );
    await expect(
      service.confirm(
        "connection-a",
        "contact.change",
        { intentToken: preview.intentToken, confirmed: true },
        preview.expiresAt,
      ),
    ).rejects.toMatchObject({ code: "confirmation_expired" });
    const stored = await env.DB.prepare(
      "SELECT change_json FROM confirmation_intents",
    ).first<{ change_json: string }>();
    expect(stored?.change_json).not.toContain(secret);
  });

  it("rejects a tampered stored change before calling Odoo", async () => {
    const upstream = {
      read: vi.fn().mockResolvedValue({ name: "Old" }),
      write: vi.fn(),
    };
    const service = new WriteService(env.DB, "pepper", upstream);
    const preview = await service.preview(
      "connection-a",
      "contact.change",
      { targetId: 7, changes: { name: "New" } },
      1_000,
    );
    await env.DB.prepare("UPDATE confirmation_intents SET change_json = ?")
      .bind('{"changes":{"name":"Injected"},"targetId":7}')
      .run();
    await expect(
      service.confirm(
        "connection-a",
        "contact.change",
        { intentToken: preview.intentToken, confirmed: true },
        1_001,
      ),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(upstream.write).not.toHaveBeenCalled();
  });

  it("never retries an ambiguous upstream write failure", async () => {
    const upstream = {
      read: vi.fn().mockResolvedValue({ name: "Old" }),
      write: vi.fn().mockRejectedValue(new GatewayError("upstream_timeout")),
    };
    const service = new WriteService(env.DB, "pepper", upstream);
    const preview = await service.preview(
      "connection-a",
      "contact.change",
      { targetId: 7, changes: { name: "New" } },
      1_000,
    );
    const input = {
      intentToken: preview.intentToken,
      confirmed: true as const,
    };
    await expect(
      service.confirm("connection-a", "contact.change", input, 1_001),
    ).rejects.toMatchObject({ code: "upstream_timeout" });
    await expect(
      service.confirm("connection-a", "contact.change", input, 1_002),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(upstream.write).toHaveBeenCalledTimes(1);
  });
});
