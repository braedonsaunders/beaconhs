// Print-styled transcript for a single person.
// Browser is the PDF engine.

import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import {
  orgUnits,
  people,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  return { title: `Transcript PDF · ${personId.slice(0, 8)}` }
}

export default async function ToolboxTranscriptPdfPage({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!person) return null
    const rows = await tx
      .select({
        att: toolboxJournalAttendees,
        j: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournalAttendees)
      .innerJoin(
        toolboxJournals,
        eq(toolboxJournals.id, toolboxJournalAttendees.journalId),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(toolboxJournalAttendees.personId, personId))
      .orderBy(desc(toolboxJournals.occurredOn))
    return { person, rows }
  })
  if (!data) notFound()
  const { person, rows } = data

  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    action: 'export',
    summary: `Generated toolbox transcript PDF for ${person.firstName} ${person.lastName}`,
    metadata: { personId, rows: rows.length },
  })

  const signedCount = rows.filter((r) => !!r.att.signatureDataUrl).length

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
        .meta-row { display: flex; gap: 24px; flex-wrap: wrap; color: #475569; font-size: 12px; }
        .tx-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
        .tx-table th, .tx-table td {
          border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top;
        }
        .tx-table th { background: #f1f5f9; }
        .action-block { border: 1px solid #cbd5e1; padding: 8px; margin-bottom: 6px; }
        .action-block .ref { font-size: 11px; color: #475569; }
      `}</style>

      <div className="no-print" style={{ marginBottom: 16 }}>
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
      </div>

      <h1>
        Toolbox Transcript · {person.lastName}, {person.firstName}
      </h1>
      <div className="meta-row">
        <span>
          <b>Job title:</b> {person.jobTitle ?? '—'}
        </span>
        <span>
          <b>Status:</b> {person.status}
        </span>
        <span>
          <b>Attendance:</b> {rows.length} talk(s) · {signedCount} signed
        </span>
        <span>
          <b>Generated:</b> {new Date().toLocaleDateString()}
        </span>
      </div>

      <h2>Toolbox talks attended</h2>
      {rows.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 12 }}>None.</p>
      ) : (
        <table className="tx-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Date</th>
              <th style={{ width: 90 }}>Ref</th>
              <th>Topic</th>
              <th>Foreman</th>
              <th>Site</th>
              <th style={{ width: 60 }}>Signed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.att.id}>
                <td>{r.j.occurredOn}</td>
                <td>{r.j.reference}</td>
                <td>
                  <b>{r.j.title}</b>
                  {r.j.topic ? (
                    <div style={{ color: '#475569', fontSize: 11 }}>{r.j.topic}</div>
                  ) : null}
                </td>
                <td>{r.foremanUser?.name ?? r.foremanMembership?.displayName ?? '—'}</td>
                <td>{r.site?.name ?? '—'}</td>
                <td>{r.att.signatureDataUrl ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Action items recorded in attended talks</h2>
      {rows
        .filter((r) => r.j.actionItems && r.j.actionItems.trim().length > 0)
        .map((r) => (
          <div key={`act-${r.att.id}`} className="action-block">
            <div className="ref">
              {r.j.reference} · {r.j.occurredOn} · {r.j.title}
            </div>
            <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 12 }}>
              {r.j.actionItems}
            </p>
          </div>
        ))}
      {rows.every((r) => !r.j.actionItems?.trim()) ? (
        <p style={{ color: '#64748b', fontSize: 12 }}>None.</p>
      ) : null}
    </div>
  )
}
