import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

process.env.CREDENTIAL_KEY_V1 ??= "test-only-credential-key";
process.env.TOKEN_HASH_PEPPER ??= "test-only-token-pepper";
process.env.AUDIT_HASH_KEY ??= "test-only-audit-key";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          CREDENTIAL_KEY_V1: "test-only-credential-key",
          TOKEN_HASH_PEPPER: "test-only-token-pepper",
          AUDIT_HASH_KEY: "test-only-audit-key",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "migrations"),
          ),
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
