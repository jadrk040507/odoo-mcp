# Worker rollback

Identify the last verified Cloudflare Worker version and compare schema compatibility. Roll back code through Cloudflare deployment management; D1 migrations are forward-only and must not be destructively reversed. Validate health, OAuth metadata, bearer rejection, one bounded read, and preview without confirming a production write. Preserve deployment IDs, timestamps, and sanitized error categories as evidence.
