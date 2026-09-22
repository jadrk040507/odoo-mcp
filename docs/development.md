# Development

Requirements: Node.js 24+, npm, Wrangler 4+, and Python 3 for plugin validation.

Copy `.dev.vars.example` to `.dev.vars` and generate non-production values. Use only a disposable Odoo sandbox key scoped to `mcp`. Run `npm ci`, `npm run cf:typegen`, `npx wrangler d1 migrations apply odoo-connect-local --local`, then `npm run check` and `npm run test:integration`. Start locally with `npm run dev`. Local credentials must never be reused in staging or production.
