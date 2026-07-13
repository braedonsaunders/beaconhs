// Server-only helper: email a journal-entry recap. Recipients = the tenant's
// 'journal' notification recipients, plus the entry's supervisor and author.

import { and, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { resolveNotificationAudienceEmails } from '@beaconhs/events'
import { enqueueEmail } from '@beaconhs/jobs'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { journalEntries, orgUnits, people } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { getAuthorPersonId, journalCanReadAll, journalScopeWhere } from './_lib'
import { textToHtml } from './_format'

const authorPerson = alias(people, 'jmail_author')
const supPerson = alias(people, 'jmail_sup')

function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendJournalEntryEmail(ctx: RequestContext, entryId: string): Promise<number> {
  // Visibility-scoped exactly like the entry mutations (_actions.ts scopedWhere):
  // a journals.read.self user must not be able to email another author's journal
  // by id, and soft-deleted entries are never sent.
  const authorPersonId = journalCanReadAll(ctx) ? null : await getAuthorPersonId(ctx)
  const entryWhere = and(
    eq(journalEntries.id, entryId),
    isNull(journalEntries.deletedAt),
    journalScopeWhere(ctx, authorPersonId),
  )

  const data = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({
        entry: journalEntries,
        siteName: orgUnits.name,
        authorFirst: authorPerson.firstName,
        authorLast: authorPerson.lastName,
        authorEmail: authorPerson.email,
        supEmail: supPerson.email,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .leftJoin(supPerson, eq(supPerson.id, journalEntries.supervisorPersonId))
      .where(entryWhere)
      .limit(1)
    if (!e) return null

    const recip = await resolveNotificationAudienceEmails(tx, ctx.tenantId, 'journal')
    return { e, recip }
  })
  if (!data) return 0

  const to = Array.from(
    new Set(
      [...data.recip, data.e.supEmail, data.e.authorEmail].filter(
        (x): x is string => !!x && x.includes('@'),
      ),
    ),
  )
  if (to.length === 0) return 0

  const entry = data.e.entry
  const author = `${data.e.authorFirst ?? ''} ${data.e.authorLast ?? ''}`.trim() || 'Unknown'
  const subject = `Journal · ${entry.reference} · ${entry.entryDate}`
  const text = [
    entry.title ?? 'Journal entry',
    '',
    `Reference: ${entry.reference}`,
    `Date: ${entry.entryDate}`,
    `By: ${author}`,
    `Site: ${data.e.siteName ?? '—'}`,
    '',
    entry.bodyText ?? '',
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;">
      <h2 style="margin:0 0 4px">${esc(entry.title ?? 'Journal entry')}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px;">
        ${esc(entry.reference)} · ${esc(entry.entryDate)} · ${esc(author)}${
          data.e.siteName ? ` · ${esc(data.e.siteName)}` : ''
        }
      </div>
      <div style="font-size:14px;line-height:1.6;">${
        sanitizeDocumentHtml(entry.bodyHtml || textToHtml(entry.bodyText)) || '(no content)'
      }</div>
    </div>`

  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: { tenantId: ctx.tenantId, category: 'journal' },
  })
  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: entryId,
    action: 'update',
    summary: `Emailed ${to.length} recipient${to.length === 1 ? '' : 's'}`,
  })
  return to.length
}
