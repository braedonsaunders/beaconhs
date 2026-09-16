import { compare } from 'bcryptjs'
import { verifyPassword as verifyScrypt } from 'better-auth/crypto'

// The legacy BeaconHS (Laravel) stored bcrypt password hashes. Those hashes are
// imported verbatim into `account.password` so people keep the password they
// already know instead of every user needing a reset link on cutover day.
//
// Better-Auth hashes new passwords with scrypt, so the two formats coexist in
// the same column and have to be told apart. Bcrypt hashes are self-describing:
// they always start with a `$2<x>$` version tag. Better-Auth's scrypt output has
// no `$` prefix at all, so the prefix is an unambiguous discriminator rather
// than a heuristic.
//
// PHP writes `$2y$`; other implementations write `$2a$`/`$2b$`. bcryptjs accepts
// all three and they are the same algorithm — the tag only ever recorded which
// implementation produced the hash.
const BCRYPT_PREFIX = /^\$2[axyb]\$/

export function isBcryptHash(hash: string): boolean {
  return BCRYPT_PREFIX.test(hash)
}

/**
 * Verify a password against either a legacy bcrypt hash or a Better-Auth scrypt
 * hash, dispatching on the stored hash's own format.
 *
 * Deliberately no rehash-on-login: it would need a database handle that
 * Better-Auth does not pass to `verify`, and bcrypt remains a sound password
 * hash. Accounts move to scrypt naturally whenever someone changes or resets
 * their password.
 */
export async function verifyLegacyOrCurrentPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (isBcryptHash(hash)) {
    try {
      return await compare(password, hash)
    } catch {
      // A malformed stored hash is a failed sign-in, never a 500 that would
      // leak which accounts carry legacy credentials.
      return false
    }
  }
  return verifyScrypt({ hash, password })
}
