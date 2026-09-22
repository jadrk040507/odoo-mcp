import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { McpRequestContext } from "../src/mcp/context.js";
import { serveMcpRequest } from "../src/mcp/server.js";
import worker from "../src/index.js";

const executionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

const context: McpRequestContext = {
  auth: {
    userId: "user-1",
    connectionId: "connection-1",
    grantId: "grant-1",
    scopes: ["odoo.read"],
    tokenId: "token-1",
  },
  requestId: "request-1",
  services: { db: env.DB },
};

async function responseMessage(response: Response): Promise<unknown> {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text);
}

async function rpc(
  method: string,
  params: object = {},
  headers: HeadersInit = {},
) {
  return serveMcpRequest(
    new Request("https://gateway.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "gateway.example",
        origin: "https://chatgpt.com",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    env,
    executionContext,
    context,
  );
}

describe("MCP gateway shell", () => {
  it("challenges unauthenticated MCP requests with resource metadata", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.example/mcp", { method: "POST" }),
      env,
      executionContext,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("initializes through stateless SDK v2 and returns a request ID", async () => {
    const response = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "1.0.0" },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    const body = (await responseMessage(response)) as {
      result: { serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("odoo-connect");
  });

  it("lists no premature tools before Task 8 registration", async () => {
    const response = await rpc(
      "tools/list",
      {},
      { "mcp-protocol-version": "2025-06-18" },
    );
    expect(response.status).toBe(200);
    await expect(responseMessage(response)).resolves.toMatchObject({
      result: { tools: [] },
    });
  });

  it("rejects unsupported methods and disallowed browser origins", async () => {
    const method = await serveMcpRequest(
      new Request("https://gateway.example/mcp", {
        method: "PUT",
        headers: { host: "gateway.example" },
      }),
      env,
      executionContext,
      context,
    );
    expect(method.status).toBe(405);

    const origin = await rpc(
      "tools/list",
      {},
      { origin: "https://evil.example" },
    );
    expect(origin.status).toBe(403);
  });

  it("context contains identifiers and services but no credential field", () => {
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/api.?key|credential|secret|bearer/i);
  });
});
