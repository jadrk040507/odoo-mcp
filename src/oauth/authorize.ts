export interface AuthorizationRedirectInput {
  redirectUri: string;
  code: string;
  state: string;
  issuer: string;
}

export interface AuthorizationSession {
  userId?: string;
  state: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  expiresAt: number;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

async function verify(
  value: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(value),
  );
}

export async function createAuthorizationSession(
  session: AuthorizationSession,
  secret: string,
): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(session)));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function readAuthorizationSession(
  value: string,
  secret: string,
  now: number,
): Promise<AuthorizationSession> {
  try {
    const [payload, signature, extra] = value.split(".");
    if (
      !payload ||
      !signature ||
      extra ||
      !(await verify(payload, signature, secret))
    ) {
      throw new Error();
    }
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as AuthorizationSession;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.resource !== "string" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.codeChallenge !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error("invalid_request");
  }
}

export function buildAuthorizationRedirect(
  input: AuthorizationRedirectInput,
): Response {
  const location = new URL(input.redirectUri);
  location.searchParams.set("code", input.code);
  location.searchParams.set("state", input.state);
  location.searchParams.set("iss", input.issuer);
  return Response.redirect(location.toString(), 302);
}
