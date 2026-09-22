import { spawnSync } from "node:child_process";

const validator =
  "/home/jadrk040507/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py";
const result = spawnSync("python3", [validator, "plugins/odoo-connect"], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
