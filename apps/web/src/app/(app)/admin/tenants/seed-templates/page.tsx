// One-time backfill page for the built-in lift-plan template.
//
// Existing tenants (provisioned before the lift-plan cutover landed) don't
// have the lift-plan form template seeded. Super-admins use this page to fill
// the gap. The seeder is idempotent, so re-clicking is safe.
//
// Once every tenant has been backfilled, this page can be archived — but it
// stays cheap to keep around for new built-in templates we ship later.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { db } from '@beaconhs/db'
import { formTemplates, tenants } from '@beaconhs/db/schema'
import {
  LIFT_PLAN_TEMPLATE_KEY,
  LIFT_PLAN_TEMPLATE_NAME,
  seedLiftPlanTemplate,
} from '@beaconhs/db/seed/lift-plan-template'
import { getCurrentUserId } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Seed built-in templates' }
export const dynamic = 'force-dynamic'

async function seedOne(formData: FormData): Promise<void> {
  'use server'
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  if (!tenantId) return

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    await seedLiftPlanTemplate(tx as any, tenantId)
  })
  revalidatePath('/admin/tenants/seed-templates')
}

async function seedAll(): Promise<void> {
  'use server'
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const all = await tx.select({ id: tenants.id }).from(tenants)
    for (const t of all) {
      await seedLiftPlanTemplate(tx as any, t.id)
    }
  })
  revalidatePath('/admin/tenants/seed-templates')
}

export default async function SeedTemplatesPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')

  // Pull each tenant + whether the lift-plan template is already present.
  // The LEFT JOIN keeps tenants that have zero templates in the list (so
  // they're surfaced for backfill rather than silently dropped).
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    return tx
      .select({
        tenant: tenants,
        liftPlanTemplateId: formTemplates.id,
      })
      .from(tenants)
      .leftJoin(
        formTemplates,
        and(
          eq(formTemplates.tenantId, tenants.id),
          eq(formTemplates.key, LIFT_PLAN_TEMPLATE_KEY),
        ),
      )
      .orderBy(asc(tenants.name))
  })

  const missingCount = rows.filter((r) => !r.liftPlanTemplateId).length

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/tenants', label: 'Back to tenants' }}
          title="Seed built-in templates"
          subtitle="Backfill per-tenant form templates that ship as built-ins. Idempotent — re-running is a no-op."
          actions={
            <form action={seedAll}>
              <Button type="submit" disabled={missingCount === 0}>
                Seed all missing ({missingCount})
              </Button>
            </form>
          }
        />

        <Alert variant="info">
          <AlertTitle>{LIFT_PLAN_TEMPLATE_NAME}</AlertTitle>
          <AlertDescription>
            Per-tenant form template with category <code>lift_plan</code>. Surfaces in
            the form gallery at{' '}
            <Link
              href="/forms?category=lift_plan"
              className="font-medium text-teal-700 hover:underline"
            >
              /forms?category=lift_plan
            </Link>
            .
          </AlertDescription>
        </Alert>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>{LIFT_PLAN_TEMPLATE_NAME}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ tenant, liftPlanTemplateId }) => {
              const seeded = !!liftPlanTemplateId
              return (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">{tenant.name}</TableCell>
                  <TableCell className="font-mono text-xs">{tenant.slug}</TableCell>
                  <TableCell>
                    {seeded ? (
                      <Badge variant="success">Seeded</Badge>
                    ) : (
                      <Badge variant="warning">Missing</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <form action={seedOne}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <Button type="submit" size="sm" variant="outline" disabled={seeded}>
                        {seeded ? 'Already seeded' : 'Seed lift-plan template'}
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  )
}
