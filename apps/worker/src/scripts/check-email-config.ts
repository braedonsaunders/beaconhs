/** Fail-closed deployment check for the database-managed platform email provider. */

import { eq } from 'drizzle-orm'
import { createClient } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID } from '@beaconhs/db/schema'
import { resolvePublicHost } from '@beaconhs/sync/egress'
import {
  resolveEmailTransport,
  validateStoredEmailConfig,
  type PlatformEmailConfig,
} from '@beaconhs/emails'

const DATABASE_URL = process.env.SUPERADMIN_DATABASE_URL
if (!DATABASE_URL) throw new Error('SUPERADMIN_DATABASE_URL is required')

const { db, sql } = createClient({ url: DATABASE_URL, max: 1 })

async function main(): Promise<void> {
  const [row] = await db
    .select({ email: platformSettings.email })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1)
  const config = (row?.email ?? null) as PlatformEmailConfig | null
  if (!config) throw new Error('Platform email configuration is missing')
  if (config.mode === 'disabled') throw new Error('Platform email delivery is disabled')
  validateStoredEmailConfig(config, { requireComplete: true })
  const transport = resolveEmailTransport(config)
  if (!transport) {
    throw new Error(
      'Platform email provider is incomplete or its credential cannot be decrypted with BETTER_AUTH_SECRET',
    )
  }
  if (transport.provider === 'smtp') {
    const resolved = await resolvePublicHost(transport.host)
    if (resolved.ipLiteral) {
      throw new Error(
        'External SMTP host must be a public DNS name so its TLS identity can be verified',
      )
    }
  }
  console.log(
    `[email-config] provider=${transport.provider} mode=${config.mode ?? 'tenant_optional'}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error('[email-config] FAILED:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
