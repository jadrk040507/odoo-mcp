import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { ConnectionService } from "../src/connection/service.js";
import { connectionRoutes } from "../src/connection/routes.js";
import type { OdooClient } from "../src/odoo/client.js";
import { ConnectionRepository } from "../src/storage/repositories.js";

const encodedKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replaceAll("=", "");

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tokens"),
    env.DB.prepare("DELETE FROM oauth_codes"),
    env.DB.prepare("DELETE FROM oauth_grants"),
    env.DB.prepare("DELETE FROM connections"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

function fakeClient(tools: string[], failure?: Error): OdooClient {
  return {
    initialize: async () => {
      if (failure) throw failure;
      return { server: { name: "Odoo", version: "19.4" }, tools };
    },
    listTools: async () => tools.map((name) => ({ name })),
    callTool: async () => ({}),
    close: async () => undefined,
  } as unknown as OdooClient;
}

const requiredTools = [
  "get_models",
  "get_fields",
  "search",
  "read_group",
  "create_records",
  "update_records",
];

const publicResolver = {
  resolve: async () => ({ addresses: ["8.8.8.8"], ttl: 60 }),
};

describe("ConnectionService", () => {
  it("verifies before encrypting and stores no plaintext API key", async () => {
    const service = new ConnectionService({
      db: env.DB,
      keys: { currentVersion: 1, versions: { 1: encodedKey } },
      createClient: () => fakeClient(requiredTools),
      now: () => 100,
      resolver: publicResolver,
    });
    const profile = await service.verifyAndSave(
      "user-1",
      "https://acme.odoo.com",
      "ODOO_TEST_SECRET",
    );
    expect(profile).toMatchObject({
      tenantOrigin: "https://acme.odoo.com",
      healthy: true,
    });
    const row = await new ConnectionRepository(env.DB).findActiveByUser(
      "user-1",
    );
    expect(row?.credential_ciphertext).not.toContain("ODOO_TEST_SECRET");
  });

  it("rejects missing capability and preserves an existing connection on failed replacement", async () => {
    const good = new ConnectionService({
      db: env.DB,
      keys: { currentVersion: 1, versions: { 1: encodedKey } },
      createClient: () => fakeClient(requiredTools),
      now: () => 100,
      resolver: publicResolver,
    });
    const first = await good.verifyAndSave(
      "user-1",
      "https://one.odoo.com",
      "first-secret",
    );
    const bad = new ConnectionService({
      db: env.DB,
      keys: { currentVersion: 1, versions: { 1: encodedKey } },
      createClient: () => fakeClient(["search"]),
      now: () => 101,
      resolver: publicResolver,
    });
    await expect(
      bad.verifyAndSave("user-1", "https://two.odoo.com", "bad-secret"),
    ).rejects.toThrow("capability_unavailable");
    expect(
      await new ConnectionRepository(env.DB).findActiveByUser("user-1"),
    ).toMatchObject({
      id: first.connectionId,
      tenant_origin: "https://one.odoo.com",
    });
  });

  it("reports status and deletes credential material", async () => {
    const service = new ConnectionService({
      db: env.DB,
      keys: { currentVersion: 1, versions: { 1: encodedKey } },
      createClient: () => fakeClient(requiredTools),
      now: () => 100,
      resolver: publicResolver,
    });
    await service.verifyAndSave(
      "user-1",
      "https://acme.odoo.com",
      "ODOO_TEST_SECRET",
    );
    await expect(service.status("user-1")).resolves.toMatchObject({
      connected: true,
      tenantOrigin: "https://acme.odoo.com",
    });
    await service.delete("user-1");
    await expect(service.status("user-1")).resolves.toEqual({
      connected: false,
    });
    const row = await env.DB.prepare(
      "SELECT credential_ciphertext, credential_nonce, key_version FROM connections WHERE user_id = ?",
    )
      .bind("user-1")
      .first<Record<string, unknown>>();
    expect(row).toEqual({
      credential_ciphertext: null,
      credential_nonce: null,
      key_version: null,
    });
  });

  it("renders a no-store password form and rejects invalid CSRF without echoing a key", async () => {
    const service = {
      verifyAndSave: async () => {
        throw new Error("must not be called");
      },
    } as unknown as ConnectionService;
    const get = await connectionRoutes(
      new Request("https://gateway.example/connect"),
      {
        service,
        userId: "user-1",
        csrfSecret: "csrf-token",
      },
    );
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(await get.text()).toContain('name=csrf value="csrf-token"');

    const body = new URLSearchParams({
      csrf: "wrong",
      origin: "https://acme.odoo.com",
      api_key: "ODOO_TEST_SECRET",
    });
    const post = await connectionRoutes(
      new Request("https://gateway.example/connect", { method: "POST", body }),
      { service, userId: "user-1", csrfSecret: "csrf-token" },
    );
    expect(post.status).toBe(403);
    expect(await post.text()).not.toContain("ODOO_TEST_SECRET");
  });
});
