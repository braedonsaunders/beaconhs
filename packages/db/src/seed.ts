import 'dotenv/config'
import { createClient } from './client'
import { BUILTIN_ROLES, roles, tenants, tenantUsers, users } from './schema'
import { sql } from 'drizzle-orm'

async function main() {
  const { db, sql: pg } = createClient()
  console.log('▶ Seeding…')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)

    // Super-admin user
    const [admin] = await tx
      .insert(users)
      .values({
        email: 'admin@beaconhs.local',
        name: 'Super Admin',
        isSuperAdmin: true,
      })
      .onConflictDoNothing()
      .returning()

    if (!admin) {
      console.log('  · super-admin already exists, skipping')
      return
    }

    // Demo tenant
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

    // Membership
    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: admin.id,
      status: 'active',
      joinedAt: new Date(),
    })

    // Built-in roles
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

    console.log(`  · created tenant ${tenant.slug} (${tenant.id})`)
    console.log(`  · created super-admin ${admin.email}`)
  })

  await pg.end()
  console.log('✔ Seed complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
