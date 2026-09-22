import { GatewayError } from "../errors.js";
import { IntentRepository } from "../storage/repositories.js";
import { canonicalJson, normalizeWrite } from "./normalize.js";
import type { WriteOperation, WriteUpstream } from "./types.js";

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

async function sha256(value: string): Promise<string> {
  return b64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

export async function hashIntentToken(
  token: string,
  pepper: string,
): Promise<string> {
  return sha256(`${token}\u0000${pepper}`);
}

export class PreviewService {
  constructor(
    protected readonly db: D1Database,
    private readonly pepper: string,
    private readonly upstream: WriteUpstream,
  ) {}

  async preview(
    connectionId: string,
    operation: WriteOperation,
    input: unknown,
    now = Date.now(),
  ) {
    const normalized = normalizeWrite(operation, input);
    const before = normalized.targetId
      ? await this.upstream.read(operation, normalized.targetId)
      : null;
    if (normalized.targetId && !before)
      throw new GatewayError("validation_failed");
    const changeJson = canonicalJson(normalized);
    const changeDigest = await sha256(changeJson);
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const intentToken = b64url(tokenBytes);
    const expiresAt = now + 10 * 60_000;
    await new IntentRepository(this.db).create({
      id: crypto.randomUUID(),
      tokenHash: await hashIntentToken(intentToken, this.pepper),
      connectionId,
      operation,
      changeJson,
      changeDigest,
      idempotencyKey: crypto.randomUUID(),
      createdAt: now,
      expiresAt,
    });
    const changes = Object.fromEntries(
      Object.entries(normalized.changes).map(([field, after]) => [
        field,
        { before: before?.[field] ?? null, after },
      ]),
    );
    return {
      intentToken,
      expiresAt,
      operation,
      summary: `${operation}: ${Object.keys(normalized.changes).join(", ")}`,
      changes,
      warnings: [] as string[],
    };
  }
}
