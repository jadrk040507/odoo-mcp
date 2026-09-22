export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface OdooServerInfo {
  name: string;
  version: string;
}

export interface OdooProfile {
  server: OdooServerInfo;
  tools: string[];
}

export type OdooErrorCategory =
  | "credential_rejected"
  | "permission_denied"
  | "rate_limited"
  | "tenant_unreachable"
  | "malformed_response"
  | "capability_unavailable";
