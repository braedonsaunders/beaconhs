import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../client'
import { documentCategories, documentTypes } from '../schema'

type DrizzleTx = Pick<Database, 'select' | 'insert'>

/**
 * Idempotently insert the standard set of document types + categories for the
 * given tenant. Safe to re-run — uses ON CONFLICT for types
 * (unique on (tenant_id, key)), and name-existence checks for categories.
 */
export async function seedDocumentTypesAndCategories(
  tx: DrizzleTx,
  tenantId: string,
): Promise<void> {
  // --- Document Types (5) ---------------------------------------------
  const docTypeRows = [
    {
      key: 'policy',
      name: 'Policy',
      color: '#0f766e',
      description: 'Company-wide policies and stances.',
    },
    {
      key: 'procedure',
      name: 'Procedure / SOP',
      color: '#2563eb',
      description: 'Step-by-step instructions for routine work.',
    },
    {
      key: 'sds',
      name: 'SDS / MSDS',
      color: '#ea580c',
      description: 'Safety data sheets for hazardous materials.',
    },
    {
      key: 'manual',
      name: 'Manual / handbook',
      color: '#7c3aed',
      description: 'Equipment manuals and reference handbooks.',
    },
    {
      key: 'form',
      name: 'Form / template',
      color: '#0891b2',
      description: 'Blank forms and printable templates.',
    },
  ]
  let typesInserted = 0
  for (const row of docTypeRows) {
    const inserts = await tx
      .insert(documentTypes)
      .values({
        tenantId,
        key: row.key,
        name: row.name,
        color: row.color,
        description: row.description,
      })
      .onConflictDoNothing({ target: [documentTypes.tenantId, documentTypes.key] })
      .returning({ id: documentTypes.id })
    if (inserts.length > 0) typesInserted += 1
  }

  // --- Document Categories (5, hierarchical) --------------------------
  // The root category "Safety" with three children (PPE, Permits, Working
  // at Heights), plus a sibling "Operations" category.
  const categoryDefs: { name: string; parent?: string; description?: string }[] = [
    { name: 'Safety', description: 'All safety-related policies and procedures.' },
    { name: 'PPE', parent: 'Safety', description: 'Personal protective equipment policies.' },
    {
      name: 'Permits',
      parent: 'Safety',
      description: 'Hot work, confined-space, working-at-heights permits.',
    },
    { name: 'Working at Heights', parent: 'Safety', description: 'Fall-arrest and ladder safety.' },
    { name: 'Operations', description: 'Day-to-day operational SOPs.' },
  ]
  const insertedCats = new Map<string, string>()
  let catsInserted = 0
  for (const def of categoryDefs) {
    const parentId = def.parent ? (insertedCats.get(def.parent) ?? null) : null
    // Match the active sibling-name identity enforced by the schema index.
    // Deleted categories do not reserve names, and separate parents may use
    // the same case-insensitive, trimmed display name.
    const existing = await tx
      .select({ id: documentCategories.id })
      .from(documentCategories)
      .where(
        and(
          eq(documentCategories.tenantId, tenantId),
          parentId
            ? eq(documentCategories.parentId, parentId)
            : isNull(documentCategories.parentId),
          isNull(documentCategories.deletedAt),
          sql`lower(btrim(${documentCategories.name})) = lower(btrim(${def.name}))`,
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      insertedCats.set(def.name, existing[0]!.id)
      continue
    }
    const [row] = await tx
      .insert(documentCategories)
      .values({ tenantId, name: def.name, parentId, description: def.description ?? null })
      .returning({ id: documentCategories.id })
    if (row) {
      insertedCats.set(def.name, row.id)
      catsInserted += 1
    }
  }

  console.log(
    `  · doc lookups: ${typesInserted}/${docTypeRows.length} types, ${catsInserted}/${categoryDefs.length} categories`,
  )
}
