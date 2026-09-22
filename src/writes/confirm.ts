import { GatewayError } from "../errors.js";
import {
  IdempotencyRepository,
  IntentRepository,
} from "../storage/repositories.js";
import { canonicalJson } from "./normalize.js";
import { hashIntentToken, PreviewService } from "./preview.js";
import type {
  NormalizedWrite,
  WriteOperation,
  WriteReceipt,
  WriteUpstream,
} from "./types.js";

const digest = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export class WriteService extends PreviewService {
  constructor(
    db: D1Database,
    private readonly tokenPepper: string,
    private readonly writeUpstream: WriteUpstream,
  ) {
    super(db, tokenPepper, writeUpstream);
  }

  async confirm(
    connectionId: string,
    operation: WriteOperation,
    input: { intentToken: string; confirmed: true },
    now = Date.now(),
  ): Promise<WriteReceipt> {
    if (input.confirmed !== true || typeof input.intentToken !== "string")
      throw new GatewayError("confirmation_required");
    const intents = new IntentRepository(this.db);
    const tokenHash = await hashIntentToken(
      input.intentToken,
      this.tokenPepper,
    );
    const observed = await intents.find(tokenHash);
    if (
      !observed ||
      observed.connection_id !== connectionId ||
      observed.operation !== operation
    )
      throw new GatewayError("confirmation_required");
    if (observed.expires_at <= now)
      throw new GatewayError("confirmation_expired");
    const idempotency = new IdempotencyRepository(this.db);
    if (observed.consumed_at !== null)
      return this.replay(idempotency, observed.idempotency_key);
    const claimed = await intents.consume(tokenHash, now);
    if (!claimed) return this.replay(idempotency, observed.idempotency_key);
    if ((await digest(claimed.change_json)) !== claimed.change_digest)
      throw new GatewayError("confirmation_required");
    const ownsWrite = await idempotency.claim({
      idempotencyKey: claimed.idempotency_key,
      connectionId,
      operation,
      now,
    });
    if (!ownsWrite) return this.replay(idempotency, claimed.idempotency_key);
    try {
      await this.writeUpstream.write(
        operation,
        JSON.parse(claimed.change_json) as NormalizedWrite,
      );
      const receipt: WriteReceipt = {
        status: "succeeded",
        operation,
        idempotencyKey: claimed.idempotency_key,
      };
      await idempotency.complete(
        claimed.idempotency_key,
        "succeeded",
        canonicalJson(receipt),
        now,
      );
      return receipt;
    } catch (error) {
      await idempotency.complete(
        claimed.idempotency_key,
        "failed_terminal",
        null,
        now,
      );
      throw error;
    }
  }

  private async replay(
    repository: IdempotencyRepository,
    key: string,
  ): Promise<WriteReceipt> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await repository.find(key);
      if (row?.state === "succeeded" && row.result_json)
        return JSON.parse(row.result_json) as WriteReceipt;
      if (row && row.state !== "pending")
        throw new GatewayError("confirmation_required");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new GatewayError("confirmation_required");
  }
}
