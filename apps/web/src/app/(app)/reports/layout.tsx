import { GeneratedValue } from '@/i18n/generated'
// Gate the whole /reports area in one place. The nav already hides it for users
// without a reports permission, but the pages loaded org-wide report data with no
// page-level check — a self-only user hitting the URL directly got in. Any
// reports permission (read / builder / schedule) grants the area; everyone else
// is redirected to their personal dashboard. Mirrors the /insights gate.

import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import '@beaconhs/reports/styles.css'

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireRequestContext()
  const allowed =
    ctx.isSuperAdmin ||
    can(ctx, 'reports.read') ||
    can(ctx, 'reports.builder') ||
    can(ctx, 'reports.schedule')
  if (!allowed) redirect('/dashboard')
  return (
    <>
      <GeneratedValue value={children} />
    </>
  )
}
