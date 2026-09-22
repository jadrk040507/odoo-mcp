# Threat model

Protected assets are Odoo credentials, OAuth grants, confirmation intents, and tenant data in transit. Principal threats include SSRF/DNS rebinding, token theft or replay, malicious OAuth client metadata, cross-tenant intent use, duplicate writes, log leakage, and compromised encryption keys.

Controls include strict `*.odoo.com` validation, public-IP checks on every request, redirect restrictions, PKCE S256, `private_key_jwt`, opaque hashed tokens, AES-256-GCM with connection-bound AAD, prepared D1 statements, short-lived single-use intents, idempotency receipts, explicit field allowlists, bounded bodies, redaction, and secret scanning. Residual risks include upstream Odoo compromise, operator Cloudflare compromise, and ambiguous network failure after a write; the gateway never retries such writes blindly.
