# Odoo Connect for ChatGPT & Codex

Public Apache-2.0 plugin and Cloudflare Worker gateway for one Odoo SaaS 19.4 tenant per user. It exposes curated contacts, CRM, sales, and invoicing tools through OAuth 2.1 while delegating all Odoo access to Odoo's native MCP endpoint.

Business records only transit the Worker for the active request and are not stored. Odoo API keys are encrypted in D1; writes require a short-lived preview and explicit confirmation. Deletion, arbitrary model methods, invoice posting, and sales-order confirmation are not available in v1.

The public MCP endpoint is intentionally not present until an authorized staging HTTPS origin exists. See [development](docs/development.md), [deployment](docs/deployment.md), [privacy](docs/privacy.md), [terms](docs/terms.md), [support](docs/support.md), and [deletion](docs/deletion.md).

Licensed under Apache-2.0. This project is independent and is not endorsed by Odoo S.A. or OpenAI.
