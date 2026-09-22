import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

import type { McpRequestContext } from "./context.js";
import { registerAccountTools } from "../tools/account.js";
import { registerReadTools } from "../tools/read.js";
import { registerWriteTools } from "../tools/write.js";

const allowedOrigins = [
  "chatgpt.com",
  "chat.openai.com",
  "platform.openai.com",
];

export function createServer(context: McpRequestContext): McpServer {
  void context;
  const server = new McpServer({ name: "odoo-connect", version: "0.1.0" });
  const placeholder = server.registerTool(
    "__registration_placeholder",
    {
      description: "Disabled registration placeholder",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ content: [] }),
  );
  placeholder.disable();
  if (context.services.account) {
    registerAccountTools(server, context, context.services.account);
  }
  if (context.services.read) {
    registerReadTools(server, context, context.services.read);
  }
  if (context.services.write) {
    registerWriteTools(server, context, context.services.write);
  }
  return server;
}

export async function serveMcpRequest(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
  context: McpRequestContext,
): Promise<Response> {
  const hostname = new URL(request.url).hostname;
  const handler = createMcpHandler(() => createServer(context), {
    route: "/mcp",
    allowedHostnames: [hostname],
    allowedOriginHostnames: allowedOrigins,
    corsOptions: { origin: "https://chatgpt.com" },
    legacy: "stateless",
  });
  const response = await handler(request, env, executionContext);
  const headers = new Headers(response.headers);
  headers.set("x-request-id", context.requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
