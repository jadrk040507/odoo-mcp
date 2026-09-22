# Deployment

The operator owns the Cloudflare account, verified domain, D1 databases, secrets, OAuth metadata, monitoring, retention, and incident response. Staging and production are separate protected GitHub environments.

Before staging: create its D1 database, set `CREDENTIAL_KEY_V1`, `TOKEN_HASH_PEPPER`, and `AUDIT_HASH_KEY` through Cloudflare Secrets, authorize an HTTPS origin, render the public plugin, apply migrations, run the dry-run gate, then deploy manually. Production requires successful staging evidence, separate secrets/database, domain verification, and a manual protected workflow approval. Commands and validation cases are in `docs/staging-test-cases.md`; rollback is forward-schema compatible and uses the last verified Worker version.
