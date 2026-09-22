# Odoo Connect for ChatGPT & Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, repository-distributed `odoo-connect` plugin whose Cloudflare Worker exposes a stable OAuth-protected MCP facade over each user's native Odoo SaaS 19.4 MCP endpoint.

**Architecture:** One stateless Worker owns OAuth 2.1, connection pages, policy, MCP tools, and an upstream Odoo MCP client. D1 stores hashed grants/tokens, encrypted connection secrets, single-use confirmations, idempotency records, and content-free audit events; Web Crypto and Cloudflare Secrets protect credentials. A fixed MCP SDK v2 server factory serves Web Standard Streamable HTTP at `/mcp`; no Odoo records are durably stored.

**Tech Stack:** TypeScript, Node.js 22+, Cloudflare Workers, Wrangler 4+, D1, Vitest Workers pool, MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/client`), `agents` `createMcpHandler`, Zod, `jose`, HTML forms, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-21-odoo-connect-plugin-design.md`

**OAuth implementation decision:** Implement the authorization server in this repository over D1. Do not use `@cloudflare/workers-oauth-provider`: its current CIMD path does not validate `private_key_jwt`, and its token store uses KV. Keep OAuth protocol code behind the typed interfaces in Tasks 4 and 5 so a conforming library can replace it later.

## Global Constraints

- Plugin identifier `odoo-connect`; public repository name `odoo-connect-plugin`; Apache-2.0 license.
- Use Odoo SaaS 19.4 native MCP at `https://<tenant>.odoo.com/mcp`; never rebuild the Odoo API.
- Accept only canonical `https://*.odoo.com` root origins in v1; reject userinfo, fragments, unexpected ports, custom domains, unsafe DNS answers, and unsafe redirects.
- One active Odoo connection per plugin user; API key must have `mcp` scope and must never reach model context, OAuth tokens, logs, or source control.
- Use OAuth 2.1 authorization code flow, PKCE S256, RFC 9207 `iss`, RFC 9728 protected-resource metadata, CIMD, and `private_key_jwt`; expose no dynamic client registration.
- OAuth access and refresh tokens are opaque, revocable, resource-bound, and stored only as SHA-256 hashes.
- Encrypt Odoo keys with AES-256-GCM, unique 96-bit nonce, and AAD containing connection ID plus key version; Cloudflare Secrets hold key material.
- Reads are bounded. Writes require matching unexpired single-use preview intent plus explicit confirmation and idempotency protection.
- No deletion, arbitrary methods/actions, invoice posting, or sales-order confirmation in v1.
- D1 stores no Odoo record payloads beyond short-lived normalized proposed changes inside confirmation intents.
- Use `wrangler.jsonc`, `compatibility_date: "2026-09-21"`, Wrangler 4+, generated Worker types, prepared D1 statements, and separate staging/production databases and secrets.
- Use MCP SDK v2 server factory with `createMcpHandler`; do not use deprecated `McpAgent`, SSE, or SDK v1 imports.
- Keep production deployment, GitHub remote creation, domain verification, and OpenAI submission outside this plan's automatic actions; obtain explicit authorization first.

## Review Focus

- Unicode, trailing-dot, mixed-case, percent-encoded, redirecting, rebinding, private IPv4, and IPv6 tenant hosts must all fail closed; Task 3 tests each class.
- Concurrent refresh, confirmation, disconnect, and duplicate-delivery requests must produce one winner and stable replay errors; Tasks 5, 9, and 10 test atomic D1 transitions.
- CIMD/JWKS documents with redirect tricks, oversized bodies, unsupported algorithms, wrong audience, rotated keys, or repeated `jti` must fail without leaking diagnostics; Task 4 tests them.
- Upstream Odoo timeout, malformed JSON-RPC, permission failure, missing capability, 401, and 429 responses must map to stable safe errors; Tasks 6 and 7 test every category.
- Logs and MCP results must remain free of API keys, authorization headers, assertion bodies, and Odoo record payloads on success and failure; Tasks 2, 7, and 11 test redaction.

---

### Task 1: Reproducible Worker and plugin scaffold

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`, `.dev.vars.example`, `LICENSE`, `src/index.ts`, `test/smoke.test.ts`
- Create via plugin-creator: `plugins/odoo-connect/.codex-plugin/plugin.json`, `plugins/odoo-connect/skills/odoo-connect/SKILL.md`, `plugins/odoo-connect/assets/`
- Create: `plugins/odoo-connect/.mcp.local.json`
- Generate: `worker-configuration.d.ts`

**Interfaces:**
- Produces `Env` from `wrangler types`, D1 binding `DB`, secrets `CREDENTIAL_KEY_V1`, `TOKEN_HASH_PEPPER`, `AUDIT_HASH_KEY`, variables `PUBLIC_ORIGIN`, `ENVIRONMENT`, `ODOO_TIMEOUT_MS`.
- Produces default Worker export `ExportedHandler<Env>`. Local-only `.mcp.local.json` points to `http://127.0.0.1:8787/mcp` and is not referenced by the public manifest. Task 12 creates public `.mcp.json` only after `PUBLIC_ORIGIN` contains the authorized HTTPS staging origin.

- [ ] **Step 1: Write failing smoke test** asserting `GET /healthz` returns `{status:"ok",environment:"test"}` and asserting plugin manifest name, Apache license, three starter prompts maximum, local asset existence, no public `mcpServers` field, and local MCP URL `http://127.0.0.1:8787/mcp`.
- [ ] **Step 2: Run failure** with `npm test -- test/smoke.test.ts`; expect missing modules/files.
- [ ] **Step 3: Scaffold** using plugin-creator with `python3 scripts/create_basic_plugin.py odoo-connect --path "$PWD/plugins" --with-skills --with-assets`, then replace scaffold values with approved metadata and add `.mcp.local.json`. Initialize npm, install runtime packages `agents @modelcontextprotocol/server@^2 @modelcontextprotocol/client@^2 zod jose`, and dev packages `wrangler@^4 typescript vitest @cloudflare/vitest-pool-workers eslint typescript-eslint prettier`. Scripts: `test`, `test:unit`, `typecheck`, `lint`, `format:check`, `cf:typegen`, `check`, `dev`.
- [ ] **Step 4: Configure Worker** with module entrypoint, D1 migration directory, required secrets, `compatibility_date`, `global_fetch_strictly_public`, observability, and independent `env.staging`/`env.production` bindings. Generate types using `npx wrangler types` rather than hand-writing `Env`.
- [ ] **Step 5: Implement minimal health route**, run `npm run cf:typegen && npm run check && python3 /home/jadrk040507/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/odoo-connect`; expect all pass.
- [ ] **Step 6: Commit** with `git add . && git commit -m "chore: scaffold Odoo Connect worker and plugin"`.

### Task 2: D1 schema, typed repositories, and safe telemetry

**Files:**
- Create: `migrations/0001_initial.sql`, `src/storage/schema.ts`, `src/storage/repositories.ts`, `src/observability/audit.ts`, `src/observability/redact.ts`, `test/storage.test.ts`, `test/redaction.test.ts`

**Interfaces:**
- Produces `ConnectionRepository`, `OAuthRepository`, `IntentRepository`, `IdempotencyRepository`, `AuditRepository`, each accepting `D1Database` and using `.prepare(...).bind(...)` only.
- Produces `audit(env, event: AuditEvent): Promise<void>` where `AuditEvent` contains request ID, pseudonymous tenant ID, tool, duration, status class, error category, timestamp; no arbitrary payload field.
- Tables: `users`, `connections`, `oauth_grants`, `oauth_codes`, `oauth_tokens`, `client_assertion_jti`, `confirmation_intents`, `idempotency_results`, `audit_events`, all `STRICT`, with foreign keys and expiry indexes.

- [ ] **Step 1: Write failing tests** for migration application, one active connection per user, hashed-token lookup, atomic consume operations, expiry cleanup, tenant pseudonymization, and recursive redaction of `authorization`, `api_key`, `client_assertion`, `record`, and `payload` fields.
- [ ] **Step 2: Run failure** with `npm test -- test/storage.test.ts test/redaction.test.ts`; expect missing schema/repositories.
- [ ] **Step 3: Add migration and repositories**. Store ciphertext/nonce/key version, never plaintext. Use conditional `UPDATE ... WHERE consumed_at IS NULL AND expires_at > ? RETURNING ...` for one-winner consumption.
- [ ] **Step 4: Add closed audit type and redactor**. Hash tenant hosts with HMAC-SHA-256 `AUDIT_HASH_KEY`; log JSON metadata only.
- [ ] **Step 5: Verify** with `npx wrangler d1 migrations apply odoo-connect-test --local && npm test -- test/storage.test.ts test/redaction.test.ts && npm run typecheck`.
- [ ] **Step 6: Commit** with `git add migrations src/storage src/observability test && git commit -m "feat: add secure D1 persistence and audit model"`.

### Task 3: Tenant URL and outbound-request security boundary

**Files:**
- Create: `src/security/ip.ts`, `src/security/tenant-url.ts`, `src/security/safe-fetch.ts`, `test/tenant-url.test.ts`, `test/safe-fetch.test.ts`

**Interfaces:**
- Produces `DnsResolver.resolve(hostname: string): Promise<{addresses:string[]; ttl:number}>`.
- Produces `validateTenantOrigin(input: string, resolver: DnsResolver): Promise<{origin:string; host:string}>`.
- Produces `safeTenantFetch(origin, path, init, deps): Promise<Response>` with no automatic redirects, per-attempt DNS validation, allowed-origin enforcement, 10 s default timeout, and 1 MiB bounded response reader.

- [ ] **Step 1: Write failing table tests** for valid subdomains and all Review Focus host classes, including `odoo.com` apex, `evilodoo.com`, `tenant.odoo.com.`, encoded separators, IDN, credentials, ports, paths, query, fragments, IPv4/IPv6 literals, private/reserved answers, empty DNS, mixed safe/unsafe DNS, changed second lookup, and cross-origin redirect.
- [ ] **Step 2: Run failure** with `npm test -- test/tenant-url.test.ts test/safe-fetch.test.ts`.
- [ ] **Step 3: Implement canonical parser and IP classifiers** using `URL`, ASCII hostname comparison, strict `host.endsWith(".odoo.com")`, and complete IPv4/IPv6 forbidden-range tables.
- [ ] **Step 4: Implement resolver and fetch** through Cloudflare DNS-over-HTTPS JSON for A and AAAA, validate every returned address, send redirects manually for at most three same-origin hops, and abort/limit response reads.
- [ ] **Step 5: Verify** focused tests, `npm run lint`, and mutation checks that changing `.odoo.com` suffix or private-range predicate makes tests fail.
- [ ] **Step 6: Commit** with `git add src/security test && git commit -m "feat: enforce Odoo tenant SSRF boundary"`.

### Task 4: Credential encryption and CIMD `private_key_jwt`

**Files:**
- Create: `src/security/crypto.ts`, `src/oauth/cimd.ts`, `src/oauth/client-assertion.ts`, `test/crypto.test.ts`, `test/cimd.test.ts`, `test/client-assertion.test.ts`

**Interfaces:**
- Produces `encryptCredential(connectionId, plaintext, keys): Promise<EncryptedSecret>` and `decryptCredential(connectionId, value, keys): Promise<string>`; `EncryptedSecret={ciphertext,nonce,keyVersion}` uses base64url.
- Produces `resolveCimd(clientId, fetcher): Promise<CimdClient>` with exact redirect URIs, `jwks`/`jwks_uri`, supported `private_key_jwt`, 5 KiB limit, 10 s timeout, no secrets/private JWKs.
- Produces `verifyClientAssertion(form, client, issuer, repository, now): Promise<void>` validating `iss=sub=client_id`, exact token endpoint `aud`, approved asymmetric algorithm, signature, max five-minute lifetime, `exp`/`iat`/`nbf`, unique `jti`, and atomic replay insertion.

- [ ] **Step 1: Write failing crypto tests** for random nonce, wrong connection AAD, tampering, unknown key version, previous-key decrypt, and current-key encrypt.
- [ ] **Step 2: Write failing CIMD/assertion tests** covering Review Focus cases, local/private JWKS URLs, JSON `jwks`, key rotation, unknown `kid`, symmetric/private keys, wrong claims, expiry, clock skew, and repeated `jti`.
- [ ] **Step 3: Run failure** with `npm test -- test/crypto.test.ts test/cimd.test.ts test/client-assertion.test.ts`.
- [ ] **Step 4: Implement AES-GCM through Web Crypto and CIMD/JWKS fetch through a generic public-HTTPS safe fetcher**. Use `jose` only for JOSE parsing and signature verification; store only assertion hash, client ID, `jti`, and expiry.
- [ ] **Step 5: Verify** focused tests plus `npm run typecheck`; inspect failure messages to ensure no assertion/JWK body appears.
- [ ] **Step 6: Commit** with `git add src/security/crypto.ts src/oauth test && git commit -m "feat: secure credentials and OAuth client assertions"`.

### Task 5: OAuth 2.1 authorization server

**Files:**
- Create: `src/oauth/metadata.ts`, `src/oauth/authorize.ts`, `src/oauth/token.ts`, `src/oauth/revoke.ts`, `src/oauth/bearer.ts`, `src/oauth/router.ts`, `src/http/forms.ts`, `test/oauth.test.ts`

**Interfaces:**
- Routes: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/revoke`.
- Produces `authenticateBearer(request, env): Promise<AuthContext>` where `AuthContext={userId,connectionId,grantId,scopes,tokenId}`.
- Authorization code lifetime 5 minutes; access token 1 hour; refresh token 30 days; S256 only; tokens generated with 32 random bytes, returned once, stored as `SHA-256(token || pepper)`.

- [ ] **Step 1: Write failing protocol tests** for exact metadata, `401` challenge, state preservation, RFC 9207 `iss`, required resource audience, PKCE S256 success/failure, code replay, `private_key_jwt`, refresh rotation/replay family revocation, access expiry, revocation idempotency, and absent DCR endpoint.
- [ ] **Step 2: Run failure** with `npm test -- test/oauth.test.ts`.
- [ ] **Step 3: Implement discovery and authorize parsing**. Bind signed, HttpOnly, Secure, SameSite=Lax authorization session cookies to state, client, redirect URI, resource, challenge, and expiry.
- [ ] **Step 4: Implement token and revocation endpoints** with D1 transactions/conditional writes. Return RFC OAuth errors without internal detail.
- [ ] **Step 5: Implement bearer authentication** and resource-bound challenges for `/mcp`; reject tokens for deleted/inactive connections.
- [ ] **Step 6: Verify** `npm test -- test/oauth.test.ts && npm run check`.
- [ ] **Step 7: Commit** with `git add src/oauth src/http test/oauth.test.ts && git commit -m "feat: implement OAuth 2.1 authorization server"`.

### Task 6: Native Odoo MCP client and connection lifecycle

**Files:**
- Create: `src/odoo/types.ts`, `src/odoo/client.ts`, `src/odoo/capabilities.ts`, `src/connection/service.ts`, `src/connection/routes.ts`, `test/fixtures/odoo/*.json`, `test/odoo-client.test.ts`, `test/connection.test.ts`

**Interfaces:**
- `OdooClient.initialize(): Promise<OdooProfile>`, `listTools(): Promise<UpstreamTool[]>`, `callTool(name,args): Promise<unknown>`, `close(): Promise<void>` over SDK v2 Web Standard Streamable HTTP at `${origin}/mcp` with bearer key.
- `ConnectionService.verifyAndSave(userId, origin, apiKey): Promise<ConnectionProfile>` verifies initialization, identity, company context, required tools, and scope behavior before encryption.
- Routes: `GET/POST /connect`, `GET/POST /connection/replace`, `GET /connection/status`, `POST /connection/delete` with CSRF tokens and no-store responses.

- [ ] **Step 1: Write failing contract tests** with synthetic JSON-RPC fixtures for initialize/list/call, 401, 403, 429, timeout, malformed response, absent tool, bounded body, and bearer-header non-disclosure.
- [ ] **Step 2: Write failing connection tests** for first connection, invalid key, missing MCP capability, replacement after successful verification only, one-connection invariant, CSRF, and deletion material removal.
- [ ] **Step 3: Run failure** with `npm test -- test/odoo-client.test.ts test/connection.test.ts`.
- [ ] **Step 4: Implement SDK v2 client adapter** with injected transport/fetch for tests, fixed timeout, no retries on writes, bounded retry with jitter on safe reads, and `finally` closure.
- [ ] **Step 5: Implement connection pages and service**. Forms accept secret only in POST body, set `Cache-Control: no-store`, never repopulate key, and complete OAuth only after verification.
- [ ] **Step 6: Verify** focused tests and scan output/source using `rg -n "console\.(log|error).*?(api|authorization|record|payload)|apiKey.*JSON\.stringify" src test`; expect no matches.
- [ ] **Step 7: Commit** with `git add src/odoo src/connection test && git commit -m "feat: connect and verify native Odoo MCP tenants"`.

### Task 7: Stable errors, request policy, and MCP server shell

**Files:**
- Create: `src/errors.ts`, `src/policy/rate-limit.ts`, `src/mcp/context.ts`, `src/mcp/server.ts`, `src/mcp/result.ts`, `test/errors.test.ts`, `test/mcp-contract.test.ts`

**Interfaces:**
- `GatewayErrorCode` exactly matches 11 spec categories; `toMcpError(error,requestId)` returns safe action plus correlation ID.
- `createServer(context: McpRequestContext): McpServer`; context contains authenticated IDs and services, never plaintext Odoo key.
- `createMcpHandler` serves stateless Streamable HTTP `/mcp`; all tools carry accurate read-only/destructive/idempotent/open-world annotations.

- [ ] **Step 1: Write failing error matrix tests** mapping every internal/upstream condition and proving raw bodies, headers, stacks, keys, and record payloads are absent.
- [ ] **Step 2: Write failing MCP contract tests** for initialize, tools/list, JSON schemas, annotations, structured results, unauthorized challenge, unsupported HTTP methods, CORS allowlist, and request IDs.
- [ ] **Step 3: Run failure** with `npm test -- test/errors.test.ts test/mcp-contract.test.ts`.
- [ ] **Step 4: Implement error boundary, D1-backed fixed-window rate limiter, auth context factory, per-request server factory, and Worker routing**. Do not retain request state at module scope.
- [ ] **Step 5: Verify** focused tests, typecheck, and lint including no-floating-promises.
- [ ] **Step 6: Commit** with `git add src/errors.ts src/policy src/mcp src/index.ts test && git commit -m "feat: expose authenticated MCP gateway shell"`.

### Task 8: Account, capability, and bounded read tools

**Files:**
- Create: `src/tools/schemas.ts`, `src/tools/account.ts`, `src/tools/read.ts`, `src/tools/field-policy.ts`, `test/account-tools.test.ts`, `test/read-tools.test.ts`

**Interfaces:**
- Registers `get_connection_profile`, `list_capabilities`, `disconnect_odoo`, `search_contacts`, `search_crm_opportunities`, `search_quotations_and_orders`, `search_invoices`, `get_business_record`, `aggregate_business_records`.
- Shared `PageInput={limit?:number,cursor?:string}` clamps limit to 1..50; opaque cursor encodes validated offset and query digest; each domain has an explicit model and field allowlist.
- Read adapter uses only upstream Get Models, Get Fields, Search, Read Group capabilities and returns normalized structured content.

- [ ] **Step 1: Write failing schema/contract tests** for exact inventory, model/field allowlists, default/max limits, cursor-query mismatch, malformed domains, unauthorized fields, capability gaps, permission errors, and current-data fetch per call.
- [ ] **Step 2: Run failure** with `npm test -- test/account-tools.test.ts test/read-tools.test.ts`.
- [ ] **Step 3: Implement account tools and capability cache limited to request lifetime**. Profile excludes credentials and returns tenant host, user, companies, locale, and health only.
- [ ] **Step 4: Implement read tools** with stable mapping, explicit fields, cursor pagination, result truncation metadata, and safe errors.
- [ ] **Step 5: Verify** focused tests plus MCP snapshot review; confirm no arbitrary model/method argument exists.
- [ ] **Step 6: Commit** with `git add src/tools test && git commit -m "feat: add bounded Odoo read tools"`.

### Task 9: Preview and confirmation write pipeline

**Files:**
- Create: `src/writes/types.ts`, `src/writes/normalize.ts`, `src/writes/preview.ts`, `src/writes/confirm.ts`, `src/tools/write.ts`, `test/write-tools.test.ts`, `test/write-concurrency.test.ts`

**Interfaces:**
- Registers preview/confirm pairs for contact change, opportunity change, and quotation creation/update.
- Preview output: `{intentToken,expiresAt,operation,summary,changes,warnings}`; token is random and stored only as hash.
- Stored intent: connection ID, operation, normalized-change JSON, SHA-256 digest, expiry (10 minutes), idempotency key, consumed timestamp. Confirm input: `{intentToken:string,confirmed:true}` only.

- [ ] **Step 1: Write failing tests** for normalization, allowlists, immutable fields, unsupported destructive/status transitions, digest binding, wrong connection/operation, expiry, `confirmed !== true`, token replay, and no API key in intent.
- [ ] **Step 2: Write failing concurrency tests** issuing two confirmations and two duplicate deliveries; expect one upstream write and identical idempotent result without storing Odoo payload durably.
- [ ] **Step 3: Run failure** with `npm test -- test/write-tools.test.ts test/write-concurrency.test.ts`.
- [ ] **Step 4: Implement previews** using current upstream read for before-values, deterministic normalization, safe summary, random intent token, and D1 expiry.
- [ ] **Step 5: Implement confirmation** with atomic intent claim, digest recheck, upstream Create Records/Update Records mapping, and idempotency state machine `pending|succeeded|failed_retryable|failed_terminal`.
- [ ] **Step 6: Verify** focused tests, then inject timeout before/after upstream response and prove no blind write retry.
- [ ] **Step 7: Commit** with `git add src/writes src/tools/write.ts test && git commit -m "feat: require preview confirmation for Odoo writes"`.

### Task 10: Disconnect, revocation, retention, and key rotation operations

**Files:**
- Create: `src/operations/cleanup.ts`, `src/operations/key-rotation.ts`, `test/lifecycle.test.ts`, `docs/runbooks/credential-compromise.md`, `docs/runbooks/key-rotation.md`, `docs/runbooks/odoo-outage.md`, `docs/runbooks/rollback.md`, `docs/runbooks/user-deletion.md`

**Interfaces:**
- `disconnect(userId): Promise<void>` atomically deactivates connection, removes ciphertext, revokes grants/tokens, and invalidates intents.
- `reencryptConnections(batchSize, cursor): Promise<{processed,nextCursor}>` decrypts previous versions and writes current version without exposing plaintext outside function scope.
- Scheduled cleanup removes expired codes, tokens, assertions, intents, idempotency records, and audit rows per documented retention.

- [ ] **Step 1: Write failing lifecycle tests** for disconnect concurrency, later bearer rejection, credential deletion, replace semantics, cleanup boundaries, key rotation resume, and partial-batch failure.
- [ ] **Step 2: Run failure** with `npm test -- test/lifecycle.test.ts`.
- [ ] **Step 3: Implement lifecycle services and scheduled handler** with prepared statements and `ctx.waitUntil()` for bounded post-response audit only.
- [ ] **Step 4: Write exact operator runbooks** with detection, containment, commands, validation, rollback, communications, and evidence; use secret names but no secret values.
- [ ] **Step 5: Verify** lifecycle tests and `npm run check`.
- [ ] **Step 6: Commit** with `git add src/operations test/lifecycle.test.ts docs/runbooks && git commit -m "feat: add secure connection lifecycle operations"`.

### Task 11: Full local integration and security acceptance suite

**Files:**
- Create: `test/mock-odoo-worker.ts`, `test/integration/oauth-mcp.test.ts`, `test/integration/security.test.ts`, `test/integration/disconnect.test.ts`, `scripts/check-no-secrets.mjs`, `scripts/validate-plugin.mjs`
- Modify: `package.json`, `vitest.config.ts`

**Interfaces:**
- Mock tenant supports success, revoked credential, permission denial, timeout, malformed response, rate limit, capability omission, and write-call counter.
- `npm run test:integration` starts isolated Workers/D1 through Vitest Workers pool; no external Odoo dependency.

- [ ] **Step 1: Write failing end-to-end tests** covering acceptance criteria 1–10: OAuth connection, later read, bounded output, safe failures, preview/confirm, duplicate delivery, disconnect, SSRF corpus, and plugin validation.
- [ ] **Step 2: Run failure** with `npm run test:integration`.
- [ ] **Step 3: Complete test harness and narrow production fixes only**; do not add unapproved tools or UI.
- [ ] **Step 4: Add secret scanner** that inspects tracked files and captured logs for fixtures marked `ODOO_TEST_SECRET`, bearer patterns, `.dev.vars`, PEM private keys, and known authorization headers.
- [ ] **Step 5: Verify full local gate**: `npm ci && npm run cf:typegen && npx wrangler d1 migrations apply odoo-connect-test --local && npm run check && npm run test:integration && npm audit --audit-level=high && git diff --check`.
- [ ] **Step 6: Commit** with `git add package.json package-lock.json vitest.config.ts scripts test && git commit -m "test: cover OAuth and Odoo gateway acceptance flows"`.

### Task 12: Public documentation, policies, CI, and staged-release gate

**Files:**
- Create: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/development.md`, `docs/deployment.md`, `docs/privacy.md`, `docs/terms.md`, `docs/support.md`, `docs/deletion.md`, `docs/submission-checklist.md`, `docs/staging-test-cases.md`, `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml`, `scripts/render-public-plugin.mjs`
- Modify: `plugins/odoo-connect/.codex-plugin/plugin.json`, `plugins/odoo-connect/.mcp.json`, `plugins/odoo-connect/skills/odoo-connect/SKILL.md`

**Interfaces:**
- CI runs format, lint, type generation check, typecheck, unit/contract/integration tests, dependency audit, plugin validation, secret scan, and Wrangler dry run.
- Staging workflow requires configured environment, applies staging migrations before deploy, then runs smoke tests. Production workflow requires protected environment and successful staging artifact; it remains manual and unused until authorized.

- [ ] **Step 1: Write failing documentation/CI tests** in `test/repository.test.ts` asserting every required document, Apache identifiers, support/deletion links, no placeholder markers, workflow gates, and plugin URLs match one configured public origin.
- [ ] **Step 2: Run failure** with `npm test -- test/repository.test.ts`.
- [ ] **Step 3: Write public docs and policies** covering transit-only business data, credential storage, retention, deletion, subprocessors, user rights, limitations, security reporting, local non-production credentials, and operator ownership.
- [ ] **Step 4: Finalize plugin package** with stable tool guidance, three representative starter prompts, accurate write warnings, public policy links, and submission materials list. `scripts/render-public-plugin.mjs` must accept one `https://` origin with no path/query/fragment, write `.mcp.json` with `${origin}/mcp`, add `mcpServers: "./.mcp.json"`, and refuse localhost, `.invalid`, or unset input. Run it only after staging origin authorization, then validate using plugin-creator validator.
- [ ] **Step 5: Add CI and manual deployment workflows**. Use GitHub OIDC/environment secrets where possible; never embed Cloudflare tokens, D1 IDs, Odoo keys, production hostname, or private keys.
- [ ] **Step 6: Run complete release gate**: `npm ci && npm run cf:typegen && npm run check && npm run test:integration && npm audit --audit-level=high && python3 /home/jadrk040507/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/odoo-connect && npx wrangler deploy --dry-run --env staging && git diff --check`.
- [ ] **Step 7: Perform manual spec trace** by recording all 12 acceptance criteria in `docs/submission-checklist.md` with test or document evidence. Criterion 11 remains blocked until authorized staging resources and Odoo sandbox credentials exist; criterion 12 becomes ready, not submitted.
- [ ] **Step 8: Commit** with `git add README.md LICENSE SECURITY.md CONTRIBUTING.md docs .github plugins test/repository.test.ts && git commit -m "docs: prepare public Odoo Connect release"`.

## Execution boundary

Stop after local implementation and verification. Before any remote or billable action, present exact proposed commands and request authorization for:

1. Creating `odoo-connect-plugin` on GitHub and pushing commits.
2. Running `wrangler login`, creating D1 databases, or writing Cloudflare Secrets.
3. Deploying staging, configuring a custom domain, or using real Odoo sandbox credentials.
4. Deploying production, verifying the OpenAI domain, or submitting for public review.

After staging authorization, run documented staging cases for OAuth, reads, preview/confirm, replay, disconnect, safe failures, and log inspection. Do not call implementation complete until local gates pass and acceptance criterion 11 has verified staging evidence.
