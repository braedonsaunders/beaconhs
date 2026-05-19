// Printable view. Users hit Cmd/Ctrl+P from this URL to save as PDF.
// All formatting is print-optimised (no app shell, no nav).

import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  attachments,
  equipmentItems,
  liftPlanEquipment,
  liftPlanHazards,
  liftPlanLoads,
  liftPlanPhotos,
  liftPlanPpe,
  liftPlanSignatures,
  liftPlans,
  orgUnits,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { formatRole, formatStatus } from '../../_types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lift Plan — Print view' }

export default async function LiftPlanPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        p: liftPlans,
        site: orgUnits,
        supervisor: tenantUsers,
        operator: people,
      })
      .from(liftPlans)
      .leftJoin(orgUnits, eq(orgUnits.id, liftPlans.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, liftPlans.supervisorTenantUserId))
      .leftJoin(people, eq(people.id, liftPlans.operatorPersonId))
      .where(and(eq(liftPlans.id, id), isNull(liftPlans.deletedAt)))
      .limit(1)
    if (!row) return null

    let project: { name: string } | null = null
    if (row.p.projectOrgUnitId) {
      const [pr] = await tx
        .select({ name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.id, row.p.projectOrgUnitId))
        .limit(1)
      project = pr ?? null
    }
    let rigger: { firstName: string; lastName: string } | null = null
    if (row.p.riggerPersonId) {
      const [r] = await tx
        .select({ firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(eq(people.id, row.p.riggerPersonId))
        .limit(1)
      rigger = r ?? null
    }
    const loads = await tx
      .select()
      .from(liftPlanLoads)
      .where(eq(liftPlanLoads.liftPlanId, id))
      .orderBy(asc(liftPlanLoads.entityOrder))
    const equipment = await tx
      .select({ row: liftPlanEquipment, item: equipmentItems })
      .from(liftPlanEquipment)
      .leftJoin(equipmentItems, eq(equipmentItems.id, liftPlanEquipment.equipmentItemId))
      .where(eq(liftPlanEquipment.liftPlanId, id))
      .orderBy(asc(liftPlanEquipment.entityOrder))
    const hazards = await tx
      .select()
      .from(liftPlanHazards)
      .where(eq(liftPlanHazards.liftPlanId, id))
      .orderBy(asc(liftPlanHazards.entityOrder))
    const ppe = await tx
      .select()
      .from(liftPlanPpe)
      .where(eq(liftPlanPpe.liftPlanId, id))
      .orderBy(asc(liftPlanPpe.entityOrder))
    const signatures = await tx
      .select({ row: liftPlanSignatures, person: people })
      .from(liftPlanSignatures)
      .leftJoin(people, eq(people.id, liftPlanSignatures.personId))
      .where(eq(liftPlanSignatures.liftPlanId, id))
      .orderBy(asc(liftPlanSignatures.createdAt))
    const photos = await tx
      .select({ link: liftPlanPhotos, attachment: attachments })
      .from(liftPlanPhotos)
      .innerJoin(attachments, eq(attachments.id, liftPlanPhotos.attachmentId))
      .where(eq(liftPlanPhotos.liftPlanId, id))
    return { ...row, project, rigger, loads, equipment, hazards, ppe, signatures, photos }
  })

  if (!data) notFound()
  const {
    p,
    site,
    supervisor,
    operator,
    project,
    rigger,
    loads,
    equipment,
    hazards,
    ppe,
    signatures,
    photos,
  } = data
  const totalWeight = loads.reduce((acc, l) => acc + (l.weightKg ? Number(l.weightKg) : 0), 0)

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-sm text-slate-900 print:p-0">
      <header className="mb-4 flex items-end justify-between border-b border-slate-300 pb-3">
        <div>
          <h1 className="text-xl font-bold">Lift Plan</h1>
          <p className="text-xs text-slate-600">
            {p.reference} · Lift date {new Date(p.liftDate).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right text-xs text-slate-600">
          Status: {formatStatus(p.status)}
          <br />
          {site?.name ?? ''}
        </div>
      </header>

      <section className="mb-4">
        <h2 className="mb-1 text-base font-semibold">General</h2>
        <table className="w-full text-xs">
          <tbody>
            <Row k="Reference" v={p.reference} />
            <Row k="Lift date" v={new Date(p.liftDate).toLocaleDateString()} />
            <Row k="Project" v={project?.name ?? '—'} />
            <Row k="Site" v={site?.name ?? '—'} />
            <Row k="Supervisor" v={supervisor?.displayName ?? '—'} />
            <Row
              k="Crane operator"
              v={operator ? `${operator.firstName} ${operator.lastName}` : '—'}
            />
            <Row k="Rigger" v={rigger ? `${rigger.firstName} ${rigger.lastName}` : '—'} />
            <Row k="Description" v={p.description ?? '—'} />
            <Row k="Total load weight" v={totalWeight > 0 ? `${totalWeight.toFixed(2)} kg` : '—'} />
          </tbody>
        </table>
      </section>

      {loads.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Loads</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-1">#</th>
                <th>Description</th>
                <th>Weight (kg)</th>
                <th>Max dim (mm)</th>
                <th>Attachment method</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-200">
                  <td className="py-1">{i + 1}</td>
                  <td>{l.description}</td>
                  <td>{l.weightKg ?? '—'}</td>
                  <td>{l.dimensionsMaxMm ?? '—'}</td>
                  <td>{l.attachmentMethod ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {equipment.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Equipment</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-1">#</th>
                <th>Item</th>
                <th>Capacity (kg)</th>
                <th>Boom (m)</th>
                <th>Radius (m)</th>
                <th>Used %</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map((e, i) => (
                <tr key={e.row.id} className="border-b border-slate-200">
                  <td className="py-1">{i + 1}</td>
                  <td>{e.item?.name ?? e.row.equipmentDescription ?? '—'}</td>
                  <td>{e.row.capacityKg ?? '—'}</td>
                  <td>{e.row.boomLengthM ?? '—'}</td>
                  <td>{e.row.radiusM ?? '—'}</td>
                  <td>{e.row.capacityUsedPct ? `${e.row.capacityUsedPct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {hazards.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Hazards & Controls</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-1">#</th>
                <th>Hazard</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody>
              {hazards.map((h, i) => (
                <tr key={h.id} className="border-b border-slate-200">
                  <td className="py-1">{i + 1}</td>
                  <td>{h.hazardDescription}</td>
                  <td className="whitespace-pre-wrap">{h.controls ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {ppe.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-base font-semibold">Required PPE</h2>
          <ul className="ml-5 list-disc text-xs">
            {ppe.map((p) => (
              <li key={p.id}>
                {p.ppeName}
                {p.required ? '' : ' (optional)'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {signatures.length > 0 ? (
        <section className="mb-4 break-inside-avoid">
          <h2 className="mb-1 text-base font-semibold">Signatures</h2>
          <div className="grid grid-cols-2 gap-3">
            {signatures.map((s) => (
              <div key={s.row.id} className="rounded border border-slate-300 p-2">
                <div className="text-xs font-medium">{formatRole(s.row.role)}</div>
                <div className="text-xs text-slate-600">
                  {s.person
                    ? `${s.person.firstName} ${s.person.lastName}`
                    : (s.row.externalName ?? '—')}
                </div>
                {s.row.signatureDataUrl ? (
                  <img
                    src={s.row.signatureDataUrl}
                    alt={`${formatRole(s.row.role)} signature`}
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
                {p.link.caption ? (
                  <figcaption className="text-[10px] text-slate-600">{p.link.caption}</figcaption>
                ) : null}
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
