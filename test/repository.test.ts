import { describe, expect, it } from "vitest";
import readme from "../README.md?raw";
import security from "../SECURITY.md?raw";
import contributing from "../CONTRIBUTING.md?raw";
import privacy from "../docs/privacy.md?raw";
import terms from "../docs/terms.md?raw";
import support from "../docs/support.md?raw";
import deletion from "../docs/deletion.md?raw";
import checklist from "../docs/submission-checklist.md?raw";
import ci from "../.github/workflows/ci.yml?raw";
import staging from "../.github/workflows/deploy-staging.yml?raw";
import production from "../.github/workflows/deploy-production.yml?raw";
import manifestRaw from "../plugins/odoo-connect/.codex-plugin/plugin.json?raw";

describe("public repository contract", () => {
  it("ships required public policies without placeholders", () => {
    const documents = [
      readme,
      security,
      contributing,
      privacy,
      terms,
      support,
      deletion,
      checklist,
    ];
    for (const document of documents)
      expect(document).not.toMatch(/TODO|TBD|example\.com|\.invalid/iu);
    expect(readme).toContain("Apache-2.0");
    expect(privacy).toMatch(/transit|tránsito/iu);
    expect(privacy).toMatch(/retention|retención/iu);
    expect(readme).toContain("docs/support.md");
    expect(readme).toContain("docs/deletion.md");
  });

  it("gates CI and manual deployments", () => {
    for (const command of [
      "format:check",
      "lint",
      "cf:typegen",
      "typecheck",
      "test:integration",
      "audit",
      "check:secrets",
      "validate:plugin",
      "deploy --dry-run",
    ])
      expect(ci).toContain(command);
    expect(staging).toContain("workflow_dispatch");
    expect(staging).toContain("environment: staging");
    expect(staging).toContain("d1 migrations apply");
    expect(production).toContain("workflow_dispatch");
    expect(production).toContain("environment: production");
  });

  it("keeps the public MCP config blocked until one HTTPS origin is authorized", () => {
    const manifest = JSON.parse(manifestRaw) as {
      repository: string;
      homepage: string;
      mcpServers?: string;
      interface: Record<string, unknown>;
    };
    expect(manifest.repository).toBe("https://github.com/jadrk040507/odoo-mcp");
    expect(manifest.homepage).toBe("https://github.com/jadrk040507/odoo-mcp");
    expect(manifest.mcpServers).toBeUndefined();
    expect(checklist).toContain("BLOCKED: authorized staging origin");
  });
});
