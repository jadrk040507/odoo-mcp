import { GatewayError } from "../errors.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { McpRequestContext } from "../mcp/context.js";
import { mcpResult } from "../mcp/result.js";
import { toMcpError } from "../errors.js";
import {
  isBusinessResource,
  resourcePolicies,
  type BusinessResource,
} from "./field-policy.js";
import {
  decodeCursor,
  encodeCursor,
  pageInput,
  type PageInput,
} from "./schemas.js";

export interface ReadUpstream {
  capabilities: Set<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface SearchInput extends PageInput {
  query?: string;
}

function recordsFrom(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object")
    throw new GatewayError("tenant_unreachable");
  const records = (value as { records?: unknown }).records;
  if (
    !Array.isArray(records) ||
    records.some((record) => !record || typeof record !== "object")
  ) {
    throw new GatewayError("tenant_unreachable");
  }
  return records as Record<string, unknown>[];
}

function selectFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field in record ? [[field, record[field]]] : [],
    ),
  );
}

export class BusinessReadService {
  constructor(private readonly upstream: ReadUpstream) {}

  private requireCapability(name: string): void {
    if (!this.upstream.capabilities.has(name)) {
      throw new GatewayError("capability_unavailable");
    }
  }

  async search(resource: BusinessResource, input: SearchInput) {
    this.requireCapability("search");
    const policy = resourcePolicies[resource];
    const query = { resource, query: input.query?.trim() ?? "" };
    const page = pageInput(input);
    const offset = input.cursor ? await decodeCursor(input.cursor, query) : 0;
    const result = await this.upstream.callTool("search", {
      model: policy.model,
      domain: query.query ? [[policy.searchField, "ilike", query.query]] : [],
      fields: [...policy.fields],
      limit: page.limit + 1,
      offset,
    });
    const records = recordsFrom(result);
    const truncated = records.length > page.limit;
    return {
      records: records
        .slice(0, page.limit)
        .map((record) => selectFields(record, policy.fields)),
      truncated,
      nextCursor: truncated
        ? await encodeCursor(offset + page.limit, query)
        : undefined,
    };
  }

  async getRecord(resource: string, id: number, requestedFields?: string[]) {
    if (!isBusinessResource(resource) || !Number.isSafeInteger(id) || id <= 0) {
      throw new GatewayError("validation_failed");
    }
    this.requireCapability("search");
    const policy = resourcePolicies[resource];
    const fields = requestedFields ?? [...policy.fields];
    if (
      fields.some(
        (field) => !(policy.fields as readonly string[]).includes(field),
      )
    ) {
      throw new GatewayError("validation_failed");
    }
    const result = await this.upstream.callTool("search", {
      model: policy.model,
      domain: [["id", "=", id]],
      fields,
      limit: 1,
      offset: 0,
    });
    const records = recordsFrom(result);
    return { record: records[0] ? selectFields(records[0], fields) : null };
  }

  async aggregate(
    resource: string,
    input: { groupBy: string; measure: string },
  ) {
    if (!isBusinessResource(resource))
      throw new GatewayError("validation_failed");
    this.requireCapability("read_group");
    const policy = resourcePolicies[resource];
    if (
      !(policy.groupBy as readonly string[]).includes(input.groupBy) ||
      !(policy.measures as readonly string[]).includes(input.measure)
    ) {
      throw new GatewayError("validation_failed");
    }
    const result = await this.upstream.callTool("read_group", {
      model: policy.model,
      domain: [],
      groupby: [input.groupBy],
      fields: [`${input.measure}:sum`],
      limit: 51,
    });
    const records = recordsFrom(result);
    return {
      groups: records
        .slice(0, 50)
        .map((record) => selectFields(record, [input.groupBy, input.measure])),
      truncated: records.length > 50,
    };
  }
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const searchSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().optional(),
  cursor: z.string().max(1024).optional(),
});

export function registerReadTools(
  server: McpServer,
  context: McpRequestContext,
  service: BusinessReadService,
): void {
  const searches: Array<[string, BusinessResource, string]> = [
    ["search_contacts", "contacts", "Search Odoo contacts."],
    ["search_crm_opportunities", "opportunities", "Search CRM opportunities."],
    [
      "search_quotations_and_orders",
      "sales",
      "Search quotations and sales orders.",
    ],
    ["search_invoices", "invoices", "Search customer and vendor invoices."],
  ];
  for (const [name, resource, description] of searches) {
    server.registerTool(
      name,
      { description, inputSchema: searchSchema, annotations: readAnnotations },
      async (input) => {
        try {
          return mcpResult(await service.search(resource, input));
        } catch (error) {
          return toMcpError(error, context.requestId);
        }
      },
    );
  }
  server.registerTool(
    "get_business_record",
    {
      description: "Get one approved Odoo business record by ID.",
      inputSchema: z.object({
        resource: z.enum(["contacts", "opportunities", "sales", "invoices"]),
        id: z.number().int().positive(),
        fields: z.array(z.string()).max(20).optional(),
      }),
      annotations: readAnnotations,
    },
    async ({ resource, id, fields }) => {
      try {
        return mcpResult(await service.getRecord(resource, id, fields));
      } catch (error) {
        return toMcpError(error, context.requestId);
      }
    },
  );
  server.registerTool(
    "aggregate_business_records",
    {
      description: "Aggregate approved Odoo records by an approved dimension.",
      inputSchema: z.object({
        resource: z.enum(["contacts", "opportunities", "sales", "invoices"]),
        groupBy: z.string(),
        measure: z.string(),
      }),
      annotations: readAnnotations,
    },
    async ({ resource, groupBy, measure }) => {
      try {
        return mcpResult(
          await service.aggregate(resource, { groupBy, measure }),
        );
      } catch (error) {
        return toMcpError(error, context.requestId);
      }
    },
  );
}
