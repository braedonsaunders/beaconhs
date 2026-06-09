// GET /forms/by-key/:key/fill
//
// Stable deep-link to start a new response for a built-in form by its per-tenant
// key (e.g. 'toolbox-talk'), without callers needing the per-tenant template id.
// Resolves the template and 307-redirects to its filler.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

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
  const id = await ctx.db(async (tx) => {
    const [t] = await tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(eq(formTemplates.key, key))
      .limit(1)
    return t?.id ?? null
  })
  if (!id) {
    return NextResponse.json({ error: `No form template with key "${key}"` }, { status: 404 })
  }
  return NextResponse.redirect(new URL(`/forms/templates/${id}/fill`, req.url), { status: 307 })
}
