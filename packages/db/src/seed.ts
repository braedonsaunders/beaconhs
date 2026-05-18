import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createClient } from './client'
import { account, BUILTIN_ROLES, roles, tenants, tenantUsers, user } from './schema'

async function main() {
  const { db, sql: pg } = createClient()
  console.log('▶ Seeding…')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)

    const adminId = randomUUID()
    const inserted = await tx
      .insert(user)
      .values({
        id: adminId,
        email: 'admin@beaconhs.local',
        name: 'Super Admin',
        emailVerified: true,
        isSuperAdmin: true,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length === 0) {
      console.log('  · super-admin already exists, skipping')
      return
    }
    const admin = inserted[0]!

    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: 'demo',
        name: 'Demo Tenant',
        defaultLanguage: 'en',
        enabledLanguages: ['en'],
      })
      .returning()
    if (!tenant) throw new Error('Failed to create demo tenant')

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: admin.id,
      status: 'active',
      joinedAt: new Date(),
    })

    for (const [key, def] of Object.entries(BUILTIN_ROLES)) {
      await tx.insert(roles).values({
        tenantId: tenant.id,
        key,
        name: def.name,
        description: def.description,
        isBuiltIn: true,
        permissions: def.permissions as unknown as string[],
      })
    }

    console.log(`  · created tenant ${tenant.slug}`)
    console.log(`  · created super-admin ${admin.email}`)
    console.log(`  · sign in via Magic link (Mailpit: http://localhost:8025)`)
  })

  await pg.end()
  console.log('✔ Seed complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
