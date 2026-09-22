import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { authenticateBearer } from "../src/oauth/bearer.js";
import {
  buildAuthorizationRedirect,
  createAuthorizationSession,
  readAuthorizationSession,
} from "../src/oauth/authorize.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "../src/oauth/metadata.js";
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  refreshAccessToken,
} from "../src/oauth/token.js";
import { revokeToken } from "../src/oauth/revoke.js";
import { routeOAuth } from "../src/oauth/router.js";
import { ConnectionRepository } from "../src/storage/repositories.js";

const origin = "https://gateway.example";
const pepper = "test-pepper";

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
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
  await new ConnectionRepository(env.DB).create({
    id: "connection-1",
    userId: "user-1",
    tenantOrigin: "https://acme.odoo.com",
    tenantHash: "tenant-hash",
    ciphertext: "ciphertext",
    nonce: "nonce",
    keyVersion: 1,
    now: 100,
  });
});

describe("OAuth metadata and routing", () => {
  it("publishes exact OAuth 2.1 metadata and no DCR endpoint", async () => {
    expect(protectedResourceMetadata(origin)).toEqual({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["odoo.read", "odoo.write"],
      bearer_methods_supported: ["header"],
    });
    expect(authorizationServerMetadata(origin)).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      revocation_endpoint: `${origin}/revoke`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
    });
    const response = await routeOAuth(
      new Request(`${origin}/register`, { method: "POST" }),
      { DB: env.DB, PUBLIC_ORIGIN: origin, TOKEN_HASH_PEPPER: pepper },
    );
    expect(response.status).toBe(404);
  });

  it("returns a resource-bound bearer challenge", async () => {
    const response = await routeOAuth(new Request(`${origin}/mcp`), {
      DB: env.DB,
      PUBLIC_ORIGIN: origin,
      TOKEN_HASH_PEPPER: pepper,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("preserves state, emits RFC 9207 iss, and rejects cookie tampering", async () => {
    const session = {
      state: "opaque-state",
      clientId: "https://client.example/metadata.json",
      redirectUri: "https://client.example/callback",
      resource: `${origin}/mcp`,
      scope: "odoo.read",
      codeChallenge: "c".repeat(43),
      expiresAt: 1_500,
    };
    const cookie = await createAuthorizationSession(session, pepper);
    await expect(
      readAuthorizationSession(cookie, pepper, 1_100),
    ).resolves.toEqual(session);
    await expect(
      readAuthorizationSession(`${cookie.slice(0, -1)}x`, pepper, 1_100),
    ).rejects.toThrow("invalid_request");
    const redirect = buildAuthorizationRedirect({
      redirectUri: session.redirectUri,
      code: "code",
      state: session.state,
      issuer: origin,
    });
    const location = new URL(redirect.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe(session.state);
    expect(location.searchParams.get("iss")).toBe(origin);
  });
});

describe("authorization-code and token lifecycle", () => {
  it("exchanges an S256 code once and authenticates the opaque access token", async () => {
    const verifier = "v".repeat(43);
    const code = await issueAuthorizationCode(
      env.DB,
      {
        userId: "user-1",
        connectionId: "connection-1",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
        scope: "odoo.read",
        codeChallenge: await digest(verifier),
      },
      1_000,
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
      1_100,
    );
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "odoo.read",
    });
    expect(tokens.access_token).not.toContain("user-1");

    const auth = await authenticateBearer(
      new Request(`${origin}/mcp`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
      { DB: env.DB, TOKEN_HASH_PEPPER: pepper },
      1_101,
    );
    expect(auth).toMatchObject({
      userId: "user-1",
      connectionId: "connection-1",
    });
    await env.DB.prepare("UPDATE connections SET active = 0 WHERE id = ?")
      .bind("connection-1")
      .run();
    await expect(
      authenticateBearer(
        new Request(`${origin}/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
        { DB: env.DB, TOKEN_HASH_PEPPER: pepper },
        1_102,
      ),
    ).rejects.toThrow("invalid_token");
    await env.DB.prepare("UPDATE connections SET active = 1 WHERE id = ?")
      .bind("connection-1")
      .run();
    await expect(
      authenticateBearer(
        new Request(`${origin}/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
        { DB: env.DB, TOKEN_HASH_PEPPER: pepper },
        4_701,
      ),
    ).rejects.toThrow("invalid_token");
    await expect(
      exchangeAuthorizationCode(
        env.DB,
        {
          code,
          codeVerifier: verifier,
          clientId: "https://client.example/metadata.json",
          redirectUri: "https://client.example/callback",
          resource: `${origin}/mcp`,
        },
        pepper,
        1_101,
      ),
    ).rejects.toThrow("invalid_grant");
    await revokeToken(env.DB, tokens.access_token, pepper, 1_103);
    await expect(
      authenticateBearer(
        new Request(`${origin}/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
        { DB: env.DB, TOKEN_HASH_PEPPER: pepper },
        1_104,
      ),
    ).rejects.toThrow("invalid_token");
  });

  it.each([
    [
      "wrong verifier",
      "x".repeat(43),
      "https://client.example/callback",
      `${origin}/mcp`,
    ],
    [
      "wrong redirect",
      "v".repeat(43),
      "https://client.example/other",
      `${origin}/mcp`,
    ],
    [
      "wrong resource",
      "v".repeat(43),
      "https://client.example/callback",
      `${origin}/other`,
    ],
  ])("rejects %s", async (_name, suppliedVerifier, redirectUri, resource) => {
    const verifier = "v".repeat(43);
    const code = await issueAuthorizationCode(
      env.DB,
      {
        userId: "user-1",
        connectionId: "connection-1",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
        scope: "odoo.read",
        codeChallenge: await digest(verifier),
      },
      1_000,
    );
    await expect(
      exchangeAuthorizationCode(
        env.DB,
        {
          code,
          codeVerifier: suppliedVerifier,
          clientId: "https://client.example/metadata.json",
          redirectUri,
          resource,
        },
        pepper,
        1_100,
      ),
    ).rejects.toThrow("invalid_grant");
  });

  it("rotates refresh tokens and revokes the family on replay", async () => {
    const verifier = "v".repeat(43);
    const code = await issueAuthorizationCode(
      env.DB,
      {
        userId: "user-1",
        connectionId: "connection-1",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
        scope: "odoo.read",
        codeChallenge: await digest(verifier),
      },
      1_000,
    );
    const initial = await exchangeAuthorizationCode(
      env.DB,
      {
        code,
        codeVerifier: verifier,
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: `${origin}/mcp`,
      },
      pepper,
      1_100,
    );
    const competing = await Promise.allSettled([
      refreshAccessToken(
        env.DB,
        initial.refresh_token,
        "https://client.example/metadata.json",
        `${origin}/mcp`,
        pepper,
        1_200,
      ),
      refreshAccessToken(
        env.DB,
        initial.refresh_token,
        "https://client.example/metadata.json",
        `${origin}/mcp`,
        pepper,
        1_200,
      ),
    ]);
    expect(
      competing.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const fulfilled = competing.find((result) => result.status === "fulfilled");
    if (!fulfilled || fulfilled.status !== "fulfilled") {
      throw new Error("expected one refresh winner");
    }
    const rotated = fulfilled.value;
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    await expect(
      refreshAccessToken(
        env.DB,
        rotated.refresh_token,
        "https://client.example/metadata.json",
        `${origin}/mcp`,
        pepper,
        1_202,
      ),
    ).rejects.toThrow("invalid_grant");
  });

  it("revokes tokens idempotently and rejects inactive connections", async () => {
    await expect(
      revokeToken(env.DB, "unknown", pepper, 2_000),
    ).resolves.toBeUndefined();
    await expect(
      revokeToken(env.DB, "unknown", pepper, 2_001),
    ).resolves.toBeUndefined();
  });
});
