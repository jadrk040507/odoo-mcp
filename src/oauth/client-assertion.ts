import { createLocalJWKSet, jwtVerify } from "jose";

import type { CimdClient } from "./cimd.js";

export interface ClientAssertionForm {
  clientId: string;
  clientAssertion: string;
}

export interface ClientAssertionRepository {
  consumeClientAssertion(
    clientId: string,
    jtiHash: string,
    expiresAt: number,
  ): Promise<boolean>;
}

async function hashJti(clientId: string, jti: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${clientId}\0${jti}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function verifyClientAssertion(
  form: ClientAssertionForm,
  client: CimdClient,
  issuer: string,
  repository: ClientAssertionRepository,
  now: number,
): Promise<void> {
  try {
    if (form.clientId !== client.clientId || !form.clientAssertion)
      throw new Error();
    const { payload } = await jwtVerify(
      form.clientAssertion,
      createLocalJWKSet(client.jwks),
      {
        algorithms: [client.algorithm],
        issuer: client.clientId,
        subject: client.clientId,
        audience: issuer,
        currentDate: new Date(now * 1000),
        clockTolerance: 60,
      },
    );
    if (
      typeof payload.jti !== "string" ||
      payload.jti.length === 0 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now - 60 ||
      payload.iat > now + 60 ||
      payload.exp - payload.iat > 300 ||
      (payload.nbf !== undefined &&
        (typeof payload.nbf !== "number" || payload.nbf > now + 60))
    ) {
      throw new Error();
    }
    const consumed = await repository.consumeClientAssertion(
      client.clientId,
      await hashJti(client.clientId, payload.jti),
      payload.exp,
    );
    if (!consumed) throw new Error();
  } catch {
    throw new Error("Invalid client assertion");
  }
}
