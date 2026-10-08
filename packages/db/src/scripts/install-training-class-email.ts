// Run against the target database with DATABASE_URL configured:
// pnpm --filter @beaconhs/db exec tsx src/scripts/install-training-class-email.ts --apply
// Without --apply, inspect existing defaults without making changes.
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import { tenants } from '../schema/core'
import { emailTemplates } from '../schema/email-templates'
import { formAutomations } from '../schema/forms'
import { seedTrainingClassBookingEmail } from '../seed/training-class-email'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 })
  const db = drizzle(client)
  const apply = process.argv.includes('--apply')
  try {
    const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
    const results = []
    for (const tenant of allTenants) {
      const result = await db.transaction(async (tx) => {
        if (!apply) await tx.execute(sql`SET TRANSACTION READ ONLY`)
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)
        if (apply) return seedTrainingClassBookingEmail(tx, tenant.id, { upgradeInlineFlows: true })
        const templates = await tx
          .select({ id: emailTemplates.id, key: emailTemplates.key })
          .from(emailTemplates)
          .where(eq(emailTemplates.recordSubjectKey, 'training-classes'))
        const flows = await tx
          .select({ id: formAutomations.id, name: formAutomations.name })
          .from(formAutomations)
          .where(eq(formAutomations.subjectKey, 'training-classes'))
        return { templates, flows }
      })
      results.push({ tenant, ...result })
    }
    console.log(JSON.stringify({ apply, results }))
  } finally {
    await client.end()
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Training class email installation failed.',
  )
  process.exitCode = 1
})
