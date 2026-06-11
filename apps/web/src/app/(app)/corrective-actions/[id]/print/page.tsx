import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  orgUnits,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const metadata = { title: 'Corrective action — print' }
export const dynamic = 'force-dynamic'

/**
 * Server-rendered print view. The page is designed for the browser's print
 * dialog: an A4-friendly layout with @page margins, no app chrome, and an
 * inline window.print() trigger button (hidden when printing).
 *
 * Reusing the existing detail-page data shape so the printed copy matches
 * what the user just looked at on screen.
 */
export default async function CorrectiveActionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        ca: correctiveActions,
        site: orgUnits,
        owner: tenantUsers,
        ownerAccount: user,
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(correctiveActions.id, id))
      .limit(1)
    if (!row) return null

    const photos = await tx
      .select({ link: caPhotos, attachment: attachments })
      .from(caPhotos)
      .innerJoin(attachments, eq(attachments.id, caPhotos.attachmentId))
      .where(eq(caPhotos.caId, id))

    const steps = await tx
      .select({
        step: caCompleteSteps,
        byTenantUser: tenantUsers,
        byUser: user,
      })
      .from(caCompleteSteps)
      .leftJoin(tenantUsers, eq(tenantUsers.id, caCompleteSteps.completedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(caCompleteSteps.caId, id))
      .orderBy(asc(caCompleteSteps.entityOrder))

    return { ...row, photos, steps }
  })

  if (!data) notFound()
  const { ca, site, owner, ownerAccount, photos, steps } = data

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'export',
    summary: 'Opened printable view',
    metadata: { format: 'print_html' },
  })

  const ownerLabel = ownerAccount?.name ?? owner?.displayName ?? '—'
  const closed = ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—'
  const verified = ca.verifiedAt ? new Date(ca.verifiedAt).toLocaleString() : null

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{`
        @page { size: Letter; margin: 0.5in; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .pca-shell { max-width: 7.5in; margin: 0 auto; padding: 24px; }
        .pca-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
        .pca-row .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
        .pca-row .val { font-size: 13px; color: #0f172a; }
        .pca-block { margin-top: 18px; }
        .pca-block h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin: 0 0 6px; }
        .pca-text { font-size: 13px; white-space: pre-wrap; color: #0f172a; }
        .pca-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .pca-photo { border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; }
        .pca-photo img { width: 100%; height: 1.4in; object-fit: cover; display: block; }
        .pca-photo .cap { font-size: 10px; color: #475569; padding: 4px 6px; border-top: 1px solid #e2e8f0; }
        .pca-step { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; page-break-inside: avoid; }
        .pca-step .head { display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
        .pca-step .desc { margin-top: 4px; font-size: 12px; color: #0f172a; }
        .pca-step .sig { margin-top: 6px; height: 60px; object-fit: contain; border: 1px solid #e2e8f0; padding: 2px; }
        .pca-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .pca-toolbar a, .pca-toolbar button { background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #0f172a; cursor: pointer; text-decoration: none; }
        .pca-toolbar button { margin-left: 6px; }
        .pca-header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #0f172a; }
        .pca-title { font-size: 18px; font-weight: 700; color: #0f172a; }
        .pca-reference { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; }
        .pca-badges span { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; margin-left: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .pca-sev-critical, .pca-sev-high { background: #fee2e2; color: #7f1d1d; }
        .pca-sev-medium { background: #fef3c7; color: #78350f; }
        .pca-sev-low { background: #e2e8f0; color: #334155; }
        .pca-status-closed { background: #dcfce7; color: #14532d; }
        .pca-status-cancelled { background: #e2e8f0; color: #334155; }
        .pca-status-open, .pca-status-in_progress, .pca-status-pending_verification { background: #fef3c7; color: #78350f; }
        @media print {
          .no-print { display: none !important; }
          .pca-toolbar { display: none; }
          body { background: white; }
        }
      `}</style>
      <div className="pca-toolbar no-print">
        <div>
          <strong>Corrective action — print</strong> · {ca.reference}
        </div>
        <div>
          <a href={`/corrective-actions/${id}`}>Back</a>
          <button type="button" data-print>
            Print
          </button>
        </div>
      </div>
      <div className="pca-shell">
        <header className="pca-header">
          <div>
            <div className="pca-title">{ca.title}</div>
            <div className="pca-reference">
              {ca.reference}
              {ca.assignedOn ? ` · assigned ${ca.assignedOn}` : ''}
            </div>
          </div>
          <div className="pca-badges">
            <span className={`pca-sev-${ca.severity}`}>{ca.severity}</span>
            <span className={`pca-status-${ca.status}`}>{ca.status.replace('_', ' ')}</span>
          </div>
        </header>

        <section className="pca-row">
          <Field label="Severity" value={ca.severity} />
          <Field label="Status" value={ca.status.replace('_', ' ')} />
          <Field label="Site" value={site?.name ?? '—'} />
          <Field label="Owner" value={ownerLabel} />
          <Field label="Source" value={ca.source ?? '—'} />
          <Field label="Source entity" value={ca.sourceEntityType ?? '—'} />
          <Field label="Assigned on" value={ca.assignedOn ?? '—'} />
          <Field label="Due on" value={ca.dueOn ?? '—'} />
          <Field label="Closed on" value={closed} />
          <Field
            label="Cost impact"
            value={ca.costImpact != null ? formatMoney(Number(ca.costImpact)) : '—'}
          />
        </section>

        {ca.description ? (
          <div className="pca-block">
            <h2>Description</h2>
            <p className="pca-text">{ca.description}</p>
          </div>
        ) : null}
        {ca.rootCause ? (
          <div className="pca-block">
            <h2>Root cause</h2>
            <p className="pca-text">{ca.rootCause}</p>
          </div>
        ) : null}
        {ca.actionTaken ? (
          <div className="pca-block">
            <h2>Action taken</h2>
            <p className="pca-text">{ca.actionTaken}</p>
          </div>
        ) : null}
        {ca.verificationRequired ? (
          <div className="pca-block">
            <h2>Verification</h2>
            {verified ? (
              <p className="pca-text">
                Signed off on {verified}.{ca.verificationNotes ? `\n\n${ca.verificationNotes}` : ''}
              </p>
            ) : (
              <p className="pca-text">Verification required but not yet signed.</p>
            )}
          </div>
        ) : null}

        {photos.length > 0 ? (
          <div className="pca-block">
            <h2>Photos ({photos.length})</h2>
            <div className="pca-photos">
              {photos.map((p) => (
                <div key={p.link.id} className="pca-photo">
                  <img
                    src={publicUrl(p.attachment.r2Key)}
                    alt={p.link.caption ?? p.attachment.filename}
                  />
                  {p.link.caption ? <div className="cap">{p.link.caption}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className="pca-block">
            <h2>Complete-action timeline ({steps.length})</h2>
            {steps.map((s) => {
              const name = s.byUser?.name ?? s.byTenantUser?.displayName ?? 'unknown'
              return (
                <div key={s.step.id} className="pca-step">
                  <div className="head">
                    <strong>{s.step.kind.replace('_', ' ')}</strong>
                    <span>
                      {s.step.completedAt.toLocaleString()} · {name}
                    </span>
                  </div>
                  {s.step.description ? <div className="desc">{s.step.description}</div> : null}
                  {s.step.signatureDataUrl ? (
                    <img className="sig" src={s.step.signatureDataUrl} alt="Signature" />
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
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

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}
