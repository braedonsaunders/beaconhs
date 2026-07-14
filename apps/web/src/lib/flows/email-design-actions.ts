'use server'

// Server compile for a one-off "design" email authored directly on a send_email
// flow node (mode='design'). Same authoritative source→sanitized-HTML path as the
// template library; the node stores the compiled HTML so the send path does no
// HTML compilation. Gated to flow authors (forms.template.create OR any module manager).

import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { MODULE_FLOW_PROFILES } from '@/lib/flows/module-profiles'
import { compileBuilderHtml } from '@/lib/template-builder-compile'

export async function compileEmailDesign(
  sourceHtml: string,
): Promise<{ ok: boolean; html?: string; sourceHtml?: string; error?: string }> {
  const ctx = await requireRequestContext()
  const mayAuthor =
    ctx.isSuperAdmin ||
    can(ctx, 'forms.template.create') ||
    Object.keys(MODULE_FLOW_PROFILES).some((m) => canManageModule(ctx, m))
  if (!mayAuthor) return { ok: false, error: 'Not authorized' }
  if (typeof sourceHtml !== 'string' || sourceHtml.length > 512_000) {
    return { ok: false, error: 'Email design is invalid or too large' }
  }
  if (!sourceHtml.trim()) return { ok: false, error: 'Email design cannot be empty' }
  const compiled = compileBuilderHtml(sourceHtml)
  if (compiled.errors.length > 0 || !compiled.html || !compiled.sanitizedSource) {
    return { ok: false, error: compiled.errors[0] ?? 'Email design could not be compiled' }
  }
  return { ok: true, html: compiled.html, sourceHtml: compiled.sanitizedSource }
}
