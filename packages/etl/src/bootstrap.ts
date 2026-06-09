// Phase 1 bootstrap: create the two tenants (rassaun + external-training), a super-admin user,
// builtin roles, and the canonical form templates — then ensure the `etl` crosswalk schema.
// Idempotent (select-or-insert). Mirrors packages/db/src/seed.ts but with no demo data.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createClient, withSuperAdmin, schema, CANONICAL_TEMPLATES } from '@beaconhs/db'
import { ensureEtlSchema } from './crosswalk'
import { targetUrl } from './config'

const { tenants, user, tenantUsers, roles, formTemplates, formTemplateVersions, BUILTIN_ROLES } = schema

const ADMIN = { email: 'bsaunders@rassaun.com', name: 'Braedon Saunders' }
const TENANTS = [
  { slug: 'rassaun', name: 'Rassaun Services Inc' },
  { slug: 'external-training', name: 'External Training' },
]

function build5x5() {
  const cells: Record<string, { score: number; label: string; color: string }> = {}
  const labels = ['Low', 'Low', 'Medium', 'High', 'Extreme']
  const colors = ['#22c55e', '#86efac', '#eab308', '#f97316', '#dc2626']
  for (let s = 0; s < 5; s++)
    for (let l = 0; l < 5; l++) {
      const score = (s + 1) * (l + 1)
      const tier = score <= 4 ? 0 : score <= 8 ? 1 : score <= 12 ? 2 : score <= 19 ? 3 : 4
      cells[`${s}:${l}`] = { score, label: labels[tier]!, color: colors[tier]! }
    }
  return cells
}

const RISK_MATRIX = {
  axes: {
    severity: { values: ['Trivial', 'Minor', 'Moderate', 'Major', 'Catastrophic'] },
    likelihood: { values: ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'] },
  },
  cells: build5x5(),
}

export async function bootstrap(): Promise<void> {
  const { db, sql } = createClient({ url: targetUrl() })
  try {
    await withSuperAdmin(db, async (tx) => {
      // --- super-admin user (no password — set later via app magic-link / reset) ---
      let admin = (await tx.select().from(user).where(eq(user.email, ADMIN.email)).limit(1))[0]
      if (!admin) {
        admin = (
          await tx
            .insert(user)
            .values({ id: randomUUID(), email: ADMIN.email, name: ADMIN.name, emailVerified: true, isSuperAdmin: true })
            .returning()
        )[0]!
        console.log(`  + user ${ADMIN.email}`)
      } else console.log(`  · user ${ADMIN.email} exists`)

      for (const def of TENANTS) {
        let tenant = (await tx.select().from(tenants).where(eq(tenants.slug, def.slug)).limit(1))[0]
        if (!tenant) {
          tenant = (
            await tx
              .insert(tenants)
              .values({
                slug: def.slug,
                name: def.name,
                defaultLanguage: 'en',
                enabledLanguages: ['en'],
                branding: { primaryColor: '#0f766e' },
                riskMatrix: RISK_MATRIX,
              })
              .returning()
          )[0]!
          console.log(`  + tenant ${def.slug}`)
        } else console.log(`  · tenant ${def.slug} exists`)

        // membership
        const hasMember = (
          await tx
            .select({ id: tenantUsers.id })
            .from(tenantUsers)
            .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.userId, admin.id)))
            .limit(1)
        )[0]
        if (!hasMember) {
          await tx.insert(tenantUsers).values({
            tenantId: tenant.id,
            userId: admin.id,
            status: 'active',
            joinedAt: new Date(),
            displayName: ADMIN.name,
          })
          console.log(`    + membership in ${def.slug}`)
        }

        // builtin roles
        for (const [key, r] of Object.entries(BUILTIN_ROLES)) {
          await tx
            .insert(roles)
            .values({
              tenantId: tenant.id,
              key,
              name: r.name,
              description: r.description,
              isBuiltIn: true,
              permissions: r.permissions as unknown as string[],
            })
            .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
        }

        // canonical form templates (JSHA / Toolbox / Lift Plan / WAH Rescue)
        for (const c of CANONICAL_TEMPLATES) {
          const ins = await tx
            .insert(formTemplates)
            .values({
              tenantId: tenant.id,
              key: c.key,
              name: c.name,
              category: c.category,
              description: c.description,
              status: 'published',
              moduleBinding: c.moduleBinding,
              createdBy: admin.id,
            })
            .onConflictDoNothing({ target: [formTemplates.tenantId, formTemplates.key] })
            .returning({ id: formTemplates.id })
          const tmpl = ins[0]
          if (tmpl) {
            await tx.insert(formTemplateVersions).values({
              tenantId: tenant.id,
              templateId: tmpl.id,
              version: 1,
              schema: c.schema,
              publishedAt: new Date(),
              publishedBy: admin.id,
              changelog: 'Canonical template v1',
            })
          }
        }
        console.log(`    ✓ roles + ${CANONICAL_TEMPLATES.length} templates for ${def.slug}`)
      }
    })

    // --- etl crosswalk schema (id_map / sync_runs / table_watermarks) ---
    await ensureEtlSchema(sql as any)
    console.log('  ✓ etl schema ensured')
  } finally {
    await sql.end({ timeout: 5 })
  }
  console.log('bootstrap complete.')
}
