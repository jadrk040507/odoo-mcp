# Architecture

ChatGPT or Codex connects to one universal Cloudflare Worker MCP URL. The Worker authenticates the client using OAuth 2.1, resolves the user's active encrypted connection from D1, decrypts the MCP-scoped Odoo key only inside the request, and calls `https://<tenant>.odoo.com/mcp` through the SSRF boundary.

D1 stores users, encrypted connection material, hashed OAuth tokens, short-lived confirmation intents, safe idempotency receipts, and content-free audit metadata. It does not store Odoo business records. Reads are bounded and field-allowlisted. Writes follow preview → single-use confirmation → one upstream call.
