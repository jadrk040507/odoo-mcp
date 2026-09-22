# Submission checklist

1. OAuth metadata and PKCE: covered by `test/oauth.test.ts` and integration tests.
2. CIMD `private_key_jwt`: covered by client assertion tests.
3. Tenant SSRF boundary: covered by tenant URL and safe-fetch tests.
4. Encrypted credentials: covered by crypto tests.
5. Bounded curated reads: covered by read-tool tests.
6. Preview/confirmation writes: covered by write-tool tests.
7. Duplicate delivery: covered by write concurrency tests.
8. Safe stable errors: covered by error and integration tests.
9. Disconnect/revocation: covered by lifecycle and disconnect integration tests.
10. No durable business payloads or secrets: covered by storage tests and secret scan.
11. BLOCKED: authorized staging origin, Cloudflare resources, and Odoo sandbox evidence require operator approval.
12. READY: public review materials, policies, runbooks, CI, and manual deployment gates are present; submission has not occurred.
