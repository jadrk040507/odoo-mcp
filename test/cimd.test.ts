import { generateKeyPair, exportJWK, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { resolveCimd } from "../src/oauth/cimd.js";
import { publicHttpsFetch } from "../src/security/public-fetch.js";

let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "key-1",
    alg: "ES256",
  };
});

function metadata(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    client_id: "https://client.example/metadata.json",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector/oauth/callback"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    jwks: { keys: [publicJwk] },
    ...overrides,
  });
}

describe("CIMD resolution", () => {
  it("accepts exact HTTPS metadata with a public asymmetric JWKS", async () => {
    const client = await resolveCimd(
      "https://client.example/metadata.json",
      async () => metadata(),
    );
    expect(client).toMatchObject({
      clientId: "https://client.example/metadata.json",
      redirectUris: ["https://chatgpt.com/connector/oauth/callback"],
      algorithm: "ES256",
    });
    expect(client.jwks.keys).toHaveLength(1);
  });

  it.each([
    ["client mismatch", { client_id: "https://other.example/client" }],
    ["http redirect", { redirect_uris: ["http://client.example/callback"] }],
    ["fragment redirect", { redirect_uris: ["https://client.example/cb#x"] }],
    ["wrong auth", { token_endpoint_auth_method: "client_secret_basic" }],
    ["symmetric algorithm", { token_endpoint_auth_signing_alg: "HS256" }],
    ["private key", { jwks: { keys: [{ kty: "EC", d: "secret" }] } }],
    ["symmetric key", { jwks: { keys: [{ kty: "oct", k: "secret" }] } }],
  ])("rejects %s", async (_name, overrides) => {
    await expect(
      resolveCimd("https://client.example/metadata.json", async () =>
        metadata(overrides),
      ),
    ).rejects.toThrow("Invalid client metadata");
  });

  it("rejects redirects, oversized metadata, and unsafe JWKS URLs", async () => {
    await expect(
      resolveCimd("https://client.example/metadata.json", async () =>
        Response.redirect("https://other.example/client", 302),
      ),
    ).rejects.toThrow("Client metadata fetch failed");
    await expect(
      resolveCimd(
        "https://client.example/metadata.json",
        async () => new Response("x".repeat(5_121)),
      ),
    ).rejects.toThrow("Client metadata too large");
    await expect(
      resolveCimd("https://client.example/metadata.json", async () =>
        metadata({ jwks: undefined, jwks_uri: "https://127.0.0.1/jwks" }),
      ),
    ).rejects.toThrow("Invalid client metadata");
  });

  it("loads and accepts a rotated public key set from jwks_uri", async () => {
    const calls: string[] = [];
    const client = await resolveCimd(
      "https://client.example/metadata.json",
      async (url) => {
        calls.push(url);
        return url.endsWith("/jwks")
          ? Response.json({ keys: [publicJwk] })
          : metadata({
              jwks: undefined,
              jwks_uri: "https://client.example/jwks",
            });
      },
    );
    expect(calls).toEqual([
      "https://client.example/metadata.json",
      "https://client.example/jwks",
    ]);
    expect(client.jwks.keys[0]).toMatchObject({ kid: "key-1" });
  });

  it("generic public fetch blocks private DNS and redirects", async () => {
    await expect(
      publicHttpsFetch("https://client.example/metadata.json", {
        resolver: {
          resolve: async () => ({ addresses: ["127.0.0.1"], ttl: 60 }),
        },
        fetch: async () => new Response("unreachable"),
      }),
    ).rejects.toThrow("Unsafe public address");
    await expect(
      publicHttpsFetch("https://client.example/metadata.json", {
        resolver: {
          resolve: async () => ({ addresses: ["8.8.8.8"], ttl: 60 }),
        },
        fetch: async () => Response.redirect("https://other.example", 302),
      }),
    ).rejects.toThrow("Public fetch failed");
  });
});
