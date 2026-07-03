import {
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

const FORMAT = 'bhs_pin_scrypt_v1'
const KEY_LENGTH = 32
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const

// The scrypt pepper derives from BETTER_AUTH_SECRET so every process sharing a
// database (web, worker, migrate) peppers PINs identically. Resolved lazily —
// not at module load — so importing @beaconhs/db never requires the secret;
// only actually hashing/verifying a PIN does. In production a missing secret is
// fatal: silently falling back to the public dev pepper would both weaken the
// hash and make PINs written by one process unverifiable by another.
let pepperKey: Buffer | null = null
function getPepperKey(): Buffer {
  if (pepperKey) return pepperKey
  const source = process.env.BETTER_AUTH_SECRET
  if (!source) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'BETTER_AUTH_SECRET must be set in production — kiosk PIN hashing derives its pepper from it and does not fall back to the insecure dev default.',
      )
    }
    console.warn(
      '[kiosk-pin] BETTER_AUTH_SECRET is not set; using the insecure dev pepper (development only).',
    )
  }
  pepperKey = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(source || 'beaconhs-dev-insecure-secret'),
      Buffer.alloc(0),
      Buffer.from('beaconhs.kiosk-pin-pepper.v1'),
      32,
    ),
  )
  return pepperKey
}

export function normalizeKioskPin(value: string | null | undefined): string | null {
  const pin = value?.trim() ?? ''
  if (!/^\d{4,12}$/.test(pin)) return null
  return pin
}

export function isKioskPinHash(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(`${FORMAT}$`))
}

function pepper(pin: string): string {
  return createHmac('sha256', getPepperKey()).update(pin, 'utf8').digest('base64url')
}

function scrypt(password: string, salt: string, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(Buffer.from(derivedKey))
    })
  })
}

export async function hashKioskPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url')
  const key = await scrypt(pepper(pin), salt, KEY_LENGTH, SCRYPT_OPTIONS)
  return [
    FORMAT,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt,
    key.toString('base64url'),
  ].join('$')
}

export async function verifyKioskPin(
  storedHash: string | null | undefined,
  candidatePin: string,
): Promise<boolean> {
  if (!storedHash || !isKioskPinHash(storedHash)) return false

  const [format, nRaw, rRaw, pRaw, salt, hashRaw] = storedHash.split('$')
  if (format !== FORMAT || !nRaw || !rRaw || !pRaw || !salt || !hashRaw) return false

  const n = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const expected = Buffer.from(hashRaw, 'base64url')
  const actual = await scrypt(pepper(candidatePin), salt, expected.length, {
    N: n,
    r,
    p,
  })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
