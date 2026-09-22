# Odoo — Community Plugin for ChatGPT & Codex

Public Apache-2.0 plugin and Cloudflare Worker gateway for one Odoo SaaS 19.4 tenant per user. It exposes curated contacts, CRM, sales, and invoicing tools through OAuth 2.1 while delegating all Odoo access to Odoo's native MCP endpoint.

Business records only transit the Worker for the active request and are not stored. Odoo API keys are encrypted in D1; writes require a short-lived preview and explicit confirmation. Deletion, arbitrary model methods, invoice posting, and sales-order confirmation are not available in v1.

The public MCP endpoint is intentionally not present until an authorized staging HTTPS origin exists. See [development](docs/development.md), [deployment](docs/deployment.md), [privacy](docs/privacy.md), [terms](docs/terms.md), [support](docs/support.md), and [deletion](docs/deletion.md).

Licensed under Apache-2.0. This project is independent and is not endorsed by Odoo S.A. or OpenAI.

## Example uses

- “Show my newest CRM opportunities in Odoo.”
- “Find overdue customer invoices and summarize the totals.”
- “Search for contacts at Acme and show their current phone numbers.”
- “Preview changing this opportunity's expected revenue.”
- “Create a quotation preview for this customer.”

Reads fetch current Odoo data. Supported writes always return a preview and require explicit confirmation before execution.

## Official references

- [Odoo documentation](https://www.odoo.com/documentation/19.0/)
- [Odoo external API and API-key guidance](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)
- [Odoo brand assets and logo usage](https://www.odoo.com/page/brand-assets)
- [Model Context Protocol](https://modelcontextprotocol.io/)

The logo in `plugins/odoo-connect/assets/odoo-logo.svg` is the official unmodified Odoo logo downloaded from Odoo's brand-assets page. “Odoo” and the Odoo logo are trademarks of Odoo S.A.; their use does not imply affiliation or endorsement.
