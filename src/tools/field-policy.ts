export const resourcePolicies = {
  contacts: {
    model: "res.partner",
    fields: [
      "id",
      "name",
      "email",
      "phone",
      "mobile",
      "company_name",
      "is_company",
      "active",
    ],
    searchField: "name",
    groupBy: ["is_company", "active"],
    measures: ["id"],
  },
  opportunities: {
    model: "crm.lead",
    fields: [
      "id",
      "name",
      "partner_id",
      "user_id",
      "stage_id",
      "expected_revenue",
      "probability",
      "date_deadline",
      "active",
    ],
    searchField: "name",
    groupBy: ["stage_id", "user_id", "active"],
    measures: ["expected_revenue", "probability", "id"],
  },
  sales: {
    model: "sale.order",
    fields: [
      "id",
      "name",
      "partner_id",
      "state",
      "date_order",
      "amount_untaxed",
      "amount_total",
      "currency_id",
    ],
    searchField: "name",
    groupBy: ["state", "partner_id", "currency_id"],
    measures: ["amount_untaxed", "amount_total", "id"],
  },
  invoices: {
    model: "account.move",
    fields: [
      "id",
      "name",
      "partner_id",
      "move_type",
      "state",
      "invoice_date",
      "invoice_date_due",
      "amount_untaxed",
      "amount_total",
      "amount_residual",
      "currency_id",
    ],
    searchField: "name",
    groupBy: ["move_type", "state", "partner_id", "currency_id"],
    measures: ["amount_untaxed", "amount_total", "amount_residual", "id"],
  },
} as const;

export type BusinessResource = keyof typeof resourcePolicies;

export function isBusinessResource(value: string): value is BusinessResource {
  return Object.hasOwn(resourcePolicies, value);
}
