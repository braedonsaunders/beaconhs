import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  orgUnits,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { RawImage } from '@/components/raw-image'
import { BrowserPrintButton } from '@/components/browser-print-controls'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_04ba5913c02057') }
}
export const dynamic = 'force-dynamic'

/**
 * Server-rendered print view. The page is designed for the browser's print
 * dialog: an A4-friendly layout with @page margins, no app chrome, and an
 * browser print trigger button (hidden when printing).
 *
 * Reusing the existing detail-page data shape so the printed copy matches
 * what the user just looked at on screen.
 */
export default async function CorrectiveActionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

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
      .where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt)))
      .limit(1)
    if (!row) return null

    // Re-scope to the caller's read tier: a self/site-tier user must not be
    // able to pull a printable copy by guessing the id (mirrors the detail
    // page + PDF route's canSeeRecord check).
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [row.ca.ownerTenantUserId],
      siteId: row.ca.siteOrgUnitId,
    })
    if (!visible) return null

    const photos = await tx
      .select({ link: caPhotos, attachment: attachments })
      .from(caPhotos)
      .innerJoin(attachments, eq(attachments.id, caPhotos.attachmentId))
      .where(eq(caPhotos.caId, id))
      .orderBy(asc(caPhotos.sortOrder), asc(caPhotos.createdAt), asc(caPhotos.id))

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
  const closed = ca.closedAt ? formatDate(new Date(ca.closedAt), ctx.timezone, ctx.locale) : '—'
  const verified = ca.verifiedAt
    ? formatDateTime(new Date(ca.verifiedAt), ctx.timezone, ctx.locale)
    : null

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
          <strong>
            <GeneratedText id="m_04ba5913c02057" />
          </strong>{' '}
          · <GeneratedValue value={ca.reference} />
        </div>
        <div>
          <a href={`/corrective-actions/${id}`}>
            <GeneratedText id="m_1a7cefe5a9894e" />
          </a>
          <BrowserPrintButton />
        </div>
      </div>
      <div className="pca-shell">
        <header className="pca-header">
          <div>
            <div className="pca-title">
              <GeneratedValue value={ca.title} />
            </div>
            <div className="pca-reference">
              <GeneratedValue value={ca.reference} />
              <GeneratedValue
                value={
                  ca.assignedOn ? (
                    <GeneratedText id="m_11e1e757b227bf" values={{ value0: ca.assignedOn }} />
                  ) : (
                    ''
                  )
                }
              />
            </div>
          </div>
          <div className="pca-badges">
            <span className={`pca-sev-${ca.severity}`}>
              <GeneratedValue value={ca.severity} />
            </span>
            <span className={`pca-status-${ca.status}`}>
              <GeneratedValue value={ca.status.replace('_', ' ')} />
            </span>
          </div>
        </header>

        <section className="pca-row">
          <Field label={tGenerated('m_168b365cc671bf')} value={ca.severity} />
          <Field label={tGenerated('m_0b9da892d6faf0')} value={ca.status.replace('_', ' ')} />
          <Field label={tGenerated('m_020146dd3d3d5a')} value={site?.name ?? '—'} />
          <Field label={tGenerated('m_09e0cae12d3f44')} value={ownerLabel} />
          <Field label={tGenerated('m_1d05fa7a091a9b')} value={ca.source ?? '—'} />
          <Field label={tGenerated('m_1b26f5ee6637e3')} value={ca.sourceEntityType ?? '—'} />
          <Field label={tGenerated('m_1e9e6bca0bc9ef')} value={ca.assignedOn ?? '—'} />
          <Field label={tGenerated('m_04bfc1eaee3a4b')} value={ca.dueOn ?? '—'} />
          <Field label={tGenerated('m_01381607e25f0d')} value={closed} />
          <Field
            label={tGenerated('m_08d00ceb0352a5')}
            value={ca.costImpact != null ? formatMoney(Number(ca.costImpact), ctx.locale) : '—'}
          />
        </section>

        <GeneratedValue
          value={
            ca.description ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_14d923495cf14c" />
                </h2>
                <p className="pca-text">
                  <GeneratedValue value={ca.description} />
                </p>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            ca.rootCause ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_0e04308a7a3472" />
                </h2>
                <p className="pca-text">
                  <GeneratedValue value={ca.rootCause} />
                </p>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            ca.actionTaken ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_0da1a29f41377e" />
                </h2>
                <p className="pca-text">
                  <GeneratedValue value={ca.actionTaken} />
                </p>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            ca.verificationRequired ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_06bd85b54c842c" />
                </h2>
                <GeneratedValue
                  value={
                    verified ? (
                      <p className="pca-text">
                        <GeneratedText id="m_1b033ae6d49f3e" /> <GeneratedValue value={verified} />.
                        <GeneratedValue
                          value={ca.verificationNotes ? `\n\n${ca.verificationNotes}` : ''}
                        />
                      </p>
                    ) : (
                      <p className="pca-text">
                        <GeneratedText id="m_0a8994d515cb9e" />
                      </p>
                    )
                  }
                />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            photos.length > 0 ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_052a8b20b5c2e1" />
                  <GeneratedValue value={photos.length} />)
                </h2>
                <div className="pca-photos">
                  <GeneratedValue
                    value={photos.map((p) => (
                      <div key={p.link.id} className="pca-photo">
                        <RawImage
                          src={attachmentUrl(p.attachment.id)}
                          alt={tGeneratedValue(p.link.caption ?? p.attachment.filename)}
                          optimizationReason="authenticated"
                        />
                        <GeneratedValue
                          value={
                            p.link.caption ? (
                              <div className="cap">
                                <GeneratedValue value={p.link.caption} />
                              </div>
                            ) : null
                          }
                        />
                      </div>
                    ))}
                  />
                </div>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            steps.length > 0 ? (
              <div className="pca-block">
                <h2>
                  <GeneratedText id="m_10cc7c63c68b30" />
                  <GeneratedValue value={steps.length} />)
                </h2>
                <GeneratedValue
                  value={steps.map((s) => {
                    const name = s.byUser?.name ?? s.byTenantUser?.displayName ?? 'unknown'
                    return (
                      <div key={s.step.id} className="pca-step">
                        <div className="head">
                          <strong>
                            <GeneratedValue value={s.step.kind.replace('_', ' ')} />
                          </strong>
                          <span>
                            <GeneratedValue
                              value={formatDateTime(
                                new Date(s.step.completedAt),
                                ctx.timezone,
                                ctx.locale,
                              )}
                            />{' '}
                            ·<GeneratedValue value={' '} />
                            <GeneratedValue value={name} />
                          </span>
                        </div>
                        <GeneratedValue
                          value={
                            s.step.description ? (
                              <div className="desc">
                                <GeneratedValue value={s.step.description} />
                              </div>
                            ) : null
                          }
                        />
                        <GeneratedValue
                          value={
                            s.step.signatureAttachmentId ? (
                              <RawImage
                                className="sig"
                                src={attachmentUrl(s.step.signatureAttachmentId)}
                                alt={tGenerated('m_0c0bc02db58371')}
                                optimizationReason="authenticated"
                              />
                            ) : null
                          }
                        />
                      </div>
                    )
                  })}
                />
              </div>
            ) : null
          }
        />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="lbl">
        <GeneratedValue value={label} />
      </div>
      <div className="val">
        <GeneratedValue value={value} />
      </div>
    </div>
  )
}

function formatMoney(n: number, locale: string): string {
  return n.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}
