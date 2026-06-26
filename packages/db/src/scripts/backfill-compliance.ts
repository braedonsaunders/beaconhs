// Backfill existing per-module assignments into the unified compliance engine.
//
// Maps the legacy 5 (inspection / document / training / form / journal)
// assignment rows → compliance_obligations + compliance_audience. Idempotent:
// keyed on (legacy_table, legacy_id) via the unique index + onConflictDoNothing,
// so re-running is safe. Run with the BYPASSRLS super pool (SUPERADMIN_DATABASE_URL):
//   pnpm --filter @beaconhs/db exec tsx src/scripts/backfill-compliance.ts
//
// Connects via the super pool (role beaconhs_super): tenant tables are FORCE ROW
// LEVEL SECURITY, so the app role cannot read/write across tenants; we filter
// tenantId explicitly anyway.

import { and, eq, isNull } from 'drizzle-orm'
import { createSuperClient } from '../client'
import * as s from '../schema'

type Aud = { kind: string; entityKey: string }

function audFromArrays(opts: {
  everyone?: boolean
  roleKeys?: string[] | null
  personIds?: string[] | null
  orgUnitIds?: string[] | null
  tradeIds?: string[] | null
}): Aud[] {
  if (opts.everyone) return [{ kind: 'everyone', entityKey: '' }]
  const out: Aud[] = []
  for (const k of opts.roleKeys ?? []) out.push({ kind: 'role', entityKey: k })
  for (const p of opts.personIds ?? []) out.push({ kind: 'person', entityKey: p })
  for (const o of opts.orgUnitIds ?? []) out.push({ kind: 'org_unit', entityKey: o })
  for (const t of opts.tradeIds ?? []) out.push({ kind: 'trade', entityKey: t })
  return out
}

async function main() {
  const { db, sql } = createSuperClient({ max: 1 })

  const tenants = await db.select({ id: s.tenants.id }).from(s.tenants)
  let created = 0
  let skipped = 0

  const insertOb = async (
    tenantId: string,
    row: {
      sourceModule: string
      subjectKind: string
      title: string
      notes?: string | null
      targetRef: Record<string, unknown>
      recurrence: Record<string, unknown>
      recurrenceKind: string
      status: string
      legacyId: string
      legacyTable: string
    },
    audience: Aud[],
  ) => {
    const [ob] = await db
      .insert(s.complianceObligations)
      .values({
        tenantId,
        sourceModule: row.sourceModule as never,
        subjectKind: row.subjectKind as never,
        title: row.title,
        notes: row.notes ?? null,
        status: row.status as never,
        targetRef: row.targetRef as never,
        recurrence: row.recurrence as never,
        recurrenceKind: row.recurrenceKind as never,
        legacyTable: row.legacyTable,
        legacyId: row.legacyId,
      })
      .onConflictDoNothing({
        target: [s.complianceObligations.legacyTable, s.complianceObligations.legacyId],
      })
      .returning({ id: s.complianceObligations.id })
    if (!ob) {
      skipped++
      return
    }
    created++
    if (audience.length > 0) {
      await db.insert(s.complianceAudience).values(
        audience.map((a) => ({
          tenantId,
          obligationId: ob.id,
          kind: a.kind as never,
          entityKey: a.entityKey,
        })),
      )
    }
  }

  for (const { id: tenantId } of tenants) {
    // ---- Inspection assignments ----
    const insp = await db
      .select({ a: s.inspectionAssignments, typeName: s.inspectionTypes.name })
      .from(s.inspectionAssignments)
      .leftJoin(s.inspectionTypes, eq(s.inspectionTypes.id, s.inspectionAssignments.typeId))
      .where(
        and(
          eq(s.inspectionAssignments.tenantId, tenantId),
          isNull(s.inspectionAssignments.deletedAt),
        ),
      )
    for (const { a, typeName } of insp) {
      await insertOb(
        tenantId,
        {
          sourceModule: 'inspection',
          subjectKind: 'per_person',
          title: typeName ?? 'Inspection',
          notes: a.notes,
          targetRef: { inspectionTypeId: a.typeId },
          recurrence: {
            kind: 'frequency',
            frequency: a.frequency,
            quantity: a.quantityPerPeriod,
            compliantPercentage: a.compliantPercentage,
            cron: a.cron ?? undefined,
            dueOffsetMinutes: a.dueOffsetMinutes ?? undefined,
          },
          recurrenceKind: 'frequency',
          status: a.enabled ? 'active' : 'paused',
          legacyTable: 'inspection_assignments',
          legacyId: a.id,
        },
        audFromArrays({
          everyone: a.targetEverybody,
          roleKeys: a.targetRoleKeys,
          personIds: a.targetPersonIds,
          orgUnitIds: a.targetOrgUnitIds,
        }),
      )
    }

    // ---- Document assignments ----
    const docs = await db
      .select({ a: s.documentAssignments, docTitle: s.documents.title })
      .from(s.documentAssignments)
      .innerJoin(s.documents, eq(s.documents.id, s.documentAssignments.documentId))
      .where(
        and(eq(s.documentAssignments.tenantId, tenantId), isNull(s.documentAssignments.deletedAt)),
      )
    for (const { a, docTitle } of docs) {
      const aud = await db
        .select({
          type: s.documentAssignmentAudience.type,
          entityKey: s.documentAssignmentAudience.entityKey,
        })
        .from(s.documentAssignmentAudience)
        .where(eq(s.documentAssignmentAudience.assignmentId, a.id))
      await insertOb(
        tenantId,
        {
          sourceModule: 'document',
          subjectKind: 'per_person',
          title: a.title ?? docTitle ?? 'Document acknowledgement',
          notes: a.notes,
          targetRef: { documentId: a.documentId },
          recurrence: { kind: 'one_time', dueOn: a.dueOn ?? undefined },
          recurrenceKind: 'one_time',
          status: 'active',
          legacyTable: 'document_assignments',
          legacyId: a.id,
        },
        aud.map((r) => ({
          kind: r.type === 'everyone' ? 'everyone' : r.type,
          entityKey: r.type === 'everyone' ? '' : r.entityKey,
        })),
      )
    }

    // ---- Training audience assignments ----
    const tr = await db
      .select()
      .from(s.trainingAudienceAssignments)
      .where(
        and(
          eq(s.trainingAudienceAssignments.tenantId, tenantId),
          isNull(s.trainingAudienceAssignments.deletedAt),
        ),
      )
    for (const a of tr) {
      const targets = await db
        .select()
        .from(s.trainingAudienceAssignmentTargets)
        .where(eq(s.trainingAudienceAssignmentTargets.assignmentId, a.id))
      const aud: Aud[] = targets.some((t) => t.kind === 'everyone')
        ? [{ kind: 'everyone', entityKey: '' }]
        : targets.flatMap((t) =>
            t.kind === 'person' && t.personId
              ? [{ kind: 'person', entityKey: t.personId }]
              : t.kind === 'trade' && t.tradeId
                ? [{ kind: 'trade', entityKey: t.tradeId }]
                : t.kind === 'role' && t.roleKey
                  ? [{ kind: 'role', entityKey: t.roleKey }]
                  : [],
          )
      await insertOb(
        tenantId,
        {
          sourceModule: 'training',
          subjectKind: 'per_person',
          title: a.name,
          notes: a.notes,
          targetRef: {
            trainingItemKind: a.itemKind,
            courseId: a.courseId ?? undefined,
            assessmentTypeId: a.assessmentTypeId ?? undefined,
          },
          recurrence: a.recurrenceCron
            ? { kind: 'frequency', cron: a.recurrenceCron, remindBeforeDays: a.remindBeforeDays }
            : {
                kind: 'one_time',
                dueOn: a.dueOn ?? undefined,
                remindBeforeDays: a.remindBeforeDays,
              },
          recurrenceKind: a.recurrenceCron ? 'frequency' : 'one_time',
          status: a.status === 'active' ? 'active' : 'archived',
          legacyTable: 'training_audience_assignments',
          legacyId: a.id,
        },
        aud,
      )
    }

    // ---- Form assignments (scheduled) ----
    const forms = await db
      .select({ a: s.formAssignments, templateName: s.formTemplates.name })
      .from(s.formAssignments)
      .innerJoin(s.formTemplates, eq(s.formTemplates.id, s.formAssignments.templateId))
      .where(and(eq(s.formAssignments.tenantId, tenantId), eq(s.formAssignments.mode, 'scheduled')))
    for (const { a, templateName } of forms) {
      await insertOb(
        tenantId,
        {
          sourceModule: 'form',
          subjectKind: 'per_person',
          title: templateName,
          targetRef: { formTemplateId: a.templateId },
          recurrence: {
            kind: 'cron',
            cron: a.cron ?? undefined,
            dueOffsetMinutes: a.dueOffsetMinutes ?? undefined,
          },
          recurrenceKind: 'cron',
          status: a.enabled ? 'active' : 'paused',
          legacyTable: 'form_assignments',
          legacyId: a.id,
        },
        audFromArrays({
          roleKeys: a.targetRoleKeys,
          personIds: a.targetPersonIds,
          orgUnitIds: a.targetOrgUnitIds,
        }),
      )
    }

    // ---- Journal assignments ----
    const journals = await db
      .select()
      .from(s.journalAssignments)
      .where(
        and(eq(s.journalAssignments.tenantId, tenantId), isNull(s.journalAssignments.deletedAt)),
      )
    for (const a of journals) {
      const jaud = (a.audience ?? {}) as {
        roleKeys?: string[]
        personIds?: string[]
        orgUnitIds?: string[]
      }
      const aud = audFromArrays({
        roleKeys: jaud.roleKeys,
        personIds: jaud.personIds,
        orgUnitIds: jaud.orgUnitIds,
      })
      await insertOb(
        tenantId,
        {
          sourceModule: 'journal',
          subjectKind: 'per_person',
          title: a.name,
          notes: a.description,
          targetRef: {},
          recurrence: {
            kind: 'frequency',
            frequency: a.frequency,
            quantity: a.quantity,
            compliantPercentage: a.compliantPercentage,
          },
          recurrenceKind: 'frequency',
          status: a.active ? 'active' : 'paused',
          legacyTable: 'journal_assignments',
          legacyId: a.id,
        },
        aud.length > 0 ? aud : [{ kind: 'everyone', entityKey: '' }],
      )
    }
  }

  console.log(
    `✔ backfill done — ${created} obligations created, ${skipped} already existed (${tenants.length} tenants)`,
  )
  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
