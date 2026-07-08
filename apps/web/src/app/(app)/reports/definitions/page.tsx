// The report library merged into the /reports hub (master-detail catalogue +
// live print preview). This route survives only to keep old links working —
// child routes ([id], new) are unaffected.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ReportLibraryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const key of ['q', 'kind', 'category'] as const) {
    const v = sp[key]
    if (typeof v === 'string' && v) qs.set(key, v)
  }
  const s = qs.toString()
  redirect(s ? `/reports?${s}` : '/reports')
}
