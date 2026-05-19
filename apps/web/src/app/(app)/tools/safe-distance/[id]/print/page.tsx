import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  orgUnits,
  people,
  safeDistanceRecords,
  tenants,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  formatDistance,
  formatVoltage,
  SAFE_DISTANCE_TYPE_LABELS,
  type SafeDistanceType,
} from '../../_lib'

export const metadata = { title: 'Safe Distance — print' }
export const dynamic = 'force-dynamic'

/**
 * Print/PDF-friendly view of one safe-distance record. Renders inside the app
 * shell but the shell is hidden by the @media print rules so the browser's
 * "Save as PDF" picks up only the assessment content. Mirrors the
 * corrective-actions print page so the styling stays consistent across modules.
 */
export default async function SafeDistancePrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const detail = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        rec: safeDistanceRecords,
        site: orgUnits,
        supervisor: tenantUsers,
        supervisorUser: user,
        operator: people,
      })
      .from(safeDistanceRecords)
      .leftJoin(orgUnits, eq(orgUnits.id, safeDistanceRecords.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, safeDistanceRecords.supervisorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, safeDistanceRecords.operatorPersonId))
      .where(eq(safeDistanceRecords.id, id))
      .limit(1)
    if (!row) return null
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, row.rec.tenantId))
      .limit(1)
    return { ...row, tenant }
  })
  if (!detail) notFound()
  const { rec, site, supervisor, supervisorUser, operator, tenant } = detail

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'export',
    summary: 'Opened printable view',
    metadata: { format: 'print_html' },
  })

  const supervisorLabel = supervisorUser?.name ?? supervisor?.displayName ?? '—'
  const operatorLabel = operator
    ? `${operator.lastName ?? ''}${operator.lastName ? ', ' : ''}${operator.firstName ?? ''}`.trim() ||
      '—'
    : '—'

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{`
        @page { size: Letter; margin: 0.5in; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .psd-shell { max-width: 7.5in; margin: 0 auto; padding: 24px; }
        .psd-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
        .psd-row .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
        .psd-row .val { font-size: 13px; color: #0f172a; }
        .psd-block { margin-top: 18px; }
        .psd-block h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin: 0 0 6px; }
        .psd-text { font-size: 13px; white-space: pre-wrap; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; border-radius: 4px; }
        .psd-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .psd-toolbar a, .psd-toolbar button { background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #0f172a; cursor: pointer; text-decoration: none; }
        .psd-toolbar button { margin-left: 6px; }
        .psd-header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #0f766e; }
        .psd-title { font-size: 18px; font-weight: 700; color: #0f172a; }
        .psd-reference { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; }
        .psd-badges span { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; margin-left: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .psd-ok { background: #dcfce7; color: #166534; }
        .psd-bad { background: #fee2e2; color: #991b1b; }
        .psd-sig { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 36px; }
        .psd-sig-line { border-top: 1px solid #94a3b8; margin-top: 64px; padding-top: 4px; font-size: 11px; color: #64748b; }
        @media print {
          .no-print { display: none !important; }
          .psd-toolbar { display: none; }
          body { background: white; }
        }
      `}</style>

      <div className="psd-toolbar no-print">
        <div>
          <strong>Safe Distance — print</strong> · {rec.reference}
        </div>
        <div>
          <a href={`/tools/safe-distance/${id}`}>Back</a>
          <button type="button" data-print>
            Print
          </button>
        </div>
      </div>

      <div className="psd-shell">
        <header className="psd-header">
          <div>
            <div className="psd-title">Safe Distance Assessment</div>
            <div className="psd-reference">
              {tenant?.name ?? ''} · {rec.reference}
            </div>
          </div>
          <div className="psd-badges">
            {rec.complies ? (
              <span className="psd-ok">Compliant</span>
            ) : (
              <span className="psd-bad">Non-compliant</span>
            )}
          </div>
        </header>

        <section className="psd-row">
          <Field
            label="Type"
            value={SAFE_DISTANCE_TYPE_LABELS[rec.type as SafeDistanceType]}
          />
          <Field
            label="Occurred"
            value={
              rec.occurredAt
                ? new Date(rec.occurredAt).toISOString().slice(0, 16).replace('T', ' ')
                : '—'
            }
          />
          <Field label="Source voltage" value={formatVoltage(rec.sourceVoltageKv)} />
          <Field label="Operating height" value={formatDistance(rec.heightM)} />
          <Field
            label="Required distance"
            value={<strong>{formatDistance(rec.requiredDistanceM)}</strong>}
          />
          <Field
            label="Actual distance"
            value={<strong>{formatDistance(rec.actualDistanceM)}</strong>}
          />
          <Field label="Site" value={site?.name ?? '—'} />
          <Field label="Supervisor" value={supervisorLabel} />
          <Field label="Operator" value={operatorLabel} />
          <Field label="Locked" value={rec.locked ? 'Yes' : 'No'} />
        </section>

        {rec.sourceDescription ? (
          <div className="psd-block">
            <h2>Source description</h2>
            <p className="psd-text">{rec.sourceDescription}</p>
          </div>
        ) : null}

        {rec.notes ? (
          <div className="psd-block">
            <h2>Notes</h2>
            <p className="psd-text">{rec.notes}</p>
          </div>
        ) : null}

        <div className="psd-sig">
          <div>
            <div className="psd-sig-line">Operator signature</div>
          </div>
          <div>
            <div className="psd-sig-line">Supervisor signature</div>
          </div>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `document.addEventListener('click', (e) => {
            const t = e.target instanceof Element ? e.target : null;
            if (t && t.closest('[data-print]')) window.print();
          });`,
        }}
      />
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
    </div>
  )
}
