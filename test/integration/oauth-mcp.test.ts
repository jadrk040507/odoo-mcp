import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { authenticateBearer } from "../../src/oauth/bearer.js";
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
} from "../../src/oauth/token.js";
import { ConnectionRepository } from "../../src/storage/repositories.js";
import { MockOdooWorker } from "../mock-odoo-worker.js";

const origin = "https://gateway.example";
const pepper = "integration-pepper";

async function digest(value: string): Promise<string> {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tokens"),
    env.DB.prepare("DELETE FROM oauth_codes"),
    env.DB.prepare("DELETE FROM oauth_grants"),
    env.DB.prepare("DELETE FROM connections"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

describe("OAuth to MCP acceptance", () => {
  it("connects, exchanges PKCE, authenticates later, and reads bounded current data", async () => {
    await new ConnectionRepository(env.DB).create({
      id: "conn",
      userId: "user",
      tenantOrigin: "https://acme.odoo.com",
      tenantHash: "h",
      ciphertext: "c",
      nonce: "n",
      keyVersion: 1,
      now: 1,
    });
    const verifier = "v".repeat(43);
    const code = await issueAuthorizationCode(
      env.DB,
      {
        userId: "user",
        connectionId: "conn",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
        scope: "odoo.read",
        codeChallenge: await digest(verifier),
      },
      10,
    );
    const tokens = await exchangeAuthorizationCode(
      env.DB,
      {
        code,
        codeVerifier: verifier,
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
      },
      pepper,
      11,
    );
    await expect(
      authenticateBearer(
        new Request(`${origin}/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
        { DB: env.DB, TOKEN_HASH_PEPPER: pepper },
        12,
      ),
    ).resolves.toMatchObject({ userId: "user", connectionId: "conn" });
    const mock = new MockOdooWorker();
    const result = await mock.search(51);
    expect(result.records).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });
});
