# Odoo Connect for ChatGPT & Codex — Design Specification

## 1. Purpose

Odoo Connect is a public plugin for ChatGPT and Codex that lets each user connect an Odoo SaaS database once and use authorized Odoo capabilities from later conversations without placing an Odoo API key in a prompt.

The plugin provides a universal OpenAI-facing MCP endpoint while delegating Odoo data access and authorization to the native MCP server included with Odoo SaaS. It does not copy business records or reimplement Odoo's ORM API.

## 2. Goals

- Offer a browser-based **Connect with Odoo** flow.
- Keep Odoo credentials out of model context, prompts, manifests, logs, and source control.
- Persist a user's connection across supported ChatGPT and Codex conversations.
- Support different Odoo SaaS tenant domains behind one stable public plugin endpoint.
- Respect the authenticated Odoo user's access rights and enabled MCP tools.
- Provide a stable, reviewable tool surface for common business workflows.
- Require an explicit preview and confirmation before sensitive writes.
- Run on managed, serverless infrastructure with no customer-managed server.
- Publish the source and plugin package through GitHub.

## 3. Non-goals for the First Release

- Supporting self-hosted Odoo, Odoo.sh, or Odoo versions without the native `/mcp` endpoint.
- Storing, indexing, caching, or training on Odoo business records.
- Exposing arbitrary Odoo model methods or unbounded server actions.
- Deleting Odoo records.
- Supporting multiple Odoo connections for one plugin account.
- Providing a custom analytics dashboard or other MCP Apps UI beyond connection management.
- Guaranteeing acceptance into OpenAI's public plugin directory; publication remains subject to OpenAI review.

## 4. User Experience

### 4.1 Installation and connection

1. The user installs Odoo Connect from the ChatGPT/Codex plugin directory.
2. OpenAI starts the plugin's OAuth 2.1 authorization flow.
3. The authorization page asks for:
   - Odoo SaaS base URL, such as `https://example.odoo.com`.
   - An Odoo API key created with the `mcp` scope.
4. The service normalizes and validates the URL, then verifies the credential against the tenant's native `/mcp` endpoint.
5. On success, the service encrypts the connection, creates an opaque local connection identifier, and completes the OAuth grant.
6. OpenAI stores the plugin authorization. Later supported conversations can use the tools without seeing or resubmitting the Odoo key.

### 4.2 Normal use

The plugin retrieves current data from Odoo for every request. Read operations may run directly. A sensitive write first returns a structured preview. The user must explicitly approve that preview before the service executes it.

### 4.3 Reconnection and removal

The user can replace an expired or revoked Odoo key, disconnect the Odoo tenant, or revoke the plugin session. Disconnecting revokes plugin grants and deletes the stored Odoo connection material.

## 5. System Architecture

```text
ChatGPT / Codex
      |
      | MCP over HTTPS + OAuth 2.1
      v
Cloudflare Worker: Odoo Connect Gateway
      |-- OAuth authorization server and connection pages
      |-- Stable MCP tool facade
      |-- Policy, validation, confirmation, and audit layers
      |-- Encrypted credential access
      |
      | MCP over HTTPS + Odoo MCP bearer key
      v
https://<tenant>.odoo.com/mcp
```

### 5.1 Plugin package

The public GitHub repository contains:

- A portable plugin manifest and a compatibility `.codex-plugin/plugin.json` manifest when required by current tooling.
- MCP registration metadata for the universal gateway endpoint.
- Skills that guide safe Odoo workflows and tool selection.
- Starter prompts, review cases, user documentation, support information, privacy policy, and terms.

The initial plugin name is `odoo-connect`. The repository name is `odoo-mcp`.

### 5.2 Cloudflare Worker

The Worker hosts a single public origin and provides:

- Streamable HTTP MCP endpoint at `/mcp`.
- OAuth 2.1 discovery, authorization, token, refresh, and revocation endpoints.
- OAuth authorization-code flow with PKCE S256, RFC 9207 issuer identification, and Client ID Metadata Documents (CIMD). The token endpoint authenticates OpenAI clients with `private_key_jwt` using the JWKS advertised by their validated CIMD document; dynamic client registration is not exposed in the first release.
- Connection setup, replacement, status, and deletion pages.
- A fixed, curated MCP tool facade.
- Upstream MCP client behavior for each authenticated Odoo connection.
- Rate limiting, timeouts, safe retries, structured errors, and audit events.

### 5.3 Cloudflare D1 and secrets

D1 stores only plugin identity, OAuth grants, encrypted Odoo connection configuration, confirmation intents, and minimal audit metadata. It never stores Odoo record payloads as durable business data.

Odoo keys are protected with versioned application-level encryption using AES-256-GCM. The encryption key is supplied through Cloudflare Secrets and is never stored in D1 or GitHub. Each ciphertext includes a unique nonce and authenticated metadata binding it to the connection identifier and key version.

### 5.4 Native Odoo MCP upstream

The gateway connects to `<normalized-base-url>/mcp` with the user's Odoo key as a bearer credential. It relies on Odoo for:

- User identity and company context.
- Record rules, access control lists, and field permissions.
- The authoritative business data.
- Execution of enabled native MCP tools and server actions.

The gateway does not silently broaden upstream permissions. If an upstream tool or model is unavailable, the corresponding operation returns an actionable capability error.

## 6. Public Tool Surface

Public review benefits from a predictable tool inventory, so the plugin does not expose every upstream tool dynamically. It maps a stable set of tools onto the native Odoo MCP capabilities available for the authenticated tenant.

### 6.1 Account and discovery

- `get_connection_profile`: return tenant host, Odoo user, active company, available companies, locale, and connection health; never return credentials.
- `list_capabilities`: report which curated operations are currently supported by the connected tenant.
- `disconnect_odoo`: begin an explicit connection removal flow.

### 6.2 Read tools

- `search_contacts`
- `search_crm_opportunities`
- `search_quotations_and_orders`
- `search_invoices`
- `get_business_record`
- `aggregate_business_records`

Every read tool applies bounded result limits, explicit field selection, pagination, and upstream access controls.

### 6.3 Write tools

- `preview_contact_change` / `confirm_contact_change`
- `preview_opportunity_change` / `confirm_opportunity_change`
- `preview_quotation` / `confirm_quotation`

Confirmation tools accept a short-lived, single-use intent token created by the matching preview. The stored intent includes a digest of the normalized proposed change, connection identifier, operation type, expiry, and idempotency key. It does not contain the Odoo API key.

Posting invoices, confirming sales orders, deleting records, calling arbitrary methods, and executing arbitrary server actions are excluded from the first release. They require separate design and review.

## 7. Security Model

### 7.1 Credential isolation

- Odoo credentials are accepted only on the gateway's HTTPS authorization pages.
- Credentials are never returned through MCP, embedded in OAuth tokens, placed in prompts, or logged.
- OAuth access and refresh tokens are opaque, revocable, scoped to one connection, and stored as non-reversible hashes where server-side lookup is required.
- Production secrets are managed through Cloudflare Secrets and GitHub environment protections.

### 7.2 Tenant URL and SSRF protection

- Only `https` URLs are accepted.
- Userinfo, fragments, unexpected ports, and non-root tenant paths are rejected.
- DNS and resolved addresses are checked against loopback, private, link-local, multicast, reserved, and metadata-service ranges for both IPv4 and IPv6.
- Redirects are disabled or revalidated hop by hop and may not change to a disallowed origin.
- Host normalization uses a single canonical parser and guards against encoded-host and DNS-rebinding tricks.
- The initial public release restricts connections to valid Odoo SaaS tenant hosts under `odoo.com`. Supporting custom domains requires a later security review.

### 7.3 Authorization and safe writes

- Each MCP request validates the plugin OAuth token and resolves exactly one active Odoo connection.
- Upstream Odoo permissions remain authoritative.
- Read/write/destructive/idempotent annotations accurately describe every public tool.
- Sensitive writes require a matching unexpired preview intent and an explicit user confirmation.
- Idempotency records prevent accidental duplicate writes during retries.
- Deletion and arbitrary method execution are unavailable.

### 7.4 Privacy and observability

- Durable logs contain request identifiers, tool names, timing, status classes, tenant identifiers in pseudonymous form, and error categories.
- Prompts, Odoo keys, authorization headers, and Odoo record bodies are excluded from logs.
- Metrics aggregate reliability and latency without recording business content.
- The privacy policy documents credential storage, data transit, retention, deletion, subprocessors, and user rights.

## 8. Error Handling

The gateway converts internal and upstream failures into stable error categories:

- `connection_required`
- `credential_expired_or_revoked`
- `tenant_unreachable`
- `capability_unavailable`
- `permission_denied`
- `validation_failed`
- `confirmation_required`
- `confirmation_expired`
- `rate_limited`
- `upstream_timeout`
- `upstream_failure`

Responses provide a safe user action and correlation identifier without exposing credentials, raw headers, stack traces, or unrestricted upstream bodies. Reads may use bounded retries with jitter for transient failures. Writes retry only when an idempotency mechanism makes repetition safe.

## 9. Deployment and Operations

- Cloudflare Workers hosts the gateway and authorization pages.
- Cloudflare D1 stores service state.
- Cloudflare Secrets stores encryption and deployment secrets.
- A custom production domain supplies the stable MCP and OAuth origins.
- Separate preview/staging and production environments use independent databases and secrets.
- GitHub Actions runs validation and deploys only after protected checks pass.
- Database migrations are versioned and applied before compatible application releases.
- Key rotation supports decrypting with the previous key version while newly written credentials use the current version.
- Operational runbooks cover credential compromise, encryption-key rotation, upstream Odoo outages, rollback, and user data deletion.

The customer does not provision or administer a server. The plugin operator owns the Cloudflare account, domain, deployment, security updates, and support obligations.

## 10. Repository and Licensing

The source repository is public on GitHub under the Apache-2.0 license. It includes:

- Worker source and database migrations.
- Plugin package and skills.
- Automated tests and CI configuration.
- Local development instructions using non-production credentials.
- Threat model and security reporting policy.
- Deployment guide that never commits secrets.
- Privacy policy, terms, support, and OpenAI submission materials.

Secret files, local environment files, Wrangler state, test credentials, and generated deployment artifacts are ignored by Git.

## 11. Testing Strategy

### 11.1 Unit tests

- URL normalization and SSRF rejection, including IPv6 and rebinding cases.
- Encryption, authentication failure, associated-data checks, and key rotation.
- OAuth state, PKCE, token expiry, refresh, revocation, and replay protection.
- Tool input schemas, field allowlists, pagination, confirmation intents, and idempotency.
- Redaction and stable error conversion.

### 11.2 Contract tests

- MCP initialization, discovery, tool schemas, annotations, and structured results.
- Upstream Odoo MCP request/response mappings using recorded synthetic fixtures.
- Capability differences and permission failures without leaking upstream payloads.

### 11.3 Integration tests

- Cloudflare local runtime with an isolated D1 database.
- A mock Odoo MCP tenant covering success, expiry, permission, timeout, malformed-response, and rate-limit paths.
- An opt-in test against a dedicated Odoo SaaS sandbox using short-lived credentials.
- OAuth connection and reconnection from supported OpenAI developer-mode surfaces.

### 11.4 Release checks

GitHub Actions runs formatting, linting, type checking, unit and contract tests, dependency auditing, plugin validation, secret scanning, and a staging smoke test. Production deployment requires the protected workflow and a successful staging result.

## 12. Public Plugin Submission

Before submission, the project must have:

- A stable, publicly reachable HTTPS MCP endpoint.
- OAuth 2.1 metadata and flows accepted by ChatGPT and Codex.
- Verified control of the MCP domain.
- Stable tool schemas, accurate annotations, and representative test cases.
- Public privacy policy, terms, support contact, and deletion instructions.
- Completed personal or business identity verification.
- An OpenAI organization whose owner has Apps write access.
- Screenshots, starter prompts, countries of availability, and policy attestations required by the current submission portal.

OpenAI review is an external gate. The implementation is complete when it passes local and staging acceptance criteria and is ready for submission; public directory availability occurs only after OpenAI approves it.

## 13. Acceptance Criteria

1. A new user can install the plugin, connect one Odoo SaaS tenant with an `mcp`-scoped key, and complete OAuth without placing the key in chat.
2. A later supported conversation can call read tools without asking for the Odoo key again.
3. The gateway never returns or logs the Odoo key.
4. Read tools return current Odoo data and enforce bounded outputs.
5. Unsupported upstream capabilities and Odoo permission failures produce safe, actionable errors.
6. A write cannot execute without a matching, unexpired, single-use preview intent and explicit confirmation.
7. Duplicate delivery of a confirmed write does not create a duplicate business operation.
8. Disconnecting revokes plugin authorization and deletes stored Odoo credential material.
9. The service rejects disallowed tenant URLs and passes the SSRF security test suite.
10. CI validates the plugin package and all required tests before deployment.
11. Staging successfully connects to a dedicated Odoo SaaS sandbox and completes the documented end-to-end cases.
12. The repository contains the policies and submission artifacts required to request OpenAI public review.

## 14. Future Work

- Multiple Odoo tenants or companies per plugin account.
- Approved custom Odoo domains and Odoo.sh support.
- Additional domains such as inventory, purchasing, projects, and help desk.
- Separately reviewed high-impact actions such as order confirmation and invoice posting.
- Optional MCP Apps UI for reviewing complex changes and analytics.
- Enterprise controls for connection policy, audit export, and regional storage.
