import { GatewayError } from "../src/errors.js";

export type MockMode =
  | "success"
  | "revoked"
  | "permission"
  | "timeout"
  | "malformed"
  | "rate-limit"
  | "missing-capability";

const errors = {
  revoked: "credential_expired_or_revoked",
  permission: "permission_denied",
  timeout: "upstream_timeout",
  malformed: "tenant_unreachable",
  "rate-limit": "rate_limited",
  "missing-capability": "capability_unavailable",
} as const;

export class MockOdooWorker {
  writeCalls = 0;
  constructor(private readonly mode: MockMode = "success") {}

  async call(): Promise<Record<string, unknown>> {
    if (this.mode !== "success") throw new GatewayError(errors[this.mode]);
    return { ok: true };
  }

  async search(requested: number) {
    const limit = Math.max(1, Math.min(50, requested));
    const records = Array.from({ length: limit }, (_, index) => ({
      id: index + 1,
      name: `Record ${index + 1}`,
    }));
    return { records, truncated: requested > limit };
  }

  async write(): Promise<{ accepted: true }> {
    this.writeCalls += 1;
    return { accepted: true };
  }
}
