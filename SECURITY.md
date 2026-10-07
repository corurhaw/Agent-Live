# Security Policy

## Private keys

Do **not** commit private keys, seed phrases, recovery material, Keybase private-directory contents, hardware-token secrets, or decrypted keystore exports.

The identity record may contain:

- public signing keys;
- key fingerprints / KIDs;
- an external keystore provider name;
- an external keystore URI or opaque key handle when publication of that locator is acceptable.

A keystore URI is not proof of control of the corresponding private key. Cryptographic continuity should be marked verified only after a challenge/signature has been validated against the recorded public key.

## Public repositories

Before publishing, review the PDF and configuration examples for private path names, usernames, device names, account identifiers, or other metadata you do not want public.

## State signing

Recommended flow:

1. Use `IdentityRecord.canonical_bytes()` with the declared v1 encoding. It sets `integrity.state_hash`, `integrity.signature`, and `integrity.signed_at` to null before hashing to avoid self-reference.
2. Compute SHA-256 over the canonical UTF-8 JSON representation.
3. Sign the hash (or canonical representation) using the externally protected Ed25519 private key.
4. Store the public key, fingerprint, signature, signing time, and canonicalization/version metadata in the identity record.
5. Verify before accepting migrations, recoveries, or imported autobiographical state as cryptographically continuous.
