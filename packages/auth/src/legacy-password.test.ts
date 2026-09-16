import { describe, expect, it } from 'vitest'
import { hash as bcryptHash } from 'bcryptjs'
import { hashPassword as hashScrypt } from 'better-auth/crypto'
import { isBcryptHash, verifyLegacyOrCurrentPassword } from './legacy-password'

// The legacy BeaconHS stored bcrypt hashes. If these break, 229 migrated users
// silently cannot sign in while the app reports nothing worse than "invalid
// credentials", so the dispatch is worth pinning down precisely.

describe('isBcryptHash', () => {
  it('recognises every bcrypt version tag, including PHP $2y$', () => {
    for (const tag of ['$2a$', '$2b$', '$2x$', '$2y$']) {
      expect(isBcryptHash(`${tag}10$abcdefghijklmnopqrstuv`)).toBe(true)
    }
  })

  it('does not mistake a Better-Auth scrypt hash for bcrypt', async () => {
    // Better-Auth's scrypt output carries no `$` prefix, which is what makes the
    // discriminator safe rather than a guess.
    const scrypt = await hashScrypt('correct horse battery staple')
    expect(scrypt.startsWith('$2')).toBe(false)
    expect(isBcryptHash(scrypt)).toBe(false)
  })

  it('rejects empty and malformed values', () => {
    for (const value of ['', '$2', '$3a$10$x', 'plain', '2y$10$x']) {
      expect(isBcryptHash(value)).toBe(false)
    }
  })
})

describe('verifyLegacyOrCurrentPassword', () => {
  it('accepts the right password against a legacy bcrypt hash', async () => {
    const hash = await bcryptHash('jobsite-2019', 10)
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'jobsite-2019' })).toBe(true)
  })

  it('rejects the wrong password against a legacy bcrypt hash', async () => {
    const hash = await bcryptHash('jobsite-2019', 10)
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'jobsite-2020' })).toBe(false)
  })

  it('verifies a PHP-style $2y$ hash', async () => {
    // Laravel writes $2y$; bcryptjs writes $2b$. Same algorithm, different tag —
    // rewriting the tag must not change the verification result.
    const hash = (await bcryptHash('laravel-password', 10)).replace(/^\$2[ab]\$/, '$2y$')
    expect(hash.startsWith('$2y$')).toBe(true)
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'laravel-password' })).toBe(true)
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'nope' })).toBe(false)
  })

  it('still verifies current scrypt hashes', async () => {
    const hash = await hashScrypt('new-password-123')
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'new-password-123' })).toBe(true)
    expect(await verifyLegacyOrCurrentPassword({ hash, password: 'wrong' })).toBe(false)
  })

  it('treats a corrupt bcrypt hash as a failed sign-in, not a crash', async () => {
    // A truncated hash must not surface as a 500 — that would tell an attacker
    // which accounts carry legacy credentials.
    await expect(
      verifyLegacyOrCurrentPassword({ hash: '$2y$10$too-short', password: 'anything' }),
    ).resolves.toBe(false)
  })
})
