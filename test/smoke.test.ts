import { describe, expect, it } from "vitest";

import iconSource from "../plugins/odoo-connect/assets/icon.svg?raw";
import manifestSource from "../plugins/odoo-connect/.codex-plugin/plugin.json?raw";
import localMcpSource from "../plugins/odoo-connect/.mcp.local.json?raw";

describe("worker scaffold", () => {
  it("serves environment health without exposing configuration", async () => {
    const { handleHealth } = await import("../src/index.js");
    const response = handleHealth("local");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      environment: "local",
    });
  });

  it("publishes valid local plugin metadata without a public MCP endpoint", async () => {
    const manifest = JSON.parse(manifestSource) as Record<string, unknown>;
    const localMcp = JSON.parse(localMcpSource) as {
      mcpServers: { "odoo-connect": { type: string; url: string } };
    };

    expect(manifest).toMatchObject({
      name: "odoo-connect",
      version: "0.1.0",
      license: "Apache-2.0",
    });
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(
      (manifest.interface as { defaultPrompt: string[] }).defaultPrompt,
    ).toHaveLength(3);
    expect(localMcp.mcpServers["odoo-connect"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:8787/mcp",
    });
    expect(iconSource).toContain("<svg");
  });
});
