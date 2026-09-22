# Credential key rotation

Add the new encryption key as a Cloudflare Secret and retain the prior key during migration. Configure the new version as current, run `reencryptConnections` in batches with the returned cursor, and monitor failures. Validate a sample connection and the count of rows on the new version before removing the old secret. On failure, stop the job; unchanged rows remain decryptable with the old key and completed rows use the new key. Never print plaintext or secret values.
