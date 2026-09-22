import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";

import { writeOdooTools } from "./capabilities.js";
import { safeTenantFetch } from "../security/safe-fetch.js";
import {
  CloudflareDnsResolver,
  type DnsResolver,
} from "../security/tenant-url.js";
import type {
  OdooErrorCategory,
  OdooProfile,
  OdooServerInfo,
  UpstreamTool,
} from "./types.js";

export interface OdooClientAdapter {
  connect(): Promise<OdooServerInfo>;
  listTools(): Promise<UpstreamTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface OdooClientDependencies {
  adapter?: OdooClientAdapter;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelay?: (attempt: number) => Promise<void>;
  resolver?: DnsResolver;
}

export class OdooUpstreamError extends Error {
  constructor(
    readonly category: OdooErrorCategory,
    readonly status?: number,
    _unsafeDetail?: string,
  ) {
    super(category);
    void _unsafeDetail;
    this.name = "OdooUpstreamError";
  }
}

class SdkOdooAdapter implements OdooClientAdapter {
  private readonly client = new Client({
    name: "odoo-connect-gateway",
    version: "0.1.0",
  });
  private readonly transport: StreamableHTTPClientTransport;

  constructor(origin: string, apiKey: string, fetcher?: typeof fetch) {
    this.transport = new StreamableHTTPClientTransport(
      new URL("/mcp", origin),
      {
        authProvider: { token: async () => apiKey },
        fetch: fetcher,
      },
    );
  }

  async connect(): Promise<OdooServerInfo> {
    await this.client.connect(this.transport);
    const server = this.client.getServerVersion();
    if (!server) throw new OdooUpstreamError("malformed_response");
    return { name: server.name, version: server.version };
  }

  async listTools(): Promise<UpstreamTool[]> {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function normalizeError(error: unknown): OdooUpstreamError {
  if (error instanceof OdooUpstreamError) {
    return new OdooUpstreamError(error.category, error.status);
  }
  if (error instanceof UnauthorizedError) {
    return new OdooUpstreamError("credential_rejected", 401);
  }
  if (error instanceof SdkHttpError) {
    const status = error.status;
    if (status === 401)
      return new OdooUpstreamError("credential_rejected", status);
    if (status === 403)
      return new OdooUpstreamError("permission_denied", status);
    if (status === 429) return new OdooUpstreamError("rate_limited", status);
    return new OdooUpstreamError("tenant_unreachable", status);
  }
  return new OdooUpstreamError("tenant_unreachable");
}

export class OdooClient {
  private readonly adapter: OdooClientAdapter;
  private readonly timeoutMs: number;
  private readonly retryDelay: (attempt: number) => Promise<void>;
  private tools = new Set<string>();

  constructor(
    origin: string,
    apiKey: string,
    dependencies: OdooClientDependencies = {},
  ) {
    const resolver = dependencies.resolver ?? new CloudflareDnsResolver();
    const safeFetch: typeof fetch = (input, init) => {
      const requested = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (input instanceof Request && init === undefined) {
        init = {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: input.signal,
        };
      }
      return safeTenantFetch(
        origin,
        `${requested.pathname}${requested.search}`,
        init ?? {},
        {
          resolver,
          fetch: dependencies.fetch,
          timeoutMs: dependencies.timeoutMs,
        },
      );
    };
    this.adapter =
      dependencies.adapter ?? new SdkOdooAdapter(origin, apiKey, safeFetch);
    this.timeoutMs = dependencies.timeoutMs ?? 10_000;
    this.retryDelay =
      dependencies.retryDelay ??
      ((attempt) =>
        new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt)));
  }

  private async timed<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new OdooUpstreamError("tenant_unreachable")),
            this.timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      throw normalizeError(error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async initialize(): Promise<OdooProfile> {
    const server = await this.timed(() => this.adapter.connect());
    const tools = await this.listTools();
    return { server, tools: tools.map((tool) => tool.name) };
  }

  async listTools(): Promise<UpstreamTool[]> {
    const tools = await this.timed(() => this.adapter.listTools());
    if (!Array.isArray(tools) || tools.some((tool) => !tool.name)) {
      throw new OdooUpstreamError("malformed_response");
    }
    this.tools = new Set(tools.map((tool) => tool.name));
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.tools.has(name))
      throw new OdooUpstreamError("capability_unavailable");
    const attempts = writeOdooTools.has(name) ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.timed(() => this.adapter.callTool(name, args));
      } catch (error) {
        const normalized = normalizeError(error);
        if (
          attempt + 1 >= attempts ||
          !["rate_limited", "tenant_unreachable"].includes(normalized.category)
        ) {
          throw normalized;
        }
        await this.retryDelay(attempt);
      }
    }
    throw new OdooUpstreamError("tenant_unreachable");
  }

  close(): Promise<void> {
    return this.adapter.close();
  }
}
