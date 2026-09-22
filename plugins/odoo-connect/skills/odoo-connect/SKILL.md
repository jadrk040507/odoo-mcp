---
name: odoo-connect
description: Use connected Odoo SaaS data for contacts, CRM, sales, and invoicing through curated Odoo Connect tools.
---

# Odoo Connect

Use read tools directly. Before any supported write, call its matching preview tool and show the proposed change. Call the confirmation tool only after explicit user approval.

Stable reads: `get_connection_profile`, `list_capabilities`, `search_contacts`, `search_crm_opportunities`, `search_quotations_and_orders`, `search_invoices`, `get_business_record`, and `aggregate_business_records`. Supported writes are contact changes, opportunity changes, and quotation creation/update through matching `preview_*` then `confirm_*` tools. Confirmation tokens are short-lived and single-use.

Never request an Odoo API key in chat. Direct users to the secure connection page when `connection_required` occurs.

Do not claim support for deletion, arbitrary model methods, invoice posting, or sales-order confirmation.

If a write times out after confirmation, instruct the user to check Odoo before creating a new preview; never retry blindly.
