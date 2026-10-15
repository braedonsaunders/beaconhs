// The `journals` record saver: the entry body and its metadata (date, log
// type, location, supervisor, tags), queued on the device by the Journals
// workspace and applied by /api/records/sync (see lib/record-sync). Same rules
// the journal autosave has always had — journals.assign, or your own entries
// with journals.update.own; only unlocked drafts; sanitized HTML with its
// plain-text mirror; a real date (compliance obligations recomputed when it
// moves); an existing location; an active supervisor; normalized tags — plus a
// compare-and-set against the value the device last saw.

import { and, eq, isNull } from 'drizzle-orm'
import { activePeopleWhere, type Database } from '@beaconhs/db'
import { journalEntries, journalEntryTags, orgUnits, people } from '@beaconhs/db/schema'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import {
  RecordEditRejection,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
  type RecordChange,
} from '@/lib/record-sync/edits'
import { journalMutationScope } from './_mutation-policy'
import { isJournalDate, journalMutationWhere } from './_mutation-scope'
import { canonicalJournalTags, normalizeJournalTags } from './_tag-policy'
import type { JournalDefinition } from './_types'

type JournalEntryRow = typeof journalEntries.$inferSelect
type LoadedJournal = { row: JournalEntryRow; tags: string[] }

const MAX_BODY_HTML_LENGTH = 1_000_000

/** Wire value → stored value for each journal field (pure; existence checks run on write). */
export const journalFieldRules = {
  bodyHtml(wire: unknown): string {
    if (typeof wire !== 'string' || wire.length > MAX_BODY_HTML_LENGTH) {
      throw new RecordEditRejection('Journal content is invalid or too large.')
    }
    // Never trust the client editor: the shared allow-list sanitizer (same as
    // Documents) strips scripts/event handlers but keeps every TipTap node.
    return sanitizeDocumentHtml(wire)
  },
  entryDate(wire: unknown): string {
    if (!isJournalDate(wire)) throw new RecordEditRejection('Invalid journal date.')
    return wire
  },
  definition(wire: unknown): JournalDefinition {
    if (wire !== 'worker' && wire !== 'supervisor') {
      throw new RecordEditRejection('Invalid journal definition.')
    }
    return wire
  },
  siteOrgUnitId(wire: unknown): string | null {
    return optionalId(wire, 'Invalid site.')
  },
  supervisorPersonId(wire: unknown): string | null {
    return optionalId(wire, 'Invalid supervisor.')
  },
  tags(wire: unknown): string[] {
    const tags = normalizeJournalTags(wire)
    if (!tags) throw new RecordEditRejection('Invalid journal tags.')
    return canonicalJournalTags(tags)
  },
}

function optionalId(wire: unknown, message: string): string | null {
  if (wire == null || wire === '') return null
  if (typeof wire !== 'string' || !isUuid(wire)) throw new RecordEditRejection(message)
  return wire
}

/** The columns each op writes, for the autosave audit entry. */
export function journalAuditFields(changes: Pick<RecordChange, 'op'>[]): string[] {
  return changes.flatMap((change) =>
    change.op === 'bodyHtml'
      ? ['bodyHtml', 'bodyText']
      : change.op === 'tags'
        ? ['tagsCache']
        : [change.op],
  )
}

function resolveJournalOp(
  tx: Database,
  ctx: RequestContext,
  loaded: LoadedJournal,
  op: string,
): ErasedRecordOp | null {
  const { row } = loaded
  const update = async (patch: Partial<JournalEntryRow>) => {
    await tx
      .update(journalEntries)
      .set(patch)
      .where(and(eq(journalEntries.id, row.id), eq(journalEntries.tenantId, ctx.tenantId)))
  }
  const text = (value: string | null) => value ?? ''

  switch (op) {
    case 'bodyHtml':
      return recordOp<string>({
        current: text(row.bodyHtml),
        parse: journalFieldRules.bodyHtml,
        format: (value) => value,
        write: async (html) => {
          const bodyText = htmlToText(html)
          await update({ bodyHtml: html, bodyText })
          row.bodyHtml = html
          row.bodyText = bodyText
        },
      })
    case 'entryDate':
      return recordOp<string>({
        current: row.entryDate,
        parse: journalFieldRules.entryDate,
        format: (value) => value,
        write: async (entryDate) => {
          await update({ entryDate })
          row.entryDate = entryDate
        },
      })
    case 'definition':
      return recordOp<JournalDefinition>({
        current: row.definition,
        parse: journalFieldRules.definition,
        format: (value) => value,
        write: async (definition) => {
          await update({ definition })
          row.definition = definition
        },
      })
    case 'siteOrgUnitId':
      return recordOp<string | null>({
        current: row.siteOrgUnitId,
        parse: journalFieldRules.siteOrgUnitId,
        format: text,
        write: async (siteOrgUnitId) => {
          if (siteOrgUnitId) {
            const [site] = await tx
              .select({ id: orgUnits.id })
              .from(orgUnits)
              .where(
                and(
                  eq(orgUnits.id, siteOrgUnitId),
                  eq(orgUnits.tenantId, ctx.tenantId),
                  isNull(orgUnits.deletedAt),
                ),
              )
              .limit(1)
            if (!site) throw new RecordEditRejection('Invalid site.')
          }
          await update({ siteOrgUnitId })
          row.siteOrgUnitId = siteOrgUnitId
        },
      })
    case 'supervisorPersonId':
      return recordOp<string | null>({
        current: row.supervisorPersonId,
        parse: journalFieldRules.supervisorPersonId,
        format: text,
        write: async (supervisorPersonId) => {
          if (supervisorPersonId) {
            const [supervisor] = await tx
              .select({ id: people.id })
              .from(people)
              .where(
                and(
                  eq(people.id, supervisorPersonId),
                  eq(people.tenantId, ctx.tenantId),
                  activePeopleWhere(),
                ),
              )
              .limit(1)
            if (!supervisor) throw new RecordEditRejection('Invalid supervisor.')
          }
          await update({ supervisorPersonId })
          row.supervisorPersonId = supervisorPersonId
        },
      })
    case 'tags':
      return recordOp<string[]>({
        current: loaded.tags,
        parse: journalFieldRules.tags,
        format: canonicalJournalTags,
        write: async (tags) => {
          // The worker's list replaces every tag on the entry (AI tags too).
          await tx
            .delete(journalEntryTags)
            .where(
              and(
                eq(journalEntryTags.entryId, row.id),
                eq(journalEntryTags.tenantId, ctx.tenantId),
              ),
            )
          if (tags.length > 0) {
            await tx.insert(journalEntryTags).values(
              tags.map((tag) => ({
                tenantId: ctx.tenantId,
                entryId: row.id,
                tag,
                source: 'user' as const,
              })),
            )
          }
          await update({ tagsCache: tags })
          row.tagsCache = tags
          loaded.tags = tags
        },
      })
    default:
      return null
  }
}

export const journalRecordSaver = defineRecordSaver<LoadedJournal>('journals', {
  authorize: (ctx) => journalMutationScope(ctx, 'edit') !== 'none',
  async load(tx, ctx, entryId) {
    // The author/visibility scope without the draft condition, so a
    // submitted entry reads as locked (it can be unlocked), not as missing.
    const where = await journalMutationWhere(ctx, entryId, 'edit', { requireDraft: false, tx })
    const [row] = await tx
      .select()
      .from(journalEntries)
      .where(and(where, eq(journalEntries.tenantId, ctx.tenantId)))
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    if (row.status !== 'draft' || row.lockedAt) {
      throw recordLocked('This entry has already been submitted.')
    }
    const tagRows = await tx
      .select({ tag: journalEntryTags.tag })
      .from(journalEntryTags)
      .where(and(eq(journalEntryTags.entryId, row.id), eq(journalEntryTags.tenantId, ctx.tenantId)))
    return { row, tags: canonicalJournalTags(tagRows.map((tagRow) => tagRow.tag)) }
  },
  resolve: resolveJournalOp,
  async afterWrites(tx, ctx, { row }, changes) {
    // One entry per autosave batch, naming the columns it wrote.
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'journal_entry',
      entityId: row.id,
      action: 'update',
      summary: 'Autosaved journal entry',
      metadata: { fields: journalAuditFields(changes) },
    })
    if (changes.some((change) => change.op === 'entryDate')) {
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'journal',
        targetRef: {},
      })
    }
  },
  // The workspace owns the entry on the client; autosave never revalidated
  // the journal routes (it would thrash the route cache while typing).
  revalidate: () => [],
})
