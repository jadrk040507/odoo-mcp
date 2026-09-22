import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WriteService } from "../src/writes/confirm.js";

describe("write concurrency", () => {
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
    ]);
  });

  it("executes one upstream write and returns the same safe receipt", async () => {
    const upstream = {
      read: vi.fn().mockResolvedValue({ name: "Old" }),
      write: vi.fn().mockResolvedValue({ id: 91, name: "sensitive" }),
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
    const [first, second] = await Promise.all([
      service.confirm("connection-a", "contact.change", input, 1_001),
      service.confirm("connection-a", "contact.change", input, 1_001),
    ]);
    expect(upstream.write).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        status: "succeeded",
        operation: "contact.change",
      }),
    );
    const stored = await env.DB.prepare(
      "SELECT result_json FROM idempotency_results",
    ).first<{ result_json: string }>();
    expect(stored?.result_json).not.toContain("sensitive");
  });
});
