export const requiredOdooTools = [
  "get_models",
  "get_fields",
  "search",
  "read_group",
  "create_records",
  "update_records",
] as const;

export const writeOdooTools = new Set(["create_records", "update_records"]);

export function missingRequiredTools(tools: readonly string[]): string[] {
  const available = new Set(tools);
  return requiredOdooTools.filter((tool) => !available.has(tool));
}
