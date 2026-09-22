import type { JSONWebKeySet } from "jose";

import { isForbiddenIp } from "../security/ip.js";

const asymmetricAlgorithms = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

export interface CimdClient {
  clientId: string;
  redirectUris: string[];
  algorithm: string;
  jwks: JSONWebKeySet;
}

export type PublicFetcher = (url: string) => Promise<Response>;

function validHttpsUrl(input: unknown): input is string {
  if (typeof input !== "string") return false;
  try {
    const url = new URL(input);
    const hostIsIp =
      /^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(":");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      Boolean(url.hostname) &&
      url.hostname !== "localhost" &&
      !url.hostname.endsWith(".localhost") &&
      (!hostIsIp || !isForbiddenIp(url.hostname))
    );
  } catch {
    return false;
  }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || response.status >= 300) {
    throw new Error("Client metadata fetch failed");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 5120) {
    throw new Error("Client metadata too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid client metadata");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 5120) {
      await reader.cancel();
      throw new Error("Client metadata too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new Error("Invalid client metadata");
  }
}

function validateJwks(value: unknown): value is JSONWebKeySet {
  if (!value || typeof value !== "object") return false;
  const keys = (value as { keys?: unknown }).keys;
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every((key) => {
      if (!key || typeof key !== "object") return false;
      const jwk = key as Record<string, unknown>;
      return (
        ["RSA", "EC", "OKP"].includes(String(jwk.kty)) &&
        !("d" in jwk) &&
        !("k" in jwk) &&
        jwk.use !== "enc"
      );
    })
  );
}

export async function resolveCimd(
  clientId: string,
  fetcher: PublicFetcher,
): Promise<CimdClient> {
  if (!validHttpsUrl(clientId)) throw new Error("Invalid client metadata");
  const document = await readLimitedJson(await fetcher(clientId));
  if (!document || typeof document !== "object") {
    throw new Error("Invalid client metadata");
  }
  const metadata = document as Record<string, unknown>;
  const redirects = metadata.redirect_uris;
  const algorithm = metadata.token_endpoint_auth_signing_alg;
  if (
    metadata.client_id !== clientId ||
    metadata.token_endpoint_auth_method !== "private_key_jwt" ||
    typeof algorithm !== "string" ||
    !asymmetricAlgorithms.has(algorithm) ||
    !Array.isArray(redirects) ||
    redirects.length === 0 ||
    !redirects.every(validHttpsUrl) ||
    new Set(redirects).size !== redirects.length
  ) {
    throw new Error("Invalid client metadata");
  }

  let jwks = metadata.jwks;
  if (jwks === undefined) {
    if (!validHttpsUrl(metadata.jwks_uri))
      throw new Error("Invalid client metadata");
    jwks = await readLimitedJson(await fetcher(metadata.jwks_uri));
  }
  if (!validateJwks(jwks)) throw new Error("Invalid client metadata");
  return { clientId, redirectUris: redirects, algorithm, jwks };
}
