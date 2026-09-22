import type { McpServer } from "@modelcontextprotocol/server";

import { toMcpError } from "../errors.js";
import type { McpRequestContext } from "../mcp/context.js";
import { mcpResult } from "../mcp/result.js";

export interface AccountToolService {
  profile(): Promise<Record<string, unknown>>;
  capabilities(): Promise<Record<string, unknown>>;
  disconnect(): Promise<Record<string, unknown>>;
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerAccountTools(
  server: McpServer,
  context: McpRequestContext,
  service: AccountToolService,
): void {
  server.registerTool(
    "get_connection_profile",
    {
      description: "Get the active Odoo connection profile.",
      annotations: readAnnotations,
    },
    async () => {
      try {
        return mcpResult(await service.profile());
      } catch (error) {
        return toMcpError(error, context.requestId);
      }
    },
  );
  server.registerTool(
    "list_capabilities",
    {
      description: "List curated Odoo capabilities.",
      annotations: readAnnotations,
    },
    async () => {
      try {
        return mcpResult(await service.capabilities());
      } catch (error) {
        return toMcpError(error, context.requestId);
      }
    },
  );
  server.registerTool(
    "disconnect_odoo",
    {
      description: "Begin the explicit Odoo disconnection flow.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        return mcpResult(await service.disconnect());
      } catch (error) {
        return toMcpError(error, context.requestId);
      }
    },
  );
}
