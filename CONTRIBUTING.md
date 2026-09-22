# Contributing

Use Node.js 24+, create a feature branch, and keep changes within the approved tool surface. Run `npm ci`, `npm run cf:typegen`, `npm run check`, `npm run test:integration`, `npm run check:secrets`, and `npm run validate:plugin` before proposing changes. New behavior requires a failing test first. Never commit `.dev.vars`, tenant credentials, tokens, private keys, D1 exports, or Odoo payloads.

By contributing, you agree that your contribution is licensed under Apache-2.0.
