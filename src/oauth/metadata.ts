export const oauthScopes = ["odoo.read", "odoo.write"] as const;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...oauthScopes],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: [
      "RS256",
      "PS256",
      "ES256",
      "ES384",
      "EdDSA",
    ],
    scopes_supported: [...oauthScopes],
    revocation_endpoint_auth_methods_supported: ["private_key_jwt"],
  };
}
