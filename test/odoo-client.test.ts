import { describe, expect, it } from "vitest";

import {
  OdooClient,
  OdooUpstreamError,
  type OdooClientAdapter,
} from "../src/odoo/client.js";
import type { OdooErrorCategory } from "../src/odoo/types.js";

function adapter(
  overrides: Partial<OdooClientAdapter> = {},
): OdooClientAdapter {
  return {
    connect: async () => ({ name: "Odoo", version: "19.4" }),
    listTools: async () => [
      { name: "get_models" },
      { name: "get_fields" },
      { name: "search" },
      { name: "read_group" },
      { name: "create_records" },
      { name: "update_records" },
    ],
    callTool: async (name, args) => ({ name, args }),
    close: async () => undefined,
    ...overrides,
  };
}

describe("OdooClient", () => {
  it("initializes, lists native capabilities, calls tools, and closes", async () => {
    let closed = false;
    const client = new OdooClient("https://acme.odoo.com", "ODOO_TEST_SECRET", {
      adapter: adapter({ close: async () => void (closed = true) }),
      timeoutMs: 100,
    });
    await expect(client.initialize()).resolves.toMatchObject({
      server: { name: "Odoo", version: "19.4" },
      tools: expect.arrayContaining(["search", "create_records"]),
    });
    await expect(
      client.callTool("search", { model: "res.partner" }),
    ).resolves.toEqual({
      name: "search",
      args: { model: "res.partner" },
    });
    await client.close();
    expect(closed).toBe(true);
  });

  it.each<{ status: number; category: OdooErrorCategory }>([
    { status: 401, category: "credential_rejected" },
    { status: 403, category: "permission_denied" },
    { status: 429, category: "rate_limited" },
    { status: 500, category: "tenant_unreachable" },
  ])(
    "maps upstream $status without leaking credentials",
    async ({ status, category }) => {
      const client = new OdooClient(
        "https://acme.odoo.com",
        "ODOO_TEST_SECRET",
        {
          adapter: adapter({
            connect: async () => {
              throw new OdooUpstreamError(category, status, "ODOO_TEST_SECRET");
            },
          }),
          timeoutMs: 100,
        },
      );
      try {
        await client.initialize();
        throw new Error("expected failure");
      } catch (error) {
        expect(String(error)).toContain(category);
        expect(String(error)).not.toContain("ODOO_TEST_SECRET");
      }
    },
  );

  it("times out and rejects malformed/missing capabilities safely", async () => {
    const timeout = new OdooClient("https://acme.odoo.com", "secret", {
      adapter: adapter({ connect: async () => new Promise(() => undefined) }),
      timeoutMs: 1,
    });
    await expect(timeout.initialize()).rejects.toThrow("tenant_unreachable");

    const missing = new OdooClient("https://acme.odoo.com", "secret", {
      adapter: adapter({ listTools: async () => [{ name: "search" }] }),
      timeoutMs: 100,
    });
    await missing.initialize();
    await expect(missing.callTool("get_fields", {})).rejects.toThrow(
      "capability_unavailable",
    );
  });

  it("retries a safe read once but never retries a write", async () => {
    let readCalls = 0;
    const read = new OdooClient("https://acme.odoo.com", "secret", {
      adapter: adapter({
        callTool: async () => {
          readCalls += 1;
          if (readCalls === 1) throw new OdooUpstreamError("rate_limited", 429);
          return { ok: true };
        },
      }),
      timeoutMs: 100,
      retryDelay: async () => undefined,
    });
    await read.initialize();
    await expect(read.callTool("search", {})).resolves.toEqual({ ok: true });
    expect(readCalls).toBe(2);

    let writeCalls = 0;
    const write = new OdooClient("https://acme.odoo.com", "secret", {
      adapter: adapter({
        callTool: async () => {
          writeCalls += 1;
          throw new OdooUpstreamError("tenant_unreachable", 500);
        },
      }),
      timeoutMs: 100,
    });
    await write.initialize();
    await expect(write.callTool("create_records", {})).rejects.toThrow(
      "tenant_unreachable",
    );
    expect(writeCalls).toBe(1);
  });
});
