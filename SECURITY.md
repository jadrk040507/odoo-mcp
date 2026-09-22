# Security policy

Report suspected vulnerabilities privately to `jadrk040507@gmail.com`. Include affected version, impact, reproduction steps, and a request ID when available; never include Odoo API keys, OAuth tokens, private keys, or business records. Do not open a public issue before coordinated disclosure.

Supported security fixes target the current `main` branch. Operators must use Cloudflare Secrets, scoped Odoo `mcp` keys, separate staging/production D1 databases, and the incident runbooks under `docs/runbooks/`.
