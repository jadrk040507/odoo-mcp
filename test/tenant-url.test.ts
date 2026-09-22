import { describe, expect, it } from "vitest";

import type { DnsResolver } from "../src/security/tenant-url.js";
import { validateTenantOrigin } from "../src/security/tenant-url.js";

const publicResolver: DnsResolver = {
  resolve: async () => ({ addresses: ["8.8.8.8"], ttl: 60 }),
};

describe("validateTenantOrigin", () => {
  it.each([
    ["https://acme.odoo.com", "https://acme.odoo.com"],
    ["https://ACME.odoo.com/", "https://acme.odoo.com"],
    ["https://erp.eu.odoo.com", "https://erp.eu.odoo.com"],
  ])("accepts and canonicalizes %s", async (input, origin) => {
    await expect(validateTenantOrigin(input, publicResolver)).resolves.toEqual({
      origin,
      host: new URL(origin).hostname,
    });
  });

  it.each([
    "http://acme.odoo.com",
    "https://odoo.com",
    "https://evilodoo.com",
    "https://acme.odoo.com.",
    "https://acme%2eodoo.com",
    "https://acme。odoo.com",
    "https://user:pass@acme.odoo.com",
    "https://acme.odoo.com:8443",
    "https://acme.odoo.com/mcp",
    "https://acme.odoo.com?next=x",
    "https://acme.odoo.com#x",
    "https://127.0.0.1",
    "https://[::1]",
  ])("rejects disallowed origin %s", async (input) => {
    await expect(validateTenantOrigin(input, publicResolver)).rejects.toThrow(
      "Invalid Odoo tenant origin",
    );
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("rejects forbidden DNS address %s", async (address) => {
    const resolver: DnsResolver = {
      resolve: async () => ({ addresses: [address], ttl: 60 }),
    };
    await expect(
      validateTenantOrigin("https://acme.odoo.com", resolver),
    ).rejects.toThrow("Unsafe Odoo tenant address");
  });

  it.each<{ addresses: string[] }>([
    { addresses: [] },
    { addresses: ["8.8.8.8", "127.0.0.1"] },
  ])("rejects empty or mixed DNS results %#", async ({ addresses }) => {
    const resolver: DnsResolver = {
      resolve: async () => ({ addresses, ttl: 60 }),
    };
    await expect(
      validateTenantOrigin("https://acme.odoo.com", resolver),
    ).rejects.toThrow();
  });
});
