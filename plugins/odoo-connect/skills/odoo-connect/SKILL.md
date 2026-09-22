---
name: odoo-connect
description: Use connected Odoo SaaS data for contacts, CRM, sales, and invoicing through curated Odoo Connect tools.
---

# Odoo

Community-developed plugin for Odoo. This is an independent connector and is not affiliated with or endorsed by Odoo S.A.

Use read tools directly. Before any supported write, call its matching preview tool and show the proposed change. Call the confirmation tool only after explicit user approval.

Stable reads: `get_connection_profile`, `list_capabilities`, `search_contacts`, `search_crm_opportunities`, `search_quotations_and_orders`, `search_invoices`, `get_business_record`, and `aggregate_business_records`. Supported writes are contact changes, opportunity changes, and quotation creation/update through matching `preview_*` then `confirm_*` tools. Confirmation tokens are short-lived and single-use.

Never request an Odoo API key in chat. Direct users to the secure connection page when `connection_required` occurs.

Do not claim support for deletion, arbitrary model methods, invoice posting, or sales-order confirmation.

If a write times out after confirmation, instruct the user to check Odoo before creating a new preview; never retry blindly.

## Example uses

- Find contacts by name, email, phone, or company.
- Review current CRM opportunities and expected revenue.
- Search quotations, sales orders, and invoices with bounded results.
- Aggregate approved business records by supported dimensions.
- Preview and confirm a contact, opportunity, or quotation change.

When presenting results, identify Odoo as the live source and distinguish retrieved facts from summaries or recommendations.

## References

- Odoo 19.4 documentation: https://www.odoo.com/documentation/19.0/
- Odoo external API and API-key guidance: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
- Odoo brand assets and logo usage: https://www.odoo.com/page/brand-assets
- Plugin privacy policy: https://github.com/jadrk040507/odoo-mcp/blob/main/docs/privacy.md
- Support and security: https://github.com/jadrk040507/odoo-mcp/blob/main/docs/support.md
