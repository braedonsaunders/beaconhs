'use server'

// Bulk CSV import for /people/import. Accepts an array of pre-parsed rows from
// the client (because parsing happens in the preview pane before the user
// confirms) and inserts each as a person, skipping rows that fail validation
// or that hit a unique-employee-no conflict.
//
// Looks up department + trade BY NAME because the CSV is typed by humans
// reading the legacy export; the names are stable and unique within a tenant.
// Missing department/trade rows are simply left null rather than auto-created.

import { revalidatePath } from 'next/cache'
import { asc } from 'drizzle-orm'
import { departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

export type ImportRow = {
  firstName: string
  lastName: string
  email: string | null
  employeeNo: string | null
  hireDate: string | null
  department: string | null
  trade: string | null
}

export type ImportResult = {
  ok: true
  created: number
  skipped: number
  errors: { line: number; reason: string }[]
}

const MAX_IMPORT_ROWS = 1000

export async function importPeopleCsv(args: { rows: ImportRow[] }): Promise<ImportResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const batchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  if (args.rows.length === 0) {
    return { ok: true, created: 0, skipped: 0, errors: [] }
  }

  // Hard cap per call — matches the bulk-action pattern so a single request
  // can't insert an unbounded number of rows. Larger files import in batches.
  const overflow = Math.max(0, args.rows.length - MAX_IMPORT_ROWS)
  const rows = args.rows.slice(0, MAX_IMPORT_ROWS)

  // Pre-load lookup maps so we don't re-query inside the row loop.
  const [allDepts, allTrades] = await ctx.db(async (tx) => {
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    return [d, t] as const
  })
  const deptByName = new Map(allDepts.map((d) => [d.name.toLowerCase(), d.id]))
  const tradeByName = new Map(allTrades.map((t) => [t.name.toLowerCase(), t.id]))

  let created = 0
  let skipped = 0
  const errors: { line: number; reason: string }[] = []
  const createdIds: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const lineNo = i + 2 // header is line 1
    const firstName = row.firstName.trim()
    const lastName = row.lastName.trim()
    if (!firstName || !lastName) {
      errors.push({ line: lineNo, reason: 'Missing first or last name' })
      skipped++
      continue
    }
    if (row.hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.hireDate)) {
      errors.push({ line: lineNo, reason: `Bad hire date: ${row.hireDate}` })
      skipped++
      continue
    }
    const deptId = row.department ? (deptByName.get(row.department.toLowerCase()) ?? null) : null
    const tradeId = row.trade ? (tradeByName.get(row.trade.toLowerCase()) ?? null) : null

    try {
      const [inserted] = await ctx.db((tx) =>
        tx
          .insert(people)
          .values({
            tenantId: ctx.tenantId,
            firstName,
            lastName,
            email: row.email?.trim() || null,
            employeeNo: row.employeeNo?.trim() || null,
            hireDate: row.hireDate || null,
            departmentId: deptId,
            tradeId: tradeId,
          })
          .returning({ id: people.id }),
      )
      if (inserted) {
        created++
        createdIds.push(inserted.id)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Unique-violation on employee_no is the most likely real-world error.
      const friendly = /people_tenant_employee_no_ux/.test(msg)
        ? `Employee # ${row.employeeNo} already exists`
        : msg.slice(0, 200)
      errors.push({ line: lineNo, reason: friendly })
      skipped++
    }
  }

  if (overflow > 0) {
    skipped += overflow
    errors.push({
      line: MAX_IMPORT_ROWS + 2,
      reason: `Import is limited to ${MAX_IMPORT_ROWS} rows per batch — ${overflow} ${
        overflow === 1 ? 'row was' : 'rows were'
      } not processed. Import the remainder as a second batch.`,
    })
  }

  // One summary audit per import, plus per-person audit for traceability.
  for (const id of createdIds) {
    await recordAudit(ctx, {
      entityType: 'person',
      entityId: id,
      action: 'create',
      summary: 'Created via bulk CSV import',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'person',
    action: 'create',
    summary: `Bulk CSV import: ${created} created, ${skipped} skipped`,
    metadata: {
      batchId,
      created,
      skipped,
      errorCount: errors.length,
      personIds: createdIds,
    },
  })

  revalidatePath('/people')
  return { ok: true, created, skipped, errors }
}

// Lookup helper for the import preview so the UI can show "this department
// will be matched to <id>" or "no matching department" inline.
export async function listImportLookups(): Promise<{
  departments: string[]
  trades: string[]
}> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  return ctx.db(async (tx) => {
    const d = await tx
      .select({ name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
    const t = await tx.select({ name: trades.name }).from(trades).orderBy(asc(trades.name))
    return { departments: d.map((r) => r.name), trades: t.map((r) => r.name) }
  })
}
