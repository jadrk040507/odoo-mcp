import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ConnectionRepository,
  IntentRepository,
  OAuthRepository,
  cleanupExpired,
} from "../src/storage/repositories.js";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM confirmation_intents"),
    env.DB.prepare("DELETE FROM oauth_tokens"),
    env.DB.prepare("DELETE FROM connections"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

describe("D1 repositories", () => {
  it("enforces one active connection per user", async () => {
    const repository = new ConnectionRepository(env.DB);
    await repository.create({
      id: "conn-1",
      userId: "user-1",
      tenantOrigin: "https://one.odoo.com",
      tenantHash: "tenant-1",
      ciphertext: "ciphertext",
      nonce: "nonce",
      keyVersion: 1,
      now: 100,
    });

    await expect(
      repository.create({
        id: "conn-2",
        userId: "user-1",
        tenantOrigin: "https://two.odoo.com",
        tenantHash: "tenant-2",
        ciphertext: "ciphertext-2",
        nonce: "nonce-2",
        keyVersion: 1,
        now: 101,
      }),
    ).rejects.toThrow();
  });

  it("looks up only unexpired, unrevoked access-token hashes", async () => {
    const connections = new ConnectionRepository(env.DB);
    await connections.create({
      id: "conn-1",
      userId: "user-1",
      tenantOrigin: "https://one.odoo.com",
      tenantHash: "tenant-1",
      ciphertext: "ciphertext",
      nonce: "nonce",
      keyVersion: 1,
      now: 100,
    });
    const repository = new OAuthRepository(env.DB);
    await repository.storeGrant({
      id: "grant-1",
      userId: "user-1",
      connectionId: "conn-1",
      clientId: "https://client.example/metadata.json",
      scope: "odoo.read",
      createdAt: 100,
    });
    await repository.storeAccessToken({
      id: "token-1",
      tokenHash: "hash-1",
      grantId: "grant-1",
      userId: "user-1",
      connectionId: "conn-1",
      scope: "odoo.read",
      createdAt: 100,
      expiresAt: 200,
    });

    expect(await repository.findAccessToken("hash-1", 150)).toMatchObject({
      id: "token-1",
    });
    expect(await repository.findAccessToken("hash-1", 201)).toBeNull();
  });

  it("allows exactly one consumer for an unexpired intent", async () => {
    const connections = new ConnectionRepository(env.DB);
    await connections.create({
      id: "conn-1",
      userId: "user-1",
      tenantOrigin: "https://one.odoo.com",
      tenantHash: "tenant-1",
      ciphertext: "ciphertext",
      nonce: "nonce",
      keyVersion: 1,
      now: 100,
    });
    const repository = new IntentRepository(env.DB);
    await repository.create({
      id: "intent-1",
      tokenHash: "intent-hash",
      connectionId: "conn-1",
      operation: "contact.update",
      changeJson: "{}",
      changeDigest: "digest",
      idempotencyKey: "idem-1",
      createdAt: 100,
      expiresAt: 200,
    });

    expect(await repository.consume("intent-hash", 150)).toMatchObject({
      id: "intent-1",
    });
    expect(await repository.consume("intent-hash", 151)).toBeNull();
  });

  it("deletes expired tokens and intents", async () => {
    const result = await cleanupExpired(env.DB, 300);
    expect(result).toEqual({ tokens: 0, intents: 0 });
  });
});
