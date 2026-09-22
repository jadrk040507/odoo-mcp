import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { disconnect } from "../../src/operations/cleanup.js";
import { ConnectionRepository } from "../../src/storage/repositories.js";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tokens"),
    env.DB.prepare("DELETE FROM oauth_grants"),
    env.DB.prepare("DELETE FROM connections"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

describe("disconnect acceptance", () => {
  it("removes credential material and is stable under duplicate delivery", async () => {
    await new ConnectionRepository(env.DB).create({
      id: "conn",
      userId: "user",
      tenantOrigin: "https://acme.odoo.com",
      tenantHash: "h",
      ciphertext: "secret-ciphertext",
      nonce: "secret-nonce",
      keyVersion: 1,
      now: 1,
    });
    await Promise.all([
      disconnect(env.DB, "user", 2),
      disconnect(env.DB, "user", 2),
    ]);
    const row = await env.DB.prepare(
      "SELECT active, credential_ciphertext, credential_nonce FROM connections WHERE id='conn'",
    ).first<Record<string, unknown>>();
    expect(row).toEqual({
      active: 0,
      credential_ciphertext: null,
      credential_nonce: null,
    });
  });
});
