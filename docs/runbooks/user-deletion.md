# User deletion

Authenticate the requester, invoke the connection deletion flow, and confirm the connection is inactive with credential columns cleared. Grants and tokens must be revoked and pending intents/idempotency receipts removed. Allow scheduled retention cleanup to remove expired protocol and audit rows. Provide completion confirmation without tenant data. If verification fails, contain access first and escalate using request IDs only.
