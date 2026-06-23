import 'server-only'

// Shared helpers for the email-template library: RLS-bound reads used by BOTH
// the Flows runner (send_email mode='template') and the admin builder, plus the
// server-side MJML compile (the ONLY place MJML runs — at save time, never on
// the hot send path).

import { and, asc, eq, isNull } from 'drizzle-orm'
import mjml2html from 'mjml'
import { emailTemplates, type EmailTemplate } from '@beaconhs/db/schema'
import { sanitizeEmailHtml } from '@beaconhs/email-render'
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
}

export async function listActiveEmailTemplates(
  ctx: RequestContext,
): Promise<EmailTemplateOption[]> {
  return ctx.db((tx) =>
    tx
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        key: emailTemplates.key,
        category: emailTemplates.category,
      })
      .from(emailTemplates)
      .where(and(isNull(emailTemplates.deletedAt), eq(emailTemplates.isActive, true)))
      .orderBy(asc(emailTemplates.name)),
  )
}

/**
 * Compile MJML source → responsive, sanitized HTML. The authoritative compile —
 * the client builder's in-canvas compile is preview only. `mjml2html` is sync.
 */
export function compileEmailMjml(mjmlSource: string): { html: string; errors: string[] } {
  if (!mjmlSource.trim()) return { html: '', errors: [] }
  try {
    const out = mjml2html(mjmlSource, { validationLevel: 'soft' })
    const errors = (out.errors ?? []).map((e) => e.formattedMessage || e.message || 'MJML error')
    return { html: sanitizeEmailHtml(out.html || ''), errors }
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
