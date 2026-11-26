// What every tenant starts with, whichever way it is created — the platform
// "New tenant" form, the seed, or a sample company: built-in roles, the stock
// reports, record PDF templates, document types, and the built-in Lift Plan
// form and class-booking email. Each step is idempotent and never overwrites a
// tenant's own edits, so this is safe to re-run.

import { BUILTIN_ROLES, reportDefinitions, roles } from '../schema'
import { seedDocumentTypesAndCategories } from './document-types'
import { seedLiftPlanTemplate } from './lift-plan-template'
import { seedFormPdfTemplates, seedPdfTemplates } from './pdf-templates'
import { BEACON_REPORT_SEEDS } from './report-definitions'
import { seedTrainingClassBookingEmail } from './training-class-email'
import type { Database } from '../client'

type DrizzleTx = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export async function seedBuiltInRoles(tx: DrizzleTx, tenantId: string): Promise<void> {
  await tx
    .insert(roles)
    .values(
      Object.entries(BUILTIN_ROLES).map(([key, def]) => ({
        tenantId,
        key,
        name: def.name,
        description: def.description,
        isBuiltIn: true,
        permissions: def.permissions as unknown as string[],
      })),
    )
    .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
}

/**
 * Every report is an ordinary tenant-owned AppKit definition. Insert-only, so
 * re-running restores missing defaults without overwriting a tenant's edits.
 */
export async function seedReportDefinitions(tx: DrizzleTx, tenantId: string): Promise<void> {
  await tx
    .insert(reportDefinitions)
    .values(
      BEACON_REPORT_SEEDS.map((definition) => ({
        tenantId,
        seedKey: definition.seedKey,
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        query: definition.query,
        layout: definition.layout,
        state: definition.state,
        tags: definition.tags ?? [],
      })),
    )
    .onConflictDoNothing()
}

export async function provisionTenantDefaults(tx: DrizzleTx, tenantId: string): Promise<void> {
  await seedBuiltInRoles(tx, tenantId)
  await seedReportDefinitions(tx, tenantId)
  await seedDocumentTypesAndCategories(tx, tenantId)
  await seedLiftPlanTemplate(tx, tenantId)
  await seedTrainingClassBookingEmail(tx, tenantId)
  // After the built-in forms exist, so the Lift Plan gets its default PDF too.
  await seedPdfTemplates(tx, tenantId)
  await seedFormPdfTemplates(tx, tenantId)
}
