// Server-only helper: email a journal-entry recap. Recipients = the tenant's
// 'journal' notification recipients, plus the entry's supervisor and author.

import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { sendEmail } from '@beaconhs/emails'
import {
  journalEntries,
  orgUnits,
  people,
  tenantNotificationRecipients,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

const authorPerson = alias(people, 'jmail_author')
const supPerson = alias(people, 'jmail_sup')

function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function sendJournalEntryEmail(ctx: RequestContext, entryId: string): Promise<number> {
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
      .where(eq(journalEntries.id, entryId))
      .limit(1)
    if (!e) return null

    const recip = await tx
      .select({ email: users.email })
      .from(tenantNotificationRecipients)
      .innerJoin(users, eq(users.id, tenantNotificationRecipients.userId))
      .where(
        and(
          eq(tenantNotificationRecipients.tenantId, ctx.tenantId),
          eq(tenantNotificationRecipients.category, 'journal'),
        ),
      )
    return { e, recip }
  })
  if (!data) return 0

  const to = Array.from(
    new Set(
      [...data.recip.map((r) => r.email), data.e.supEmail, data.e.authorEmail].filter(
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
      <div style="font-size:14px;line-height:1.6;">${entry.bodyHtml ?? '(no content)'}</div>
    </div>`

  await sendEmail({ to, subject, html, text })
  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: entryId,
    action: 'update',
    summary: `Emailed ${to.length} recipient${to.length === 1 ? '' : 's'}`,
  })
  return to.length
}
