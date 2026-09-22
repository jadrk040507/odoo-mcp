import { readFileSync, writeFileSync } from "node:fs";

const raw = process.argv[2];
if (!raw) throw new Error("An authorized HTTPS origin is required");
const origin = new URL(raw);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.port ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.hostname === "localhost" ||
  origin.hostname.endsWith(".invalid")
)
  throw new Error("Origin must be a canonical public HTTPS root origin");
const root = new URL("../plugins/odoo-connect/", import.meta.url);
writeFileSync(
  new URL(".mcp.json", root),
  `${JSON.stringify({ mcpServers: { "odoo-connect": { type: "http", url: `${origin.origin}/mcp` } } }, null, 2)}\n`,
);
const manifestUrl = new URL(".codex-plugin/plugin.json", root);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
manifest.mcpServers = "./.mcp.json";
writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Rendered public plugin for ${origin.origin}`);
