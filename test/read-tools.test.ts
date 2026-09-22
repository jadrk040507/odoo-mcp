import { describe, expect, it } from "vitest";

import { BusinessReadService, type ReadUpstream } from "../src/tools/read.js";
import { decodeCursor, encodeCursor, pageInput } from "../src/tools/schemas.js";

function upstream(handler?: ReadUpstream["callTool"]): ReadUpstream {
  return {
    capabilities: new Set(["get_models", "get_fields", "search", "read_group"]),
    callTool:
      handler ??
      (async (_name, args) => ({
        records: [{ id: 1, name: "Acme", secret_field: "must disappear" }],
        args,
      })),
  };
}

describe("bounded read schemas", () => {
  it("defaults and clamps page limits", () => {
    expect(pageInput({})).toEqual({ limit: 20, offset: 0 });
    expect(pageInput({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(pageInput({ limit: 500 })).toEqual({ limit: 50, offset: 0 });
  });

  it("binds opaque cursors to the normalized query", async () => {
    const cursor = await encodeCursor(50, {
      resource: "contacts",
      query: "acme",
    });
    await expect(
      decodeCursor(cursor, { resource: "contacts", query: "acme" }),
    ).resolves.toBe(50);
    await expect(
      decodeCursor(cursor, { resource: "contacts", query: "other" }),
    ).rejects.toThrow("validation_failed");
    await expect(
      decodeCursor("not-a-cursor", { resource: "contacts", query: "acme" }),
    ).rejects.toThrow("validation_failed");
  });
});

describe("BusinessReadService", () => {
  it("maps contacts to explicit model/fields and strips unapproved fields", async () => {
    let call: { name: string; args: Record<string, unknown> } | undefined;
    const service = new BusinessReadService(
      upstream(async (name, args) => {
        call = { name, args };
        return { records: [{ id: 1, name: "Acme", secret_field: "hidden" }] };
      }),
    );
    const result = await service.search("contacts", {
      query: "acme",
      limit: 5,
    });
    expect(call).toMatchObject({
      name: "search",
      args: {
        model: "res.partner",
        fields: expect.arrayContaining(["id", "name", "email"]),
        limit: 6,
        offset: 0,
      },
    });
    expect(result.records).toEqual([{ id: 1, name: "Acme" }]);
  });

  it("fetches current data on every call and emits a bounded next cursor", async () => {
    let calls = 0;
    const service = new BusinessReadService(
      upstream(async () => {
        calls += 1;
        return {
          records: Array.from({ length: 3 }, (_, index) => ({
            id: calls * 10 + index,
            name: `Record ${index}`,
          })),
        };
      }),
    );
    const first = await service.search("contacts", { limit: 2 });
    const second = await service.search("contacts", { limit: 2 });
    expect(calls).toBe(2);
    expect(first.records).not.toEqual(second.records);
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
  });

  it("rejects capability gaps, unsupported fields/types, and malformed responses", async () => {
    const missing = upstream();
    missing.capabilities.delete("search");
    await expect(
      new BusinessReadService(missing).search("contacts", {}),
    ).rejects.toThrow("capability_unavailable");
    await expect(
      new BusinessReadService(upstream()).getRecord("contacts", 1, ["api_key"]),
    ).rejects.toThrow("validation_failed");
    await expect(
      new BusinessReadService(upstream(async () => "bad")).search(
        "contacts",
        {},
      ),
    ).rejects.toThrow("tenant_unreachable");
  });

  it("aggregates only approved group and measure fields", async () => {
    let args: Record<string, unknown> | undefined;
    const service = new BusinessReadService(
      upstream(async (_name, input) => {
        args = input;
        return { records: [{ state: "sale", amount_total: 100 }] };
      }),
    );
    await service.aggregate("sales", {
      groupBy: "state",
      measure: "amount_total",
    });
    expect(args).toMatchObject({
      model: "sale.order",
      groupby: ["state"],
      fields: ["amount_total:sum"],
    });
    await expect(
      service.aggregate("sales", {
        groupBy: "api_key",
        measure: "amount_total",
      }),
    ).rejects.toThrow("validation_failed");
  });
});
