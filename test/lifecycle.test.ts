import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { encryptCredential } from "../src/security/crypto.js";
import {
  disconnect,
  cleanupOperationalData,
} from "../src/operations/cleanup.js";
import { reencryptConnections } from "../src/operations/key-rotation.js";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM idempotency_results"),
    env.DB.prepare("DELETE FROM confirmation_intents"),
    env.DB.prepare("DELETE FROM oauth_tokens"),
    env.DB.prepare("DELETE FROM oauth_codes"),
    env.DB.prepare("DELETE FROM oauth_grants"),
    env.DB.prepare("DELETE FROM connections"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

async function seedConnection(keyVersion = 1) {
  const keys = {
    currentVersion: keyVersion,
    versions: {
      1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      2: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
    },
  };
  const encrypted = await encryptCredential("conn-1", "secret", keys);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, created_at) VALUES ('user-1', 0)"),
    env.DB.prepare(
      "INSERT INTO connections (id,user_id,tenant_origin,tenant_hash,credential_ciphertext,credential_nonce,key_version,created_at,updated_at) VALUES ('conn-1','user-1','https://a.odoo.com','h',?,?,?,?,?)",
    ).bind(encrypted.ciphertext, encrypted.nonce, keyVersion, 0, 0),
  ]);
}

describe("connection lifecycle", () => {
  it("disconnects once, erases credentials, and revokes authorization state", async () => {
    await seedConnection();
    await env.DB.prepare(
      "INSERT INTO oauth_grants (id,user_id,connection_id,client_id,scope,created_at) VALUES ('g','user-1','conn-1','c','odoo.read',0)",
    ).run();
    await Promise.all([
      disconnect(env.DB, "user-1", 10),
      disconnect(env.DB, "user-1", 10),
    ]);
    const connection = await env.DB.prepare(
      "SELECT * FROM connections WHERE id='conn-1'",
    ).first<Record<string, unknown>>();
    const grant = await env.DB.prepare(
      "SELECT revoked_at FROM oauth_grants WHERE id='g'",
    ).first<{ revoked_at: number | null }>();
    expect(connection).toMatchObject({
      active: 0,
      credential_ciphertext: null,
      credential_nonce: null,
      key_version: null,
    });
    expect(grant?.revoked_at).toBe(10);
  });

  it("rotates credentials in resumable batches", async () => {
    await seedConnection(1);
    const result = await reencryptConnections(
      env.DB,
      {
        currentVersion: 2,
        versions: {
          1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          2: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
        },
      },
      1,
    );
    expect(result).toEqual({ processed: 1, nextCursor: "conn-1" });
    expect(
      await env.DB.prepare(
        "SELECT key_version FROM connections WHERE id='conn-1'",
      ).first(),
    ).toMatchObject({ key_version: 2 });
  });

  it("cleans expired operational records at the boundary", async () => {
    const result = await cleanupOperationalData(env.DB, 100, {
      auditBefore: 50,
      idempotencyBefore: 40,
    });
    expect(result).toEqual(
      expect.objectContaining({
        codes: 0,
        tokens: 0,
        assertions: 0,
        intents: 0,
      }),
    );
  });
});
