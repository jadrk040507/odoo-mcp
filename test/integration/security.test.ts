import { describe, expect, it } from "vitest";
import { validateTenantOrigin } from "../../src/security/tenant-url.js";
import { MockOdooWorker } from "../mock-odoo-worker.js";

describe("security acceptance", () => {
  it.each([
    "http://acme.odoo.com",
    "https://odoo.com",
    "https://acme.odoo.com.",
    "https://127.0.0.1",
    "https://evilodoo.com",
  ])("rejects unsafe tenant %s", async (origin) => {
    await expect(
      validateTenantOrigin(origin, {
        resolve: async () => ({ addresses: ["203.0.113.10"], ttl: 60 }),
      }),
    ).rejects.toThrow();
  });

  it.each([
    "revoked",
    "permission",
    "timeout",
    "malformed",
    "rate-limit",
    "missing-capability",
  ] as const)("returns a safe failure for %s", async (mode) => {
    const mock = new MockOdooWorker(mode);
    await expect(mock.call()).rejects.toMatchObject({
      code: expect.stringMatching(/^[a-z_]+$/),
    });
  });
});
