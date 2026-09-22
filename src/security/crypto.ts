export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export interface CredentialKeys {
  currentVersion: number;
  versions: Record<number, string>;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function importKey(encoded: string): Promise<CryptoKey> {
  const raw = decodeBase64Url(encoded);
  if (raw.byteLength !== 32) throw new Error("Invalid credential key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function aad(connectionId: string, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(
    `odoo-connect:${connectionId}:v${keyVersion}`,
  );
}

export async function encryptCredential(
  connectionId: string,
  plaintext: string,
  keys: CredentialKeys,
): Promise<EncryptedSecret> {
  const encodedKey = keys.versions[keys.currentVersion];
  if (!encodedKey) throw new Error("Unknown credential key version");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(connectionId, keys.currentVersion),
    },
    await importKey(encodedKey),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: encodeBase64Url(ciphertext),
    nonce: encodeBase64Url(nonce),
    keyVersion: keys.currentVersion,
  };
}

export async function decryptCredential(
  connectionId: string,
  encrypted: EncryptedSecret,
  keys: CredentialKeys,
): Promise<string> {
  const encodedKey = keys.versions[encrypted.keyVersion];
  if (!encodedKey) throw new Error("Unknown credential key version");
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(encrypted.nonce),
        additionalData: aad(connectionId, encrypted.keyVersion),
      },
      await importKey(encodedKey),
      decodeBase64Url(encrypted.ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      plaintext,
    );
  } catch {
    throw new Error("Credential decryption failed");
  }
}
