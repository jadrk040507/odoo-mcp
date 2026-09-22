import { describe, expect, it, vi } from "vitest";

import type { DnsResolver } from "../src/security/tenant-url.js";
import { safeTenantFetch } from "../src/security/safe-fetch.js";

function resolver(...answers: string[][]): DnsResolver {
  let index = 0;
  return {
    resolve: async () => ({
      addresses: answers[Math.min(index++, answers.length - 1)] ?? [],
      ttl: 60,
    }),
  };
}

describe("safeTenantFetch", () => {
  it("fetches a bounded same-origin response with redirects disabled", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      return new Response("ok");
    });
    const response = await safeTenantFetch(
      "https://acme.odoo.com",
      "/mcp",
      {},
      { resolver: resolver(["8.8.8.8"]), fetch: fetcher },
    );
    expect(await response.text()).toBe("ok");
  });

  it("revalidates DNS for every same-origin redirect and catches rebinding", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.redirect("https://acme.odoo.com/next", 302),
    );
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"], ["127.0.0.1"]),
          fetch: fetcher,
        },
      ),
    ).rejects.toThrow("Unsafe Odoo tenant address");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin redirects", async () => {
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          fetch: async () =>
            Response.redirect("https://other.odoo.com/mcp", 302),
        },
      ),
    ).rejects.toThrow("Unsafe redirect");
  });

  it("rejects credentials injected through paths or redirects", async () => {
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "//user@acme.odoo.com/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          fetch: async () => new Response("unreachable"),
        },
      ),
    ).rejects.toThrow("Unsafe request URL");
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          fetch: async () =>
            Response.redirect("https://user@acme.odoo.com/mcp", 302),
        },
      ),
    ).rejects.toThrow("Unsafe redirect");
  });

  it("rejects redirect loops after three hops", async () => {
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          fetch: async () =>
            Response.redirect("https://acme.odoo.com/mcp", 302),
        },
      ),
    ).rejects.toThrow("Too many redirects");
  });

  it("rejects responses larger than one MiB", async () => {
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          fetch: async () => new Response(new Uint8Array(1_048_577)),
        },
      ),
    ).rejects.toThrow("Response too large");
  });

  it("aborts timed-out requests", async () => {
    await expect(
      safeTenantFetch(
        "https://acme.odoo.com",
        "/mcp",
        {},
        {
          resolver: resolver(["8.8.8.8"]),
          timeoutMs: 1,
          fetch: async (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              );
            }),
        },
      ),
    ).rejects.toThrow();
  });
});
