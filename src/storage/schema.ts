export interface ConnectionRow {
  id: string;
  user_id: string;
  tenant_origin: string;
  tenant_hash: string;
  credential_ciphertext: string | null;
  credential_nonce: string | null;
  key_version: number | null;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface OAuthTokenRow {
  id: string;
  token_hash: string;
  grant_id: string;
  user_id: string;
  connection_id: string;
  scope: string;
  expires_at: number;
}

export interface ConfirmationIntentRow {
  id: string;
  token_hash: string;
  connection_id: string;
  operation: string;
  change_json: string;
  change_digest: string;
  idempotency_key: string;
  expires_at: number;
  consumed_at: number | null;
}

export interface IdempotencyResultRow {
  idempotency_key: string;
  connection_id: string;
  operation: string;
  state: "pending" | "succeeded" | "failed_retryable" | "failed_terminal";
  result_json: string | null;
  created_at: number;
  updated_at: number;
}
