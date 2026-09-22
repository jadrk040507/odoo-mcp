import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
const fixtureSecret = process.env.ODOO_TEST_SECRET;
const violations = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content))
    violations.push(`${file}: private key`);
  if (
    /authorization\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._~-]{20,}/iu.test(content)
  )
    violations.push(`${file}: bearer credential`);
  if (
    fixtureSecret &&
    fixtureSecret.length >= 12 &&
    content.includes(fixtureSecret)
  )
    violations.push(`${file}: ODOO_TEST_SECRET value`);
  if (file === ".dev.vars")
    violations.push(`${file}: tracked local secrets`);
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files)`);
