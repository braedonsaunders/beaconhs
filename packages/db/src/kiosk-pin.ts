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
const SOURCE = process.env.BETTER_AUTH_SECRET || 'beaconhs-dev-insecure-secret'
const PEPPER_KEY = Buffer.from(
  hkdfSync(
    'sha256',
    Buffer.from(SOURCE),
    Buffer.alloc(0),
    Buffer.from('beaconhs.kiosk-pin-pepper.v1'),
    32,
  ),
)

export function normalizeKioskPin(value: string | null | undefined): string | null {
  const pin = value?.trim() ?? ''
  if (!/^\d{4,12}$/.test(pin)) return null
  return pin
}

export function isKioskPinHash(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(`${FORMAT}$`))
}

function pepper(pin: string): string {
  return createHmac('sha256', PEPPER_KEY).update(pin, 'utf8').digest('base64url')
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
