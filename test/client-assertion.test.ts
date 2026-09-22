import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { CimdClient } from "../src/oauth/cimd.js";
import { verifyClientAssertion } from "../src/oauth/client-assertion.js";

const clientId = "https://client.example/metadata.json";
const issuer = "https://gateway.example/token";
let privateKey: CryptoKey;
let client: CimdClient;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  client = {
    clientId,
    redirectUris: ["https://chatgpt.com/callback"],
    algorithm: "ES256",
    jwks: {
      keys: [
        { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "ES256" },
      ],
    },
  };
});

async function assertion(
  now: number,
  claims: Record<string, unknown> = {},
  algorithm = "ES256",
): Promise<string> {
  return new SignJWT({
    jti: "jti-1",
    iss: clientId,
    sub: clientId,
    aud: issuer,
    iat: now,
    exp: now + 120,
    ...claims,
  })
    .setProtectedHeader({ alg: algorithm, kid: "key-1" })
    .sign(privateKey);
}

function repository() {
  const seen = new Set<string>();
  return {
    consumeClientAssertion: async (_clientId: string, jtiHash: string) => {
      if (seen.has(jtiHash)) return false;
      seen.add(jtiHash);
      return true;
    },
  };
}

describe("private_key_jwt", () => {
  it("verifies required claims and atomically rejects replay", async () => {
    const now = 1_800_000_000;
    const repo = repository();
    const token = await assertion(now);
    await expect(
      verifyClientAssertion(
        { clientId, clientAssertion: token },
        client,
        issuer,
        repo,
        now,
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyClientAssertion(
        { clientId, clientAssertion: token },
        client,
        issuer,
        repo,
        now,
      ),
    ).rejects.toThrow("Invalid client assertion");
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.example" }],
    ["wrong subject", { sub: "https://attacker.example" }],
    ["wrong audience", { aud: "https://other.example/token" }],
    ["missing jti", { jti: undefined }],
    ["too long", { exp: 1_800_000_301 }],
    ["expired", { exp: 1_799_999_900 }],
    ["future iat", { iat: 1_800_000_120 }],
    ["future nbf", { nbf: 1_800_000_120 }],
  ])("rejects %s without echoing the JWT", async (_name, claims) => {
    const now = 1_800_000_000;
    const token = await assertion(now, claims);
    try {
      await verifyClientAssertion(
        { clientId, clientAssertion: token },
        client,
        issuer,
        repository(),
        now,
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(String(error)).toContain("Invalid client assertion");
      expect(String(error)).not.toContain(token);
    }
  });

  it("rejects unknown key IDs and wrong client IDs", async () => {
    const now = 1_800_000_000;
    const token = await assertion(now);
    await expect(
      verifyClientAssertion(
        { clientId: "https://other.example", clientAssertion: token },
        client,
        issuer,
        repository(),
        now,
      ),
    ).rejects.toThrow("Invalid client assertion");
    const unknownKid = await new SignJWT({ jti: "jti-2" })
      .setProtectedHeader({ alg: "ES256", kid: "unknown" })
      .setIssuer(clientId)
      .setSubject(clientId)
      .setAudience(issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    await expect(
      verifyClientAssertion(
        { clientId, clientAssertion: unknownKid },
        client,
        issuer,
        repository(),
        now,
      ),
    ).rejects.toThrow("Invalid client assertion");
  });
});
