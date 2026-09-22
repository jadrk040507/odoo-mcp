import { describe, expect, it } from "vitest";

import {
  decryptCredential,
  encryptCredential,
  type CredentialKeys,
} from "../src/security/crypto.js";

function key(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const keys: CredentialKeys = {
  currentVersion: 2,
  versions: { 1: key(1), 2: key(2) },
};

describe("credential encryption", () => {
  it("uses a random nonce and decrypts with connection-bound AAD", async () => {
    const first = await encryptCredential("connection-1", "odoo-secret", keys);
    const second = await encryptCredential("connection-1", "odoo-secret", keys);
    expect(first.keyVersion).toBe(2);
    expect(first.nonce).not.toBe(second.nonce);
    await expect(decryptCredential("connection-1", first, keys)).resolves.toBe(
      "odoo-secret",
    );
    await expect(
      decryptCredential("connection-2", first, keys),
    ).rejects.toThrow("Credential decryption failed");
  });

  it("detects tampering and unknown key versions without exposing plaintext", async () => {
    const encrypted = await encryptCredential(
      "connection-1",
      "odoo-secret",
      keys,
    );
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
    };
    await expect(
      decryptCredential("connection-1", tampered, keys),
    ).rejects.toThrow("Credential decryption failed");
    await expect(
      decryptCredential("connection-1", { ...encrypted, keyVersion: 99 }, keys),
    ).rejects.toThrow("Unknown credential key version");
  });

  it("decrypts previous versions while encrypting only with the current key", async () => {
    const old = await encryptCredential("connection-1", "old-secret", {
      currentVersion: 1,
      versions: keys.versions,
    });
    await expect(decryptCredential("connection-1", old, keys)).resolves.toBe(
      "old-secret",
    );
    await expect(
      encryptCredential("connection-1", "new-secret", keys),
    ).resolves.toMatchObject({ keyVersion: 2 });
  });
});
