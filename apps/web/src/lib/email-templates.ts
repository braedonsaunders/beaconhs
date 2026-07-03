import 'server-only'

// Shared helpers for the email-template library: RLS-bound reads used by BOTH
// the Flows runner (send_email mode='template') and the admin builder, plus the
// server-side compile (the ONLY place compile runs — at save time, never on the
// hot send path). The builder emits plain inline-styled HTML (no MJML); compile
// = expand data-each/data-if markers → {{#each}}/{{#if}}, then sanitize.

import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { emailTemplates, type EmailTemplate } from '@beaconhs/db/schema'
import { expandRepeatMarkers, sanitizeEmailHtml } from '@beaconhs/email-render'
import type { RequestContext } from '@beaconhs/tenant'

export async function loadTenantEmailTemplate(
  ctx: RequestContext,
  id: string,
): Promise<EmailTemplate | null> {
  const [t] = await ctx.db((tx) =>
    tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
      .limit(1),
  )
  return t ?? null
}

export type EmailTemplateOption = {
  id: string
  name: string
  key: string
  category: string
  recordSubjectType: string | null
  recordSubjectKey: string | null
}

const EMAIL_TEMPLATE_OPTION_COLS = {
  id: emailTemplates.id,
  name: emailTemplates.name,
  key: emailTemplates.key,
  category: emailTemplates.category,
  recordSubjectType: emailTemplates.recordSubjectType,
  recordSubjectKey: emailTemplates.recordSubjectKey,
} as const

/**
 * Active templates relevant to a flow's subject: those authored FOR this exact
 * record type, plus generic (untyped) templates that work with any subject.
 */
export async function listActiveEmailTemplatesForSubject(
  ctx: RequestContext,
  subjectType: string,
  subjectKey: string,
): Promise<EmailTemplateOption[]> {
  return ctx.db((tx) =>
    tx
      .select(EMAIL_TEMPLATE_OPTION_COLS)
      .from(emailTemplates)
      .where(
        and(
          isNull(emailTemplates.deletedAt),
          eq(emailTemplates.isActive, true),
          or(
            isNull(emailTemplates.recordSubjectType),
            and(
              eq(emailTemplates.recordSubjectType, subjectType),
              eq(emailTemplates.recordSubjectKey, subjectKey),
            ),
          ),
        ),
      )
      .orderBy(asc(emailTemplates.name)),
  )
}

/**
 * Compile the plain-HTML email builder's output → send-ready HTML. The builder
 * runs in HTML mode (not MJML) so its tables stay editable; here we expand the
 * `data-each` / `data-if` row markers into `{{#each}}` / `{{#if}}` blocks, then
 * sanitize. No MJML — the builder emits inline-styled, email-ready HTML.
 */
export function compileBuilderHtml(sourceHtml: string): { html: string; errors: string[] } {
  if (!sourceHtml.trim()) return { html: '', errors: [] }
  try {
    return { html: sanitizeEmailHtml(expandRepeatMarkers(sourceHtml)), errors: [] }
  } catch (e) {
    return { html: '', errors: [e instanceof Error ? e.message : String(e)] }
  }
}

export function slugifyTemplateKey(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'template'
  )
}
