// Server-only secret sealing (AES-256-GCM). Single shared implementation for
// every tenant credential BeaconHS stores at rest — sync-connection creds,
// email/SMS/AI provider keys, API keys, outbound-integration secrets.
//
// The key is derived from the existing BETTER_AUTH_SECRET via HKDF — no new env
// var, no plaintext secrets in the DB. Because the derivation is fixed, a secret
// sealed by a web admin action unseals in the worker (and vice-versa) as long as
// both share the same BETTER_AUTH_SECRET. This module replaces the four
// byte-identical copies that previously lived in apps/web, sync, sms and emails.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const FALLBACK_SECRET = 'beaconhs-dev-insecure-secret'
const HKDF_INFO = 'beaconhs.secret.v1'

function sourceSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  // Never let a real deployment seal secrets under a publicly-known key: the
  // ciphertext would be trivially decryptable by anyone with the source. Local
  // dev (NODE_ENV !== 'production') keeps the convenience fallback.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[crypto] BETTER_AUTH_SECRET is required in production to seal tenant secrets. ' +
        'Set it to the same value across every service sharing this database.',
    )
  }
  return FALLBACK_SECRET
}

// Derived lazily so importing this module never throws at load time (the guard
// only fires when a secret is actually sealed/unsealed) and so a test can set
// the env before first use.
let cachedKey: Buffer | null = null
function key(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(sourceSecret()), Buffer.alloc(0), Buffer.from(HKDF_INFO), 32),
    )
  }
  return cachedKey
}

export type SealedSecret = { ciphertext: string; nonce: string }

export function sealSecret(plain: string): SealedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  }
}

export function unsealSecret(sealed: SealedSecret): string | null {
  try {
    const raw = Buffer.from(sealed.ciphertext, 'base64')
    const iv = Buffer.from(sealed.nonce, 'base64')
    const tag = raw.subarray(raw.length - 16)
    const enc = raw.subarray(0, raw.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// Historical aliases: web/emails/sms called these encryptSecret/decryptSecret.
// Kept so both naming conventions resolve to the one implementation.
export const encryptSecret = sealSecret
export const decryptSecret = unsealSecret
