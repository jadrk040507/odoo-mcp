import { GatewayError } from "../errors.js";

export interface PageInput {
  limit?: number;
  cursor?: string;
}

function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): string {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

async function queryDigest(query: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(query).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      ),
    ),
  );
}

export function pageInput(input: PageInput): { limit: number; offset: number } {
  const requested = Number.isFinite(input.limit)
    ? Math.trunc(input.limit ?? 20)
    : 20;
  return { limit: Math.min(50, Math.max(1, requested)), offset: 0 };
}

export async function encodeCursor(
  offset: number,
  query: Record<string, unknown>,
): Promise<string> {
  return base64Url(
    new TextEncoder().encode(
      JSON.stringify({ offset, digest: await queryDigest(query) }),
    ),
  );
}

export async function decodeCursor(
  cursor: string,
  query: Record<string, unknown>,
): Promise<number> {
  try {
    const parsed = JSON.parse(decodeBase64Url(cursor)) as {
      offset?: unknown;
      digest?: unknown;
    };
    if (
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      parsed.digest !== (await queryDigest(query))
    ) {
      throw new Error();
    }
    return parsed.offset as number;
  } catch {
    throw new GatewayError("validation_failed");
  }
}
