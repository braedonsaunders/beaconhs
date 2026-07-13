'use server'

import { revalidatePath } from 'next/cache'
import { enqueueScheduled } from '@beaconhs/jobs'
import { MAINTENANCE_TABLES, type DbTableSetting } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { saveDbMaintenanceRetention } from '@/lib/db-maintenance-config'

// Authorization is also enforced by /platform/layout.tsx (super-admin only); the
// per-action gate is defence in depth for these deployment-wide mutations.
function gatePlatform(ctx: RequestContext) {
  if (!ctx.isSuperAdmin)
    throw new Error('Only platform super-admins can change database maintenance settings.')
}

// Parse one retention window per maintained table from the form. Each input is
// named `retention_<table>`; blank, "never", or "0" → null (keep forever);
// otherwise a positive whole number of days. Unknown/garbage values keep forever.
function parseRetention(fd: FormData): Record<string, DbTableSetting> {
  const tables: Record<string, DbTableSetting> = {}
  for (const t of MAINTENANCE_TABLES) {
    const raw = String(fd.get(`retention_${t.table}`) ?? '').trim()
    if (raw === '' || raw.toLowerCase() === 'never' || raw === '0') {
      tables[t.table] = { retentionDays: null }
      continue
    }
    const n = Number(raw)
    tables[t.table] = {
      retentionDays: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
    }
  }
  return tables
}

export async function savePlatformDatabase(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const tables = parseRetention(formData)
  await saveDbMaintenanceRetention(tables)
  await recordAudit(ctx, {
    entityType: 'platform',
    action: 'update',
    summary: 'Updated database maintenance retention windows',
    metadata: {
      tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.retentionDays])),
    },
  })
  revalidatePath('/platform/database')
}

export async function runMaintenanceNow(): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  await enqueueScheduled(
    'manual:db_maintenance',
    { kind: 'db_maintenance', trigger: 'manual' },
    { jobId: `manual:db_maintenance:${Date.now()}` },
  )
  await recordAudit(ctx, {
    entityType: 'platform',
    action: 'update',
    summary: 'Triggered a manual database maintenance run',
  })
  revalidatePath('/platform/database')
  return {
    ok: true,
    message: 'Maintenance run queued. Results appear under Last run once it finishes.',
  }
}
