# Credential compromise

Detect via authorization failures or a user/security report. Disable the affected Odoo API key in Odoo first, then disconnect the user connection so ciphertext, grants, tokens, and pending intents are invalidated. Rotate `CREDENTIAL_KEY_V1` only if gateway key material may be exposed. Validate that bearer access fails and reconnect with a new MCP-scoped key. Record timestamps and request IDs; never copy keys or Odoo payloads into the incident record. Roll back application code only through the last known-good Worker version.
