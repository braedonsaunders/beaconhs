// Server-rendered print-styled HTML page. The browser is the "PDF engine":
// hit print, save as PDF. No worker queue needed.

import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  attachments,
  orgUnits,
  people,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournalPhotos,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Toolbox PDF · ${id.slice(0, 8)}` }
}

export default async function ToolboxPdfPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        j: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournals)
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(toolboxJournals.id, id))
      .limit(1)
    if (!row) return null
    const att = await tx
      .select({ att: toolboxJournalAttendees, person: people })
      .from(toolboxJournalAttendees)
      .innerJoin(people, eq(people.id, toolboxJournalAttendees.personId))
      .where(eq(toolboxJournalAttendees.journalId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const ph = await tx
      .select({
        link: toolboxJournalPhotos,
        attachment: attachments,
      })
      .from(toolboxJournalPhotos)
      .innerJoin(attachments, eq(attachments.id, toolboxJournalPhotos.attachmentId))
      .where(eq(toolboxJournalPhotos.journalId, id))
    return { ...row, attendees: att, photos: ph }
  })
  if (!data) notFound()

  const { j, site, foremanUser, foremanMembership, attendees, photos } = data
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: id,
    action: 'export',
    summary: 'Generated PDF view',
  })

  const foremanName =
    foremanUser?.name ?? foremanMembership?.displayName ?? 'Unknown foreman'

  return (
    <div className="print-page">
      <style>{`
        @media print {
          @page { size: Letter; margin: 12mm; }
          .no-print { display: none !important; }
          body { background: white !important; }
        }
        .print-page {
          background: #fff;
          color: #0f172a;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
          padding: 24px;
          max-width: 900px;
          margin: 0 auto;
        }
        .print-page h1 { font-size: 22px; margin: 0 0 4px; }
        .print-page h2 { font-size: 14px; margin: 16px 0 4px; text-transform: uppercase;
                         letter-spacing: 0.04em; color: #475569; }
        .print-page p { white-space: pre-wrap; line-height: 1.5; margin: 0 0 8px; }
        .meta-row { display: flex; gap: 24px; flex-wrap: wrap; color: #475569; font-size: 12px; }
        .meta-row b { color: #0f172a; font-weight: 600; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px; }
        .sign-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
        .sign-table th, .sign-table td {
          border: 1px solid #cbd5e1;
          padding: 6px 8px;
          vertical-align: middle;
          text-align: left;
        }
        .sign-table th { background: #f1f5f9; }
        .sig-line { height: 36px; }
        .sig-img { max-height: 34px; }
        .photo-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
        .photo-row img { max-width: 240px; max-height: 180px; border: 1px solid #cbd5e1; }
      `}</style>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintTrigger />
      </div>

      <h1>Toolbox Talk · {j.title}</h1>
      <div className="meta-row">
        <span>
          <b>Reference:</b> {j.reference}
        </span>
        <span>
          <b>Date:</b> {j.occurredOn}
        </span>
        <span>
          <b>Status:</b> {j.status}
        </span>
      </div>

      <h2>General</h2>
      <div className="grid-2">
        <div>
          <b>Site:</b> {site?.name ?? '—'}
        </div>
        <div>
          <b>Foreman:</b> {foremanName}
        </div>
        <div>
          <b>Topic:</b> {j.topic ?? '—'}
        </div>
        <div>
          <b>Attendees:</b> {attendees.length}
        </div>
      </div>

      <h2>Discussion</h2>
      <p>{j.discussionNotes || '—'}</p>

      <h2>Questions raised</h2>
      <p>{j.questionsRaised || '—'}</p>

      <h2>Action items</h2>
      <p>{j.actionItems || '—'}</p>

      <h2>Attendees & sign-off</h2>
      <table className="sign-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            <th>Name</th>
            <th>Job title</th>
            <th style={{ width: 260 }}>Signature</th>
            <th style={{ width: 110 }}>Signed on</th>
          </tr>
        </thead>
        <tbody>
          {attendees.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                No attendees recorded.
              </td>
            </tr>
          ) : (
            attendees.map((a, i) => (
              <tr key={a.att.id}>
                <td>{i + 1}</td>
                <td>
                  {a.person.lastName}, {a.person.firstName}
                </td>
                <td>{a.person.jobTitle ?? ''}</td>
                <td className="sig-line">
                  {a.att.signatureDataUrl ? (
                    <img className="sig-img" src={a.att.signatureDataUrl} alt="signature" />
                  ) : null}
                </td>
                <td>
                  {a.att.signedAt
                    ? new Date(a.att.signedAt).toLocaleDateString()
                    : ''}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {photos.length > 0 ? (
        <>
          <h2>Photos</h2>
          <div className="photo-row">
            {photos.map((p) => (
              <img
                key={p.link.id}
                src={publicUrl(p.attachment.r2Key)}
                alt={p.attachment.filename}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PrintTrigger() {
  // No-JS-friendly hint + a tiny inline auto-print on first paint.
  return (
    <div
      style={{
        background: '#f1f5f9',
        border: '1px solid #cbd5e1',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
        color: '#475569',
      }}
    >
      Press <b>Cmd/Ctrl + P</b> to save as PDF.
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: 'setTimeout(function(){try{window.print()}catch(e){}},250)',
        }}
      />
    </div>
  )
}
