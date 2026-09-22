import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { GatewayError, gatewayErrorCodes, toMcpError } from "../src/errors.js";
import { FixedWindowRateLimiter } from "../src/policy/rate-limit.js";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM rate_limits").run();
});

describe("gateway error boundary", () => {
  it("keeps the exact closed error vocabulary", () => {
    expect(gatewayErrorCodes).toEqual([
      "connection_required",
      "credential_expired_or_revoked",
      "tenant_unreachable",
      "capability_unavailable",
      "permission_denied",
      "validation_failed",
      "confirmation_required",
      "confirmation_expired",
      "rate_limited",
      "upstream_timeout",
      "internal_error",
    ]);
  });

  it.each(gatewayErrorCodes)("returns a safe structured %s error", (code) => {
    const unsafe = new GatewayError(code, {
      cause: new Error(
        "Bearer ODOO_TEST_SECRET record={customer payload} stack=/srv/private.ts",
      ),
    });
    const result = toMcpError(unsafe, "request-1");
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code, requestId: "request-1" },
    });
    expect(serialized).not.toMatch(
      /ODOO_TEST_SECRET|Bearer|customer payload|private\.ts/i,
    );
  });

  it("maps unknown failures to internal_error", () => {
    expect(toMcpError(new Error("raw secret"), "request-2")).toMatchObject({
      structuredContent: { code: "internal_error", requestId: "request-2" },
    });
  });
});

describe("fixed-window rate limiter", () => {
  it("allows up to the limit atomically and returns the reset boundary", async () => {
    const limiter = new FixedWindowRateLimiter(env.DB);
    const results = await Promise.all([
      limiter.consume("user-1", 2, 60, 120),
      limiter.consume("user-1", 2, 60, 120),
      limiter.consume("user-1", 2, 60, 120),
    ]);
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.every((result) => result.resetAt === 180)).toBe(true);
    await expect(limiter.consume("user-1", 2, 60, 180)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: 240,
    });
  });
});
