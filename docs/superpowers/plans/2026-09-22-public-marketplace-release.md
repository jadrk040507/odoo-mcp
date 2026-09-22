# Public Marketplace Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Odoo eligible for submission to OpenAI's universal Plugins Directory, deploy its universal MCP gateway, prove the production integration, and prepare a review-ready submission without publishing before operator approval.

**Architecture:** Keep one universal Cloudflare Worker MCP/OAuth origin in front of Odoo SaaS tenants. Treat Odoo authorization, Cloudflare deployment, production validation, and OpenAI submission as explicit gates: local preparation may continue independently, but no public submission occurs until every gate has evidence.

**Tech Stack:** TypeScript 6, Cloudflare Workers, D1, Wrangler 4, MCP TypeScript SDK 2, Vitest, GitHub Actions, OpenAI plugin submission portal.

**Spec:** `docs/superpowers/specs/2026-09-21-odoo-connect-plugin-design.md`

## Global Constraints

- Use the official Odoo SaaS MCP endpoint; do not recreate or bypass Odoo APIs.
- Accept only canonical `https://*.odoo.com` tenant origins in v1.
- Never expose an Odoo API key to the prompt, model context, logs, or tool output.
- Keep Odoo business data transit-only; retain only encrypted connection data, revocable OAuth state, confirmation state, and minimal audit metadata.
- Require preview plus explicit confirmation for supported writes; provide no deletion, arbitrary methods, invoice posting, or sales-order confirmation.
- Use a stable public HTTPS universal MCP URL and OAuth 2.1 with PKCE S256 and CIMD `private_key_jwt`.
- Use Wrangler 4+, `wrangler.jsonc`, generated Worker types, prepared D1 statements, and Cloudflare secrets.
- Do not deploy production, submit for review, or publish without explicit operator approval at the corresponding gate.
- Do not submit while the plugin is an unauthorized third-party connector; retain written authorization from Odoo that covers the integration and public directory distribution.
- Do not submit until OpenAI confirms that the external authorization page may accept and encrypt an Odoo MCP-scoped API key; current plugin privacy guidance otherwise prohibits collecting or processing authentication secrets.

## Review Focus

- Odoo authorization does not cover public marketplace distribution: stop before production submission and record the missing scope.
- Reviewer credentials require signup, inaccessible 2FA, or lack representative sample data: replace them before submission.
- Domain-verification token is missing or served with extra content: return the exact portal token from `/.well-known/openai-apps-challenge`.
- Tool annotations disagree with behavior: scan all tools and verify `readOnlyHint`, `destructiveHint`, and `openWorldHint` against actual side effects.
- Tool responses disclose credentials, internal IDs, telemetry, or undeclared personal data: fail the production privacy audit and do not submit.

---

### Task 1: Resolve public-directory eligibility

**Files:**

- Create: `docs/release/odoo-authorization.md`
- Modify: `docs/submission-checklist.md`
- Test: `test/repository.test.ts`

**Interfaces:**

- Consumes OpenAI's prohibition on unauthorized third-party connectors and Odoo's written authorization terms.
- Produces a dated eligibility record containing authorizing party, approved integration, permitted Odoo marks, public-directory distribution scope, OpenAI's decision on the API-key connection flow, support contacts, and evidence locations; the evidence itself remains outside Git.

- [ ] **Step 1: Write the failing repository test** requiring the authorization record and a submission checklist gate that is `BLOCKED` unless the record says all five scopes are verified.
- [ ] **Step 2: Run the test** with `npm test -- test/repository.test.ts`; expect failure because `docs/release/odoo-authorization.md` does not exist.
- [ ] **Step 3: Request written Odoo authorization** for the community-developed connector, official MCP use, the customer-facing name, logo use, and publication in the OpenAI universal Plugins Directory. Store correspondence outside the repository.
- [ ] **Step 4: Ask OpenAI developer support for a written eligibility decision** on accepting and encrypting an MCP-scoped Odoo API key solely inside the external OAuth connection page, because the plugin never sends it through MCP tool inputs or model context.
- [ ] **Step 5: Create the eligibility record** with no secrets or private correspondence, recording `VERIFIED` only for scopes explicitly granted and `BLOCKED` for every absent scope.
- [ ] **Step 6: Decide branding from the authorization**: keep `Odoo` and the official logo only when explicitly permitted; otherwise change the listing to `Odoo Community Connect` and use an original non-Odoo icon before submission.
- [ ] **Step 7: Run the focused test** and `git diff --check`.
- [ ] **Step 8: Commit** with `git add docs/release/odoo-authorization.md docs/submission-checklist.md test/repository.test.ts && git commit -m "docs: record Odoo marketplace authorization"`.

### Task 2: Add OpenAI domain verification and release metadata

**Files:**

- Modify: `src/index.ts`, `worker-configuration.d.ts`, `wrangler.jsonc`, `test/smoke.test.ts`, `docs/deployment.md`
- Create: `src/http/openai-challenge.ts`, `test/openai-challenge.test.ts`, `docs/release/listing.md`

**Interfaces:**

- Produces `handleOpenAiChallenge(request, env): Response` at `GET /.well-known/openai-apps-challenge`.
- Consumes the Cloudflare secret `env.OPENAI_APPS_CHALLENGE`; returns its exact UTF-8 value as `text/plain`, `Cache-Control: no-store`, and returns `404` when unset.
- Produces final listing copy, website/support/privacy/terms URLs, category, three starter prompts, country availability, and release notes.

- [ ] **Step 1: Write failing route tests** for exact token bytes, GET-only behavior, missing-token `404`, no caching, and absence of the token from logs and error bodies.
- [ ] **Step 2: Run failure** with `npm test -- test/openai-challenge.test.ts test/smoke.test.ts`.
- [ ] **Step 3: Implement the narrow challenge handler** and route it before OAuth/MCP dispatch without logging the value.
- [ ] **Step 4: Add `OPENAI_APPS_CHALLENGE` to `secrets.required`** in `wrangler.jsonc`, run `npm run cf:typegen`, and never commit the issued value.
- [ ] **Step 5: Write `docs/release/listing.md`** with the approved customer-facing name, community-developed status, exact capabilities and limitations, existing public policy URLs, the three existing starter prompts, worldwide availability excluding jurisdictions disallowed by OpenAI or Odoo, and release note `Initial public release for contacts, CRM, sales, and invoicing workflows.`
- [ ] **Step 6: Verify** with the focused tests, `npm run typecheck`, and `npm run check:secrets`.
- [ ] **Step 7: Commit** with `git add src/index.ts src/http/openai-challenge.ts worker-configuration.d.ts wrangler.jsonc test docs/deployment.md && git commit -m "feat: support OpenAI domain verification"`.

### Task 3: Build reviewer test materials

**Files:**

- Create: `docs/release/reviewer-test-cases.md`, `docs/release/tool-annotations.md`, `docs/release/privacy-response-audit.md`
- Modify: `docs/submission-checklist.md`, `test/repository.test.ts`

**Interfaces:**

- Produces five positive and three negative review cases with setup, prompt, expected tool, expected side effects, and expected result.
- Produces one annotation justification per exposed MCP tool.
- Produces a field-level response audit mapped to `docs/privacy.md`.

- [ ] **Step 1: Write a failing repository test** requiring exactly five numbered positive cases, three numbered negative cases, every registered tool name, and all three annotation names.
- [ ] **Step 2: Run failure** with `npm test -- test/repository.test.ts`.
- [ ] **Step 3: Write positive cases** for contact search, CRM opportunity search, overdue invoice search, contact-update preview/confirmation, and quotation preview/confirmation.
- [ ] **Step 4: Write negative cases** for an invalid tenant, a revoked/insufficient Odoo key, and an unsupported destructive request such as deleting a contact or posting an invoice.
- [ ] **Step 5: Document annotations**: reads use `readOnlyHint: true`; preview tools remain read-only; confirmation/disconnect tools use `readOnlyHint: false`; irreversible revocation uses `destructiveHint: true`; bounded private Odoo-account operations use `openWorldHint: false`.
- [ ] **Step 6: Audit every tool result field** and remove credentials, debug payloads, request IDs, internal token/grant/connection IDs, and user-related fields not required by the request or disclosed by `docs/privacy.md`.
- [ ] **Step 7: Run `npm run check`** and commit with `git add docs/release docs/submission-checklist.md test src && git commit -m "docs: add plugin review evidence"`.

### Task 4: Authenticate Cloudflare and provision staging

**Files:**

- Modify: `wrangler.jsonc`, `docs/deployment.md`, `docs/submission-checklist.md`
- Generated but untracked: Cloudflare account resources and secret values.

**Interfaces:**

- Produces authenticated Wrangler access, D1 database `odoo-connect-staging`, three staging secrets, an authorized staging HTTPS origin, and recorded non-secret resource identifiers.

- [ ] **Step 1: Authenticate interactively** with `npx wrangler login`, then verify with `npx wrangler whoami`.
- [ ] **Step 2: Create staging D1** using `npx wrangler d1 create odoo-connect-staging` and write the returned database ID into `env.staging.d1_databases[0].database_id`.
- [ ] **Step 3: Generate independent 32-byte random values locally** and enter them interactively with `npx wrangler secret put CREDENTIAL_KEY_V1 --env staging`, `npx wrangler secret put TOKEN_HASH_PEPPER --env staging`, and `npx wrangler secret put AUDIT_HASH_KEY --env staging`; do not print or persist values.
- [ ] **Step 4: Set the operator-approved staging HTTPS origin** as `env.staging.vars.PUBLIC_ORIGIN` and configure its Worker route or custom domain in Cloudflare.
- [ ] **Step 5: Generate types and validate config** with `npm run cf:typegen`, `npx wrangler deploy --dry-run --env staging`, and `npm run check:secrets`.
- [ ] **Step 6: Commit only non-secret configuration** with `git add wrangler.jsonc worker-configuration.d.ts docs && git commit -m "chore: configure Cloudflare staging"`.

### Task 5: Deploy and prove staging with a reviewer-grade Odoo tenant

**Files:**

- Modify: `docs/staging-test-cases.md`, `docs/submission-checklist.md`
- Create: `docs/release/staging-evidence.md`

**Interfaces:**

- Consumes an Odoo SaaS demo tenant under `*.odoo.com`, an MCP-scoped API key, and reviewer credentials that do not require signup or inaccessible 2FA.
- Produces redacted evidence for OAuth, every tool, safe failures, idempotency, privacy, disconnect, and supported ChatGPT/Codex surfaces.

- [ ] **Step 1: Apply migrations** with `npx wrangler d1 migrations apply odoo-connect-staging --remote --env staging`.
- [ ] **Step 2: Deploy staging** with `npx wrangler deploy --env staging` after explicit operator approval.
- [ ] **Step 3: Verify public endpoints** for `/healthz`, OAuth discovery, protected-resource metadata, unauthenticated `/mcp`, and the OpenAI challenge route.
- [ ] **Step 4: Execute all eight staging cases** from `docs/staging-test-cases.md` using the demo tenant and record pass/fail without credentials or business payloads.
- [ ] **Step 5: Connect both ChatGPT and Codex** to the staging MCP URL and repeat the five positive and three negative reviewer cases.
- [ ] **Step 6: Inspect Cloudflare logs and D1** for credential, assertion, token, header, Odoo payload, or undisclosed personal-data leakage; any match blocks release.
- [ ] **Step 7: Commit redacted evidence** with `git add docs/release/staging-evidence.md docs/submission-checklist.md && git commit -m "test: record staging acceptance evidence"`.

### Task 6: Provision and verify production

**Files:**

- Modify: `wrangler.jsonc`, `plugins/odoo-connect/.codex-plugin/plugin.json`, `plugins/odoo-connect/.mcp.json`, `docs/deployment.md`, `docs/submission-checklist.md`
- Generated but untracked: production Cloudflare resources, secrets, and deployment state.

**Interfaces:**

- Produces a stable universal production MCP URL, isolated production D1/secrets, rendered public plugin metadata, and rollback evidence.

- [ ] **Step 1: Create `odoo-connect-production` D1** and add its returned ID only to `env.production.d1_databases[0].database_id`.
- [ ] **Step 2: Configure fresh production secrets** using the three interactive `wrangler secret put ... --env production` commands; never reuse staging values.
- [ ] **Step 3: Configure the operator-approved production HTTPS origin** as `env.production.vars.PUBLIC_ORIGIN` and its Cloudflare custom domain.
- [ ] **Step 4: Render the plugin** with `node scripts/render-public-plugin.mjs "$PUBLIC_ORIGIN"`, then run the plugin validator and verify `.mcp.json` ends in `/mcp` on the exact production origin.
- [ ] **Step 5: Run the complete release gate**: `npm ci`, `npm run cf:typegen`, `npm run check`, `npm run test:integration`, `npm audit --audit-level=high`, plugin validation, secret scan, and `npx wrangler deploy --dry-run --env production`.
- [ ] **Step 6: Deploy production only after explicit operator approval**, apply migrations first, run production smoke tests, and record the Worker version used for rollback.
- [ ] **Step 7: Commit public configuration and evidence** with `git add wrangler.jsonc worker-configuration.d.ts plugins docs && git commit -m "release: prepare production plugin endpoint"`.

### Task 7: Create and validate the OpenAI submission draft

**Files:**

- Modify: `docs/submission-checklist.md`
- Create: `docs/release/openai-submission.md`

**Interfaces:**

- Consumes a verified OpenAI developer/business identity, `api.apps.write`, Odoo authorization, production MCP URL, reviewer credentials, tool scan, listing, test cases, and policy attestations.
- Produces a saved OpenAI submission draft; it does not submit for review.

- [ ] **Step 1: Verify the publishing identity** in the OpenAI Platform and confirm the selected organization grants `api.apps.write` and `api.apps.read`.
- [ ] **Step 2: Create a `With MCP` draft** in the plugin submission portal using `Universal` and the production `/mcp` URL.
- [ ] **Step 3: Complete domain verification** by placing the portal-issued token in Cloudflare configuration, deploying the exact challenge response, and asking the portal to verify again.
- [ ] **Step 4: Configure OAuth and reviewer credentials**, ensuring the demo account is fully featured and does not require signup or inaccessible 2FA.
- [ ] **Step 5: Run `Scan Tools`** and compare names, descriptions, schemas, security schemes, instructions, and annotations with `docs/release/tool-annotations.md`.
- [ ] **Step 6: Fill listing, skills, prompts, five positive cases, three negative cases, availability, release notes, and policy attestations from the versioned release documents.**
- [ ] **Step 7: Save but do not submit**, then record draft ID, organization, scan date, production Worker version, and unresolved warnings in `docs/release/openai-submission.md` without secrets.
- [ ] **Step 8: Commit** with `git add docs/release/openai-submission.md docs/submission-checklist.md && git commit -m "docs: record OpenAI submission draft"`.

### Task 8: Submit, respond to review, and publish

**Files:**

- Modify: `docs/release/openai-submission.md`, `docs/submission-checklist.md`

**Interfaces:**

- Produces an explicitly authorized review submission, a traceable response to reviewer findings, and—only after approval—a separately authorized public release.

- [ ] **Step 1: Present the completed draft evidence** to the operator, including Odoo authorization status, production URL, test evidence, tool scan, privacy audit, reviewer credentials readiness, and all portal warnings.
- [ ] **Step 2: Submit for review only after explicit operator approval** in the OpenAI portal.
- [ ] **Step 3: Record submission time and status** without credentials; while under review, avoid changing production tool contracts except for security fixes.
- [ ] **Step 4: For each reviewer issue**, reproduce it, add a failing test, implement the smallest fix, rerun the full release gate, deploy, rescan tools, and document the response before resubmitting.
- [ ] **Step 5: After approval, request separate operator approval to publish**; publication is not implied by approval.
- [ ] **Step 6: Publish from the portal**, verify the listing in both ChatGPT and Codex, install from a clean account, execute one read and one preview-only workflow, and verify policy links.
- [ ] **Step 7: Record the public listing URL, published version, verification date, and rollback version**, then commit with `git add docs && git commit -m "docs: record public plugin release"`.

## Execution boundary

Local code and documentation work may proceed after plan approval. Stop and obtain explicit operator participation or approval before:

1. Authenticating Wrangler in the operator's Cloudflare account.
2. Creating Cloudflare D1 resources, setting secrets, configuring domains, or deploying staging.
3. Using a real Odoo tenant or reviewer credentials.
4. Deploying production.
5. Creating the OpenAI portal draft under the operator's organization.
6. Submitting for review.
7. Publishing after approval.

Public submission remains blocked until written Odoo authorization covers the integration and directory distribution, and OpenAI explicitly accepts the API-key connection architecture. Current OpenAI plugin guidelines reject unauthorized third-party connectors and prohibit collecting authentication secrets.
