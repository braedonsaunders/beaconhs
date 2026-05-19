// Browser-printable view. Users hit Cmd/Ctrl+P to save as PDF.
// All formatting is print-optimised (no app shell, no nav).

import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  atmosphericSensors,
  attachments,
  hazidAssessmentCSAtmospheric,
  hazidAssessmentCSEntries,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidTasks,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'HazID — Print view' }

export default async function HazidPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        a: hazidAssessments,
        site: orgUnits,
        type: hazidAssessmentTypes,
        supervisor: people,
      })
      .from(hazidAssessments)
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(hazidAssessmentTypes, eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId))
      .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return null
    const tasks = await tx
      .select({ row: hazidAssessmentTasks, task: hazidTasks })
      .from(hazidAssessmentTasks)
      .leftJoin(hazidTasks, eq(hazidTasks.id, hazidAssessmentTasks.taskId))
      .where(eq(hazidAssessmentTasks.assessmentId, id))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    const hazards = await tx
      .select({ row: hazidAssessmentHazards, library: hazidHazards })
      .from(hazidAssessmentHazards)
      .leftJoin(hazidHazards, eq(hazidHazards.id, hazidAssessmentHazards.hazardId))
      .where(eq(hazidAssessmentHazards.assessmentId, id))
      .orderBy(asc(hazidAssessmentHazards.entityOrder))
    const ppe = await tx
      .select()
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, id))
      .orderBy(asc(hazidAssessmentPPE.entityOrder))
    const questions = await tx
      .select()
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, id))
      .orderBy(asc(hazidAssessmentQuestions.entityOrder))
    const signatures = await tx
      .select({ row: hazidAssessmentSignatures, person: people })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(eq(hazidAssessmentSignatures.assessmentId, id))
    const photos = await tx
      .select({ link: hazidAssessmentPhotos, attachment: attachments })
      .from(hazidAssessmentPhotos)
      .innerJoin(attachments, eq(attachments.id, hazidAssessmentPhotos.attachmentId))
      .where(eq(hazidAssessmentPhotos.assessmentId, id))
    const atmospheric = await tx
      .select({ row: hazidAssessmentCSAtmospheric, sensor: atmosphericSensors })
      .from(hazidAssessmentCSAtmospheric)
      .leftJoin(atmosphericSensors, eq(atmosphericSensors.id, hazidAssessmentCSAtmospheric.atmosphericSensorId))
      .where(eq(hazidAssessmentCSAtmospheric.assessmentId, id))
      .orderBy(asc(hazidAssessmentCSAtmospheric.time))
    const entries = await tx
      .select({ row: hazidAssessmentCSEntries, person: people })
      .from(hazidAssessmentCSEntries)
      .leftJoin(people, eq(people.id, hazidAssessmentCSEntries.personId))
      .where(eq(hazidAssessmentCSEntries.assessmentId, id))
    return { ...row, tasks, hazards, ppe, questions, signatures, photos, atmospheric, entries }
  })
  if (!data) notFound()
  const { a, site, type, supervisor, tasks, hazards, ppe, questions, signatures, photos, atmospheric, entries } = data

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-sm text-slate-900 print:p-0">
      <header className="mb-4 flex items-end justify-between border-b border-slate-300 pb-3">
        <div>
          <h1 className="text-xl font-bold">Hazard Assessment</h1>
          <p className="text-xs text-slate-600">
            {a.reference} · {new Date(a.occurredAt).toLocaleString()}
          </p>
        </div>
        <div className="text-right text-xs text-slate-600">
          {type?.name ?? ''}
          <br />
          {site?.name ?? ''}
        </div>
      </header>

      <section className="mb-4">
        <h2 className="mb-1 text-base font-semibold">General</h2>
        <table className="w-full text-xs">
          <tbody>
            <Row k="Reference" v={a.reference} />
            <Row k="Type" v={type?.name ?? '—'} />
            <Row k="Occurred" v={new Date(a.occurredAt).toLocaleString()} />
            <Row k="Site" v={site?.name ?? '—'} />
            <Row k="Location on site" v={a.locationOnSite ?? '—'} />
            <Row k="Supervisor" v={supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—'} />
            <Row k="Job scope" v={a.jobScope ?? '—'} />
          </tbody>
        </table>
      </section>

      {ppe.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">PPE</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-1">Name</th>
                <th>Description</th>
                <th>Required</th>
                <th>Answer</th>
              </tr>
            </thead>
            <tbody>
              {ppe.map((p) => (
                <tr key={p.id} className="border-b border-slate-200">
                  <td className="py-1">{p.name}</td>
                  <td>{p.description ?? '—'}</td>
                  <td>{p.required ? 'Y' : 'N'}</td>
                  <td>{p.answer ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {questions.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Questions</h2>
          <ol className="ml-5 list-decimal space-y-1 text-xs">
            {questions.map((q) => (
              <li key={q.id}>
                <strong>{q.question}</strong>
                <br />
                Answer: <span className="text-slate-700">{q.answer ?? '—'}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Tasks</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th>#</th>
                <th>Task</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.row.id} className="border-b border-slate-200">
                  <td className="py-1">{i + 1}</td>
                  <td>{t.task?.name ?? t.row.description ?? '—'}</td>
                  <td className="whitespace-pre-wrap">{t.row.controls ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {hazards.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Hazards</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th>#</th>
                <th>Hazard</th>
                <th>Standard controls</th>
                <th>Specific controls</th>
                <th>Applicable</th>
              </tr>
            </thead>
            <tbody>
              {hazards.map((h, i) => (
                <tr key={h.row.id} className="border-b border-slate-200">
                  <td className="py-1">{i + 1}</td>
                  <td>{h.library?.name ?? h.row.name ?? '—'}</td>
                  <td className="whitespace-pre-wrap">{h.row.standardControls ?? '—'}</td>
                  <td className="whitespace-pre-wrap">{h.row.specificControls ?? '—'}</td>
                  <td>{h.row.applicable ? 'Y' : 'N'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {a.wah ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Working at Heights</h2>
          <Row k="WAH type" v={a.wahType ?? '—'} />
          <Row k="Communication" v={(a.wahCommunication ?? []).join(', ') || '—'} />
          <Row k="Access" v={(a.wahAccess ?? []).join(', ') || '—'} />
          <Row k="Equipment" v={(a.wahEquipment ?? []).join(', ') || '—'} />
          <Row k="Rescue plan" v={a.wahRescue ?? '—'} />
          <Row k="Permit #" v={a.wahPermitNumber ?? '—'} />
        </section>
      ) : null}

      {a.confinedSpace ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Confined Space</h2>
          <Row k="Type" v={a.csType ?? '—'} />
          <Row k="Description" v={a.csDescription ?? '—'} />
          <Row k="Work performed" v={a.csWorkPerformed ?? '—'} />
          <Row k="Attendant-Entrant comms" v={(a.csCommunication ?? []).join(', ') || '—'} />
          <Row k="Attendant-Rescue comms" v={(a.csCommunicationRescue ?? []).join(', ') || '—'} />
          <Row k="Rescue equipment" v={(a.csRescue ?? []).join(', ') || '—'} />
          <Row k="Rescue style" v={a.csRescueStyle ?? '—'} />
          <Row k="Rescue procedure" v={a.csRescueProcedure ?? '—'} />
          <Row k="Permit #" v={a.csPermitNumber ?? '—'} />
          {a.csDiagramBase64 ? (
            <div className="my-2">
              <img src={a.csDiagramBase64} alt="Space diagram" className="max-h-72 border border-slate-300" />
            </div>
          ) : null}
          {atmospheric.length > 0 ? (
            <>
              <h3 className="mt-2 text-sm font-semibold">Atmospheric readings</h3>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-left">
                    <th>Time</th>
                    <th>Sensor</th>
                    <th>O₂</th>
                    <th>LEL</th>
                    <th>CO</th>
                    <th>H₂S</th>
                    <th>Distance</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {atmospheric.map((r) => (
                    <tr key={r.row.id} className="border-b border-slate-200">
                      <td className="py-1">{new Date(r.row.time).toLocaleString()}</td>
                      <td>{r.sensor?.identifier ?? '—'}</td>
                      <td>{r.row.sensor1Reading ?? '—'}</td>
                      <td>{r.row.sensor2Reading ?? '—'}</td>
                      <td>{r.row.sensor3Reading ?? '—'}</td>
                      <td>{r.row.sensor4Reading ?? '—'}</td>
                      <td>{r.row.distance ?? '—'}</td>
                      <td>{r.row.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {entries.length > 0 ? (
            <>
              <h3 className="mt-2 text-sm font-semibold">Entry log</h3>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-left">
                    <th>Person</th>
                    <th>Time in</th>
                    <th>Time out</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((r) => (
                    <tr key={r.row.id} className="border-b border-slate-200">
                      <td className="py-1">
                        {r.person ? `${r.person.firstName} ${r.person.lastName}` : r.row.externalName ?? '—'}
                      </td>
                      <td>{r.row.timeIn ? new Date(r.row.timeIn).toLocaleString() : '—'}</td>
                      <td>{r.row.timeOut ? new Date(r.row.timeOut).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>
      ) : null}

      {a.arcFlash ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Arc Flash</h2>
          <Row k="HRC" v={a.arcFlashLevel ?? '—'} />
          <Row k="Boundary" v={a.arcFlashBoundary ?? '—'} />
          <Row k="Incident energy" v={a.arcFlashIncidentEnergy ?? '—'} />
          <Row k="Required PPE" v={(a.arcFlashEquipment ?? []).join(', ') || '—'} />
          <Row k="Procedures" v={a.arcFlashProcedures ?? '—'} />
          <Row k="Qualified person" v={a.arcFlashQualifiedPerson ?? '—'} />
        </section>
      ) : null}

      {signatures.length > 0 ? (
        <section className="mb-4 break-inside-avoid">
          <h2 className="mb-1 text-base font-semibold">Signatures</h2>
          <div className="grid grid-cols-2 gap-3">
            {signatures.map((s) => (
              <div key={s.row.id} className="rounded border border-slate-300 p-2">
                <div className="text-xs font-medium">
                  {s.person ? `${s.person.firstName} ${s.person.lastName}` : s.row.externalName ?? '—'}
                </div>
                <div className="text-xs text-slate-600">
                  {s.row.signatureType}
                  {s.row.csEntrant ? ' · Entrant' : ''}
                  {s.row.csAttendant ? ' · Attendant' : ''}
                  {s.row.csRescue ? ' · Rescue' : ''}
                </div>
                {s.row.signatureDataUrl ? (
                  <img
                    src={s.row.signatureDataUrl}
                    alt={`Signature ${s.row.id}`}
                    className="mt-1 h-16 w-full object-contain"
                  />
                ) : (
                  <div className="mt-1 text-xs italic text-red-600">Not signed</div>
                )}
                {s.row.signedAt ? (
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {new Date(s.row.signedAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <figure key={p.link.id} className="break-inside-avoid">
                <img
                  src={publicUrl(p.attachment.r2Key)}
                  alt={p.link.caption ?? p.attachment.filename}
                  className="h-32 w-full object-cover"
                />
                {p.link.caption ? <figcaption className="text-[10px] text-slate-600">{p.link.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-6 border-t border-slate-300 pt-2 text-[10px] text-slate-500 print:fixed print:bottom-0 print:w-full">
        Generated {new Date().toLocaleString()} · BeaconHS
      </footer>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="w-44 py-0.5 align-top text-slate-500">{k}</td>
      <td className="py-0.5 align-top">{v}</td>
    </tr>
  )
}
