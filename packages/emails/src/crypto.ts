// Secret sealing for email-provider credentials (AES-256-GCM).
//
// Byte-compatible with apps/web/src/lib/crypto.ts and packages/sync/src/crypto.ts
// (same algorithm + same key derivation from BETTER_AUTH_SECRET), so a secret
// sealed by the web admin action unseals here in the worker. Lives in the
// package so both sides share one implementation.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const SOURCE = process.env.BETTER_AUTH_SECRET || 'beaconhs-dev-insecure-secret'
const KEY = Buffer.from(
  hkdfSync('sha256', Buffer.from(SOURCE), Buffer.alloc(0), Buffer.from('beaconhs.secret.v1'), 32),
)

export type SealedSecret = { ciphertext: string; nonce: string }

export function encryptSecret(plain: string): SealedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  }
}

export function decryptSecret(sealed: SealedSecret): string | null {
  try {
    const raw = Buffer.from(sealed.ciphertext, 'base64')
    const iv = Buffer.from(sealed.nonce, 'base64')
    const tag = raw.subarray(raw.length - 16)
    const enc = raw.subarray(0, raw.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
