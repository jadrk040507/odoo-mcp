# Staging test cases

After explicit authorization and sandbox setup, record date, Worker version, tenant, and request IDs without secrets.

1. Complete OAuth with PKCE and `private_key_jwt`; reject replay and wrong resource.
2. Connect one `*.odoo.com` sandbox with an MCP-scoped key.
3. Run each bounded read and confirm field/limit enforcement.
4. Preview and confirm one reversible contact update; replay the confirmation and observe one Odoo write.
5. Exercise permission denial, revoked key, rate limiting, timeout, and malformed upstream responses; inspect safe errors.
6. Disconnect and confirm old bearer tokens fail and credential material is absent.
7. Inspect Cloudflare logs for credentials, authorization headers, assertions, and Odoo payloads.
8. Run plugin validation and connect ChatGPT/Codex to the rendered HTTPS MCP URL.
