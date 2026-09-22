export const gatewayErrorCodes = [
  "connection_required",
  "credential_expired_or_revoked",
  "tenant_unreachable",
  "capability_unavailable",
  "permission_denied",
  "validation_failed",
  "confirmation_required",
  "confirmation_expired",
  "rate_limited",
  "upstream_timeout",
  "internal_error",
] as const;

export type GatewayErrorCode = (typeof gatewayErrorCodes)[number];

const actions: Record<GatewayErrorCode, string> = {
  connection_required: "Connect an Odoo tenant before using this tool.",
  credential_expired_or_revoked:
    "Reconnect Odoo with a valid MCP-scoped API key.",
  tenant_unreachable:
    "Try again after checking that the Odoo tenant is available.",
  capability_unavailable:
    "This Odoo tenant does not expose the required capability.",
  permission_denied: "Ask an Odoo administrator for the required access.",
  validation_failed: "Correct the tool input and try again.",
  confirmation_required: "Preview the change and explicitly confirm it.",
  confirmation_expired: "Create a new preview before confirming.",
  rate_limited: "Wait before retrying this request.",
  upstream_timeout: "Retry the read later; do not blindly retry a write.",
  internal_error: "Retry later and provide the correlation ID to support.",
};

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "GatewayError";
  }
}

export function toMcpError(error: unknown, requestId: string) {
  const code = error instanceof GatewayError ? error.code : "internal_error";
  const safe = { code, action: actions[code], requestId };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(safe) }],
    structuredContent: safe,
  };
}
