import { GatewayError } from "../errors.js";
import type { NormalizedWrite, WriteOperation } from "./types.js";

const allowed: Record<WriteOperation, ReadonlySet<string>> = {
  "contact.change": new Set([
    "name",
    "email",
    "phone",
    "mobile",
    "street",
    "street2",
    "city",
    "zip",
    "country_id",
    "company_name",
  ]),
  "opportunity.change": new Set([
    "name",
    "partner_id",
    "user_id",
    "stage_id",
    "expected_revenue",
    "probability",
    "date_deadline",
    "description",
  ]),
  "quotation.create": new Set([
    "partner_id",
    "validity_date",
    "client_order_ref",
    "note",
  ]),
  "quotation.update": new Set([
    "partner_id",
    "validity_date",
    "client_order_ref",
    "note",
  ]),
};

function clean(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  throw new GatewayError("validation_failed");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeWrite(
  operation: WriteOperation,
  input: unknown,
): NormalizedWrite {
  if (!input || typeof input !== "object")
    throw new GatewayError("validation_failed");
  const raw = input as { targetId?: unknown; changes?: unknown };
  const creating = operation === "quotation.create";
  if (
    !creating &&
    (!Number.isSafeInteger(raw.targetId) || (raw.targetId as number) <= 0)
  )
    throw new GatewayError("validation_failed");
  if (creating && raw.targetId !== undefined)
    throw new GatewayError("validation_failed");
  if (
    !raw.changes ||
    typeof raw.changes !== "object" ||
    Array.isArray(raw.changes)
  )
    throw new GatewayError("validation_failed");
  const entries = Object.entries(raw.changes as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(([key]) => !allowed[operation].has(key))
  )
    throw new GatewayError("validation_failed");
  const changes = Object.fromEntries(
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, clean(value)]),
  );
  return creating ? { changes } : { targetId: raw.targetId as number, changes };
}
