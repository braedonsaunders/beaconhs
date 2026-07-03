import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  orgUnits,
  people,
  safeDistanceRecords,
  safeDistanceSegments,
  tenants,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  distanceUnitLabel,
  formatDistance,
  formatPressure,
  formatVolume,
  SAFE_DISTANCE_METHOD_LABELS,
  SAFE_DISTANCE_METHOD_SUBTITLES,
  SEGMENT_UNIT_LABELS,
  volumeUnitLabel,
  type SafeDistanceMethod,
  type SafeDistanceSegmentUnit,
  type SafeDistanceUnit,
} from '../../_lib'

export const metadata = { title: 'Safe Distance — print' }
export const dynamic = 'force-dynamic'

const M3_TO_FT3 = 35.3147

/**
 * Print/PDF-friendly view of one pressure-test record. Renders the system,
 * the three method results (chosen one highlighted), and the pipe schedule.
 * The app shell is hidden by @media print so "Save as PDF" picks up only the
 * assessment content.
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
      .where(and(eq(safeDistanceRecords.id, id), isNull(safeDistanceRecords.deletedAt)))
      .limit(1)
    if (!row) return null
    const segments = await tx
      .select()
      .from(safeDistanceSegments)
      .where(eq(safeDistanceSegments.recordId, id))
      .orderBy(asc(safeDistanceSegments.sortOrder))
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, row.rec.tenantId))
      .limit(1)
    return { ...row, segments, tenant }
  })
  if (!detail) notFound()
  const { rec, site, supervisor, supervisorUser, operator, segments, tenant } = detail

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'export',
    summary: 'Opened printable view',
    metadata: { format: 'print_html' },
  })

  const unit = rec.unit as SafeDistanceUnit
  const method = rec.method as SafeDistanceMethod
  const chosen =
    method === 'nasa' ? rec.resultNasa : method === 'asme' ? rec.resultAsme : rec.resultLloyds
  const supervisorLabel = supervisorUser?.name ?? supervisor?.displayName ?? '—'
  const operatorLabel = operator
    ? `${operator.lastName ?? ''}${operator.lastName ? ', ' : ''}${operator.firstName ?? ''}`.trim() ||
      '—'
    : '—'
  const volUnit = volumeUnitLabel(unit)

  const methods: Array<{ key: SafeDistanceMethod; value: string }> = [
    { key: 'nasa', value: rec.resultNasa },
    { key: 'asme', value: rec.resultAsme },
    { key: 'lloyds', value: rec.resultLloyds },
  ]

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
        .psd-results { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
        .psd-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
        .psd-card.chosen { border-color: #0f766e; background: #f0fdfa; box-shadow: inset 0 0 0 1px #0f766e; }
        .psd-card .k { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
        .psd-card .s { font-size: 9px; color: #94a3b8; }
        .psd-card .v { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px; }
        table.psd-pipes { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
        table.psd-pipes th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 4px 6px; }
        table.psd-pipes td { border-bottom: 1px solid #eef2f6; padding: 4px 6px; color: #0f172a; }
        .psd-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .psd-toolbar a, .psd-toolbar button { background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #0f172a; cursor: pointer; text-decoration: none; }
        .psd-toolbar button { margin-left: 6px; }
        .psd-header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #0f766e; }
        .psd-title { font-size: 18px; font-weight: 700; color: #0f172a; }
        .psd-reference { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; }
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
            <div className="psd-title">Pressure-Test Safe Distance</div>
            <div className="psd-reference">
              {tenant?.name ?? ''} · {rec.reference} · {rec.name}
            </div>
          </div>
        </header>

        <section className="psd-row">
          <Field label="Method" value={SAFE_DISTANCE_METHOD_LABELS[method]} />
          <Field label="Test pressure" value={formatPressure(rec.testPressure, unit)} />
          <Field label="Total volume" value={formatVolume(rec.totalVolume, unit)} />
          <Field
            label="Governing distance"
            value={<strong>{formatDistance(chosen, unit)}</strong>}
          />
          <Field
            label="Occurred"
            value={
              rec.occurredAt
                ? new Date(rec.occurredAt).toISOString().slice(0, 16).replace('T', ' ')
                : '—'
            }
          />
          <Field label="Site" value={site?.name ?? '—'} />
          <Field label="Supervisor" value={supervisorLabel} />
          <Field label="Operator" value={operatorLabel} />
          <Field label="Locked" value={rec.locked ? 'Yes' : 'No'} />
        </section>

        <div className="psd-block">
          <h2>Results by method ({distanceUnitLabel(unit)})</h2>
          <div className="psd-results">
            <div className="psd-card">
              <div className="k">Total volume</div>
              <div className="s">System</div>
              <div className="v">{formatVolume(rec.totalVolume, unit)}</div>
            </div>
            {methods.map((m) => (
              <div key={m.key} className={`psd-card${m.key === method ? 'chosen' : ''}`}>
                <div className="k">{SAFE_DISTANCE_METHOD_LABELS[m.key]}</div>
                <div className="s">{SAFE_DISTANCE_METHOD_SUBTITLES[m.key]}</div>
                <div className="v">{formatDistance(m.value, unit)}</div>
              </div>
            ))}
          </div>
        </div>

        {segments.length > 0 ? (
          <div className="psd-block">
            <h2>Piping system</h2>
            <table className="psd-pipes">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Length</th>
                  <th>Int. Ø</th>
                  <th>Volume ({volUnit})</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => {
                  const volM3 = Number(s.volumeM3) || 0
                  const volDisplay = unit === 'imperial' ? volM3 * M3_TO_FT3 : volM3
                  return (
                    <tr key={s.id}>
                      <td>{i + 1}</td>
                      <td>{s.name ?? '—'}</td>
                      <td>{SEGMENT_UNIT_LABELS[s.unit as SafeDistanceSegmentUnit]}</td>
                      <td>{Number(s.lengthValue).toFixed(3)}</td>
                      <td>{Number(s.internalDiameter).toFixed(3)}</td>
                      <td>{volDisplay.toFixed(4)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {rec.description ? (
          <div className="psd-block">
            <h2>Description</h2>
            <p className="psd-text">{rec.description}</p>
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
