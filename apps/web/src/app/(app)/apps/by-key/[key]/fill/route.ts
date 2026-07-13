// GET /apps/by-key/:key/fill
//
// Stable deep-link for a built-in form by its per-tenant key (e.g.
// 'toolbox-talk'), without callers needing the per-tenant template id.
// Resolves the template and lands on the native-style records list; users start
// a new entry there via the prefetch-safe server action.

import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { formTemplates } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { templateAccessWhere } from '@/app/(app)/apps/_lib/access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }
  if (!can(ctx, 'forms.response.create')) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  const id = await ctx.db(async (tx) => {
    const [t] = await tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(
        and(eq(formTemplates.key, key), templateAccessWhere(ctx, effectiveRoleKeys, 'operate')),
      )
      .limit(1)
    return t?.id ?? null
  })
  if (!id) {
    return NextResponse.json({ error: `No form template with key "${key}"` }, { status: 404 })
  }
  return NextResponse.redirect(new URL(`/apps/templates/${id}/records`, req.url), { status: 307 })
}
