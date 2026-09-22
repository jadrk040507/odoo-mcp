import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { McpRequestContext } from "../src/mcp/context.js";
import { createServer, serveMcpRequest } from "../src/mcp/server.js";
import type { AccountToolService } from "../src/tools/account.js";
import type { BusinessReadService } from "../src/tools/read.js";

const expectedTools = [
  "get_connection_profile",
  "list_capabilities",
  "disconnect_odoo",
  "search_contacts",
  "search_crm_opportunities",
  "search_quotations_and_orders",
  "search_invoices",
  "get_business_record",
  "aggregate_business_records",
].sort();

describe("public account/read tool contract", () => {
  it("registers exactly the approved inventory with safe annotations", async () => {
    const account = {
      profile: async () => ({
        tenantHost: "acme.odoo.com",
        user: "Demo User",
        activeCompany: "Acme",
        companies: ["Acme"],
        locale: "en_US",
        health: "ok",
      }),
      capabilities: async () => ({ read: true, write: false }),
      disconnect: async () => ({
        confirmationUrl: "https://gateway.example/connection/delete",
      }),
    } as AccountToolService;
    const read = {
      search: async () => ({ records: [], truncated: false }),
      getRecord: async () => ({ record: null }),
      aggregate: async () => ({ groups: [], truncated: false }),
    } as unknown as BusinessReadService;
    const context: McpRequestContext = {
      auth: {
        userId: "user-1",
        connectionId: "connection-1",
        grantId: "grant-1",
        scopes: ["odoo.read"],
        tokenId: "token-1",
      },
      requestId: "request-1",
      services: { db: env.DB, account, read },
    };
    const server = createServer(context);
    const transport = server.server;
    expect(transport).toBeDefined();

    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { enabled: boolean; annotations?: Record<string, boolean> }
        >;
      }
    )._registeredTools;
    const publicEntries = Object.entries(registered).filter(
      ([, tool]) => tool.enabled,
    );
    expect(publicEntries.map(([name]) => name).sort()).toEqual(expectedTools);
    for (const [name, tool] of publicEntries) {
      expect(tool.annotations?.openWorldHint).toBe(true);
      if (name === "disconnect_odoo") {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        });
      } else {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
    }
  });

  it("profile serialization excludes credential-shaped fields", async () => {
    const profile = {
      tenantHost: "acme.odoo.com",
      user: "Demo User",
      activeCompany: "Acme",
      companies: ["Acme"],
      locale: "es_MX",
      health: "ok",
    };
    expect(JSON.stringify(profile)).not.toMatch(
      /api.?key|credential|bearer|secret/i,
    );
  });

  it("publishes bounded JSON schemas with no arbitrary model or method", async () => {
    const account = {
      profile: async () => ({}),
      capabilities: async () => ({}),
      disconnect: async () => ({}),
    } as AccountToolService;
    const read = {
      search: async () => ({ records: [], truncated: false }),
      getRecord: async () => ({ record: null }),
      aggregate: async () => ({ groups: [], truncated: false }),
    } as unknown as BusinessReadService;
    const context: McpRequestContext = {
      auth: {
        userId: "user-1",
        connectionId: "connection-1",
        grantId: "grant-1",
        scopes: ["odoo.read"],
        tokenId: "token-1",
      },
      requestId: "request-schema",
      services: { db: env.DB, account, read },
    };
    const response = await serveMcpRequest(
      new Request("https://gateway.example/mcp", {
        method: "POST",
        headers: {
          host: "gateway.example",
          origin: "https://chatgpt.com",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
      env,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
        props: {},
      } as unknown as ExecutionContext,
      context,
    );
    const text = await response.text();
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    const message = JSON.parse(data ?? text) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    expect(message.result.tools.map((tool) => tool.name).sort()).toEqual(
      expectedTools,
    );
    expect(JSON.stringify(message.result.tools)).not.toMatch(
      /"model"|"method"|api.?key|credential/i,
    );
  });
});
