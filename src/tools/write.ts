import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toMcpError } from "../errors.js";
import type { McpRequestContext } from "../mcp/context.js";
import { mcpResult } from "../mcp/result.js";
import type { WriteOperation } from "../writes/types.js";

export interface WriteToolService {
  preview(
    connectionId: string,
    operation: WriteOperation,
    input: unknown,
  ): Promise<Record<string, unknown>>;
  confirm(
    connectionId: string,
    operation: WriteOperation,
    input: { intentToken: string; confirmed: true },
  ): Promise<Record<string, unknown>>;
}

const changes = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
const updateSchema = z.object({
  targetId: z.number().int().positive(),
  changes,
});
const createSchema = z.object({ changes });
const confirmSchema = z.object({
  intentToken: z.string().min(20).max(200),
  confirmed: z.literal(true),
});

const previewAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const confirmAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerWriteTools(
  server: McpServer,
  context: McpRequestContext,
  service: WriteToolService,
): void {
  const definitions: Array<
    [string, string, WriteOperation, typeof updateSchema | typeof createSchema]
  > = [
    [
      "preview_contact_change",
      "Preview an approved contact change.",
      "contact.change",
      updateSchema,
    ],
    [
      "preview_opportunity_change",
      "Preview an approved opportunity change.",
      "opportunity.change",
      updateSchema,
    ],
    [
      "preview_quotation_creation",
      "Preview a quotation creation.",
      "quotation.create",
      createSchema,
    ],
    [
      "preview_quotation_update",
      "Preview an approved quotation update.",
      "quotation.update",
      updateSchema,
    ],
  ];
  for (const [name, description, operation, inputSchema] of definitions) {
    server.registerTool(
      name,
      { description, inputSchema, annotations: previewAnnotations },
      async (input: Record<string, unknown>) => {
        try {
          return mcpResult(
            await service.preview(context.auth.connectionId, operation, input),
          );
        } catch (error) {
          return toMcpError(error, context.requestId);
        }
      },
    );
    server.registerTool(
      name.replace("preview_", "confirm_"),
      {
        description: description.replace("Preview", "Confirm"),
        inputSchema: confirmSchema,
        annotations: confirmAnnotations,
      },
      async (input: Record<string, unknown>) => {
        try {
          return mcpResult(
            await service.confirm(
              context.auth.connectionId,
              operation,
              input as { intentToken: string; confirmed: true },
            ),
          );
        } catch (error) {
          return toMcpError(error, context.requestId);
        }
      },
    );
  }
}
