'use server'

// Server compile for a one-off "design" email authored directly on a send_email
// flow node (mode='design'). Same authoritative MJML→sanitized-HTML path as the
// template library; the node stores the compiled HTML so the send path does no
// MJML work. Gated to flow authors (forms.template.create OR any module manager).

import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { MODULE_FLOW_PROFILES } from '@/lib/flows/module-profiles'
import { compileBuilderHtml } from '@/lib/email-templates'

export async function compileEmailDesign(
  mjmlSource: string,
): Promise<{ ok: boolean; html?: string; warnings?: string[]; error?: string }> {
  const ctx = await requireRequestContext()
  const mayAuthor =
    ctx.isSuperAdmin ||
    can(ctx, 'forms.template.create') ||
    Object.keys(MODULE_FLOW_PROFILES).some((m) => canManageModule(ctx, m))
  if (!mayAuthor) return { ok: false, error: 'Not authorized' }
  const { html, errors } = compileBuilderHtml(mjmlSource)
  return { ok: true, html, warnings: errors }
}
