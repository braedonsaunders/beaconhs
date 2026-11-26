import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { createClient } from '@beaconhs/db'
import {
  BUILTIN_ROLES,
  documentTypes,
  emailTemplates,
  formTemplates,
  pdfTemplates,
  reportDefinitions,
  roles,
  tenants,
} from '@beaconhs/db/schema'
import { BEACON_REPORT_SEEDS } from '@beaconhs/db/seed/report-definitions'
import { provisionTenantDefaults } from '@beaconhs/db/seed/tenant-defaults'

const adminUrl = process.env.SUPERADMIN_DATABASE_URL
if (!adminUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(adminUrl).hostname))
  throw new Error('Tenant default tests require an isolated localhost database')
const admin = createClient({ url: adminUrl, max: 1 })
const tenantId = randomUUID()

afterAll(async () => {
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.sql.end()
})

async function counts() {
  const of = async (
    table:
      | typeof roles
      | typeof reportDefinitions
      | typeof pdfTemplates
      | typeof documentTypes
      | typeof formTemplates
      | typeof emailTemplates,
  ) =>
    Number(
      (await admin.db.select({ n: count() }).from(table).where(eq(table.tenantId, tenantId)))[0]?.n,
    )
  return {
    roles: await of(roles),
    reports: await of(reportDefinitions),
    pdfTemplates: await of(pdfTemplates),
    documentTypes: await of(documentTypes),
    forms: await of(formTemplates),
    emails: await of(emailTemplates),
  }
}

it('gives a new tenant every default, and re-running changes nothing', async () => {
  await admin.db
    .insert(tenants)
    .values({ id: tenantId, slug: `defaults-${tenantId}`, name: 'Tenant defaults test' })
  await admin.db.transaction((tx) => provisionTenantDefaults(tx, tenantId))
  const first = await counts()
  expect(first).toMatchObject({
    roles: Object.keys(BUILTIN_ROLES).length,
    reports: BEACON_REPORT_SEEDS.length,
    documentTypes: 5,
    forms: 1,
    emails: 1,
  })
  // Every module print default plus the Lift Plan form's own PDF.
  expect(first.pdfTemplates).toBeGreaterThan(10)
  await admin.db.transaction((tx) => provisionTenantDefaults(tx, tenantId))
  expect(await counts()).toEqual(first)
})
