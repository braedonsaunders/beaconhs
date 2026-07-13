// Generic "email a recap on submit" for any form template that has
// emailOnSubmit = true. Generalizes the old toolbox recap: renders the
// response's key fields + attendee sign-in list and sends it to the tenant's
// notification recipients (by category / module binding), falling back to
// active tenant members.

import { eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { resolveNotificationAudienceEmails } from '@beaconhs/events'
import { enqueueEmail } from '@beaconhs/jobs'
import {
  formResponseParticipants,
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  type FormField,
  type FormSchemaV1,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function label(field: FormField): string {
  const l = field.label as Record<string, string> | undefined
  return l?.en ?? field.id
}

// Render a scalar field value to a short string. Pickers/media/signatures are
// handled elsewhere (attendees list) or skipped to avoid leaking raw ids.
function formatScalar(field: FormField, value: unknown): string | null {
  if (value == null || value === '') return null
  switch (field.type) {
    case 'text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'date':
    case 'datetime':
    case 'time':
    case 'number':
    case 'radio':
    case 'select':
      return String(value)
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'yes_no_comment':
      return (value as { answer?: string })?.answer ?? null
    default:
      return null // pickers, media, signature, display, computed
  }
}

export async function sendFormResponseRecapEmail(
  ctx: RequestContext,
  responseId: string,
  executionId?: string,
): Promise<number> {
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
        templateName: formTemplates.name,
        category: formTemplates.category,
        moduleBinding: formTemplates.moduleBinding,
        emailOnSubmit: formTemplates.emailOnSubmit,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(eq(formResponses.id, responseId))
      .limit(1)
    if (!row || !row.emailOnSubmit) return null

    // Recipients: configured for the template's category / module binding…
    const categories = [row.category, row.moduleBinding].filter((c): c is string => !!c)
    const recip = [
      ...new Set(
        (
          await Promise.all(
            (categories.length > 0 ? categories : ['forms']).map((category) =>
              resolveNotificationAudienceEmails(tx, ctx.tenantId, category),
            ),
          )
        ).flat(),
      ),
    ]

    const parts = await tx
      .select({
        first: people.firstName,
        last: people.lastName,
        signed: formResponseParticipants.signed,
      })
      .from(formResponseParticipants)
      .innerJoin(people, eq(people.id, formResponseParticipants.personId))
      .where(eq(formResponseParticipants.responseId, responseId))

    // Resolve a site name if a site_picker is present.
    const schema = row.schema as FormSchemaV1
    let siteName: string | null = null
    for (const section of schema.sections) {
      if (section.repeating) continue
      const siteField = section.fields.find((f) => f.type === 'site_picker')
      if (siteField) {
        const siteId = row.response.data[siteField.id]
        if (typeof siteId === 'string' && siteId) {
          const [site] = await tx
            .select({ name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.id, siteId))
            .limit(1)
          siteName = site?.name ?? null
        }
        break
      }
    }

    return { row, recip, parts, schema, siteName }
  })
  if (!data) return 0

  const to = data.recip
  if (to.length === 0) return 0

  const { row, parts, schema, siteName } = data
  const date = row.response.submittedAt ? row.response.submittedAt.toISOString().slice(0, 10) : ''
  const subject = `${row.templateName}${date ? ` · ${date}` : ''}`
  const signedCount = parts.filter((p) => p.signed).length

  // Detail rows: top-level scalar fields, in schema order.
  const detailRows: Array<{ label: string; value: string }> = []
  for (const section of schema.sections) {
    if (section.repeating) continue
    for (const field of section.fields) {
      const v = formatScalar(field, row.response.data[field.id])
      if (v) detailRows.push({ label: label(field), value: v })
    }
  }

  const attendeeNames = parts.map(
    (p) => `${p.last ?? ''}${p.last ? ', ' : ''}${p.first ?? ''}`.trim() || '(unnamed)',
  )

  const text = [
    row.templateName,
    '',
    siteName ? `Site: ${siteName}` : '',
    ...detailRows.map((d) => `${d.label}: ${d.value}`),
    '',
    parts.length ? `Attendees: ${parts.length} (${signedCount} signed)` : '',
    ...parts.map((p, i) => `  - ${attendeeNames[i]}${p.signed ? ' (signed)' : ''}`),
  ]
    .filter((l) => l !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;">
      <h2 style="margin:0 0 4px">${esc(row.templateName)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px;">
        ${esc(date)}${siteName ? ` · ${esc(siteName)}` : ''}
      </div>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        ${detailRows
          .map(
            (d) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;">${esc(
                d.label,
              )}</td><td style="padding:4px 0;white-space:pre-wrap;">${esc(d.value)}</td></tr>`,
          )
          .join('\n')}
      </table>
      ${
        parts.length
          ? `<h3 style="margin:18px 0 4px;font-size:14px;">Attendees (${parts.length}, ${signedCount} signed)</h3>
        <ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">
          ${parts
            .map(
              (p, i) =>
                `<li>${esc(attendeeNames[i])}${
                  p.signed ? ' <span style="color:#15803d;">(signed)</span>' : ''
                }</li>`,
            )
            .join('\n')}
        </ul>`
          : ''
      }
    </div>`

  await enqueueEmail(
    {
      to,
      subject,
      html,
      text,
      meta: { tenantId: ctx.tenantId, category: row.category ?? 'forms' },
    },
    executionId
      ? {
          jobId: `form-recap|${createHash('sha256').update(executionId).digest('hex')}`,
        }
      : undefined,
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    dedupKey: executionId ? `domain:${executionId}:form-recap` : undefined,
    summary: `Emailed recap to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
  })
  return to.length
}
