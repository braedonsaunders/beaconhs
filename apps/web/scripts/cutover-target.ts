import { createHash } from 'node:crypto'
import type { createClient } from '@beaconhs/db'

const CUTOVER_TARGET = 'beaconhs-dev'
const DEV_DATABASE_POOL_FINGERPRINT =
  'a19382e01cec8fd333d5bda9420580ecb16c2e32741b376550b3bb02172af58f'
const DEV_DATABASE_DIRECT_FINGERPRINT =
  '0ae09059b957e258f3eb6aad10035c1f9648ed5f70005a12536819c019630fb1'
const DEV_STORAGE_FINGERPRINT = '2609e30684eed24d8cec2e40e5c1f823d50db1548b24e7d455411add7c4fe426'
const DEV_ATTACHMENT_CAPABILITY_FINGERPRINT =
  '1c79927db4fd814de06e742ad9e8814f740063fe361daad8ae60a0bc16f63eee'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the dev cutover`)
  return value
}

function databaseFingerprint(value: string): string {
  const url = new URL(value)
  return sha256(
    [
      'beaconhs-cutover-db-v1',
      url.hostname.toLowerCase(),
      url.port || '5432',
      decodeURIComponent(url.pathname),
    ].join('|'),
  )
}

function storageFingerprint(endpointValue: string, bucket: string): string {
  const endpoint = new URL(endpointValue)
  const path = endpoint.pathname.endsWith('/') ? endpoint.pathname.slice(0, -1) : endpoint.pathname
  return sha256(
    ['beaconhs-cutover-storage-v1', endpoint.origin.toLowerCase(), path, bucket].join('|'),
  )
}

/** Bind every one-time script to the audited dev database before it reads or writes. */
export function requireCutoverDatabaseTarget(apply: boolean): string {
  if (process.env.BEACONHS_CUTOVER_TARGET !== CUTOVER_TARGET) {
    throw new Error(`BEACONHS_CUTOVER_TARGET must be exactly ${CUTOVER_TARGET}`)
  }
  if (apply && process.env.BEACONHS_CUTOVER_WRITERS_DRAINED !== 'true') {
    throw new Error('BEACONHS_CUTOVER_WRITERS_DRAINED=true is required for apply mode')
  }

  const url = required('SUPERADMIN_DATABASE_URL')
  const fingerprint = databaseFingerprint(url)
  if (
    fingerprint !== DEV_DATABASE_POOL_FINGERPRINT &&
    fingerprint !== DEV_DATABASE_DIRECT_FINGERPRINT
  ) {
    throw new Error('SUPERADMIN_DATABASE_URL is not the audited BeaconHS dev database')
  }
  if (apply && fingerprint !== DEV_DATABASE_DIRECT_FINGERPRINT) {
    throw new Error('Apply mode requires the direct dev database port, not transaction pooling')
  }
  return url
}

/** Require explicit audited object-store coordinates; never inherit package defaults. */
export function requireCutoverStorageTarget(): {
  endpoint: string
  bucket: string
} {
  const endpoint = required('R2_ENDPOINT')
  const parsed = new URL(endpoint)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('R2_ENDPOINT must be a plain HTTPS origin/path without credentials or queries')
  }
  required('R2_ACCESS_KEY_ID')
  required('R2_SECRET_ACCESS_KEY')
  const bucket = required('R2_BUCKET')
  if (storageFingerprint(endpoint, bucket) !== DEV_STORAGE_FINGERPRINT) {
    throw new Error('R2_ENDPOINT/R2_BUCKET are not the audited BeaconHS dev object store')
  }
  if (
    parsed.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com') &&
    process.env.R2_PRIVATE_BUCKET_CONFIRMED !== 'true'
  ) {
    throw new Error('R2_PRIVATE_BUCKET_CONFIRMED=true is required for Cloudflare R2')
  }
  return { endpoint, bucket }
}

type CutoverSql = ReturnType<typeof createClient>['sql']

/** Prove cross-tenant queries run as the intended non-superuser BYPASSRLS role. */
export async function assertCutoverDatabaseSession(sql: CutoverSql): Promise<void> {
  const [session] = await sql<
    {
      role_name: string
      is_superuser: boolean
      bypass_rls: boolean
      can_login: boolean
      database_name: string
      read_only: boolean
      in_recovery: boolean
    }[]
  >`select current_user as role_name,
           r.rolsuper as is_superuser,
           r.rolbypassrls as bypass_rls,
           r.rolcanlogin as can_login,
           current_database() as database_name,
           current_setting('transaction_read_only')::boolean as read_only,
           pg_is_in_recovery() as in_recovery
      from pg_roles r
     where r.rolname = current_user`
  if (
    !session ||
    session.role_name !== 'beaconhs_super' ||
    session.is_superuser ||
    !session.bypass_rls ||
    !session.can_login ||
    session.database_name !== 'beaconhs' ||
    session.read_only ||
    session.in_recovery
  ) {
    throw new Error('Database session is not the writable BeaconHS BYPASSRLS maintenance role')
  }
}

/** Prevent persisted routes from ever being signed with the local fallback or another deployment. */
export function requireCutoverCapabilitySecret(): void {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV=production is required before minting persisted capabilities')
  }
  const secret = required('ATTACHMENT_CAPABILITY_SECRET')
  if (secret.length < 32 || sha256(secret) !== DEV_ATTACHMENT_CAPABILITY_FINGERPRINT) {
    throw new Error('ATTACHMENT_CAPABILITY_SECRET is not the audited BeaconHS dev secret')
  }
}

/** Prove a known existing object is not anonymously readable without mutating storage. */
export async function assertCutoverObjectPrivate(
  key: string,
  target: { endpoint: string; bucket: string },
): Promise<void> {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const url = `${target.endpoint.replace(/\/$/, '')}/${encodeURIComponent(target.bucket)}/${encodedKey}`
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status !== 401 && response.status !== 403) {
    await response.body?.cancel()
    throw new Error(`Object-store privacy check returned unexpected HTTP ${response.status}`)
  }
  await response.body?.cancel()
}
