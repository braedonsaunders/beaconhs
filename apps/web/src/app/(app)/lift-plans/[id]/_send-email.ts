// Server-only helper to email a lift-plan recap.
//
// Mirrors apps/web/src/app/(app)/incidents/[id]/_send-email.ts. The
// recipients default to the active tenant admin distribution list; the
// caller can override with explicit emails. The audit row + email_log
// row both link back to the lift_plan.

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  equipmentItems,
  liftPlanEquipment,
  liftPlanHazards,
  liftPlanLoads,
  liftPlanPpe,
  liftPlanSignatures,
  liftPlans,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

export async function sendLiftPlanEmail(
  ctx: RequestContext,
  liftPlanId: string,
  options?: {
    recipients?: string[]
    cc?: string[]
    subjectPrefix?: string
    messageOverride?: string
  },
): Promise<{ recipientCount: number } | null> {
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        plan: liftPlans,
        site: orgUnits,
        supervisor: tenantUsers,
        operator: people,
      })
      .from(liftPlans)
      .leftJoin(orgUnits, eq(orgUnits.id, liftPlans.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, liftPlans.supervisorTenantUserId))
      .leftJoin(people, eq(people.id, liftPlans.operatorPersonId))
      .where(and(eq(liftPlans.id, liftPlanId), isNull(liftPlans.deletedAt)))
      .limit(1)
    if (!row) return null

    const loads = await tx
      .select()
      .from(liftPlanLoads)
      .where(eq(liftPlanLoads.liftPlanId, liftPlanId))
      .orderBy(asc(liftPlanLoads.entityOrder))
    const equipment = await tx
      .select({ row: liftPlanEquipment, item: equipmentItems })
      .from(liftPlanEquipment)
      .leftJoin(equipmentItems, eq(equipmentItems.id, liftPlanEquipment.equipmentItemId))
      .where(eq(liftPlanEquipment.liftPlanId, liftPlanId))
      .orderBy(asc(liftPlanEquipment.entityOrder))
    const hazards = await tx
      .select()
      .from(liftPlanHazards)
      .where(eq(liftPlanHazards.liftPlanId, liftPlanId))
      .orderBy(asc(liftPlanHazards.entityOrder))
    const ppe = await tx
      .select()
      .from(liftPlanPpe)
      .where(eq(liftPlanPpe.liftPlanId, liftPlanId))
    const signatures = await tx
      .select({ row: liftPlanSignatures, person: people })
      .from(liftPlanSignatures)
      .leftJoin(people, eq(people.id, liftPlanSignatures.personId))
      .where(eq(liftPlanSignatures.liftPlanId, liftPlanId))

    const adminRecipients = await tx
      .select({ email: users.email })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(
          eq(tenantUsers.tenantId, row.plan.tenantId),
          eq(tenantUsers.status, 'active'),
          sql`${users.email} IS NOT NULL`,
        ),
      )
    return { ...row, loads, equipment, hazards, ppe, signatures, adminRecipients }
  })
  if (!data) return null

  const explicit = (options?.recipients ?? []).filter((s) => /@/.test(s))
  const adminEmails = data.adminRecipients.map((r) => r.email).filter((s): s is string => !!s)
  const to = explicit.length > 0 ? explicit : Array.from(new Set(adminEmails))
  if (to.length === 0) return null
  const cc = (options?.cc ?? []).filter((s) => /@/.test(s))

  const supervisorName = data.supervisor?.displayName ?? '—'
  const operatorName = data.operator
    ? `${data.operator.firstName} ${data.operator.lastName}`
    : '—'

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Lift Plan ${data.plan.reference} · ${data.plan.liftDate}`

  const totalWeight = data.loads.reduce(
    (acc, l) => acc + (l.weightKg ? Number(l.weightKg) : 0),
    0,
  )

  const text = [
    `LIFT PLAN`,
    `${data.plan.reference}`,
    ``,
    `Lift date: ${data.plan.liftDate}`,
    `Site: ${data.site?.name ?? '—'}`,
    `Supervisor: ${supervisorName}`,
    `Crane operator: ${operatorName}`,
    `Status: ${data.plan.status}`,
    `Total weight: ${totalWeight > 0 ? `${totalWeight.toFixed(2)} kg` : '—'}`,
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Loads (${data.loads.length}):`,
    ...data.loads.map(
      (l) =>
        `  - ${l.description ?? '—'}${l.weightKg ? ` (${Number(l.weightKg).toFixed(2)} kg)` : ''}`,
    ),
    ``,
    `Equipment (${data.equipment.length}):`,
    ...data.equipment.map(
      (e) =>
        `  - ${e.item?.name ?? e.row.equipmentDescription ?? '—'}${e.row.capacityKg ? ` · cap ${Number(e.row.capacityKg).toFixed(0)} kg` : ''}${e.row.capacityUsedPct ? ` · used ${Number(e.row.capacityUsedPct).toFixed(1)}%` : ''}`,
    ),
    ``,
    `Hazards (${data.hazards.length}):`,
    ...data.hazards.map(
      (h) =>
        `  - ${h.hazardDescription ?? '—'}${h.controls ? `\n      Controls: ${h.controls}` : ''}`,
    ),
    ``,
    `PPE required:`,
    ...data.ppe.filter((p) => p.required).map((p) => `  - ${p.ppeName}`),
    ``,
    `Signatures (${data.signatures.length}):`,
    ...data.signatures.map((s) => {
      const name = s.person
        ? `${s.person.firstName} ${s.person.lastName}`
        : (s.row.externalName ?? 'Unknown')
      return `  - ${name} (${s.row.role})${s.row.signedAt ? ` — signed ${s.row.signedAt.toLocaleString()}` : ' — not signed'}`
    }),
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">Lift Plan ${escapeHtml(data.plan.reference)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${escapeHtml(String(data.plan.liftDate))} · ${escapeHtml(data.plan.status)} · ${totalWeight > 0 ? `${totalWeight.toFixed(2)} kg total` : '—'}
      </div>
      ${options?.messageOverride
        ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
        : ''}
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Site</td>
            <td style="padding:4px 0;">${escapeHtml(data.site?.name ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Supervisor</td>
            <td style="padding:4px 0;">${escapeHtml(supervisorName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Crane operator</td>
            <td style="padding:4px 0;">${escapeHtml(operatorName)}</td></tr>
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Loads (${data.loads.length})</h3>
      ${data.loads.length === 0
        ? '<div style="font-size:13px;color:#64748b;">No loads.</div>'
        : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.loads
            .map(
              (l) =>
                `<li>${escapeHtml(l.description ?? '—')}${l.weightKg ? ` <span style="color:#64748b">(${Number(l.weightKg).toFixed(2)} kg)</span>` : ''}</li>`,
            )
            .join('')}</ul>`}
      <h3 style="margin:18px 0 4px;font-size:14px;">Equipment (${data.equipment.length})</h3>
      ${data.equipment.length === 0
        ? '<div style="font-size:13px;color:#64748b;">No equipment.</div>'
        : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.equipment
            .map(
              (e) =>
                `<li>${escapeHtml(e.item?.name ?? e.row.equipmentDescription ?? '—')}${e.row.capacityKg ? ` <span style="color:#64748b">· cap ${Number(e.row.capacityKg).toFixed(0)} kg</span>` : ''}${e.row.capacityUsedPct ? ` <span style="color:#64748b">· used ${Number(e.row.capacityUsedPct).toFixed(1)}%</span>` : ''}</li>`,
            )
            .join('')}</ul>`}
      <h3 style="margin:18px 0 4px;font-size:14px;">Hazards (${data.hazards.length})</h3>
      ${data.hazards.length === 0
        ? '<div style="font-size:13px;color:#64748b;">No hazards.</div>'
        : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.hazards
            .map(
              (h) =>
                `<li><strong>${escapeHtml(h.hazardDescription ?? '—')}</strong>${h.controls ? `<br/><span style="color:#64748b">Controls: ${escapeHtml(h.controls)}</span>` : ''}</li>`,
            )
            .join('')}</ul>`}
      <h3 style="margin:18px 0 4px;font-size:14px;">Signatures (${data.signatures.length})</h3>
      ${data.signatures.length === 0
        ? '<div style="font-size:13px;color:#64748b;">No signatures.</div>'
        : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.signatures
            .map((s) => {
              const name = s.person
                ? `${escapeHtml(s.person.firstName)} ${escapeHtml(s.person.lastName)}`
                : escapeHtml(s.row.externalName ?? 'Unknown')
              return `<li>${name} <span style="color:#64748b">(${escapeHtml(s.row.role)})</span>${s.row.signedAt ? ` — signed ${escapeHtml(s.row.signedAt.toLocaleString())}` : ' — <span style="color:#dc2626">not signed</span>'}</li>`
            })
            .join('')}</ul>`}
    </div>
  `

  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'lift_plan_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'export',
    summary: `Emailed lift plan to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    metadata: { recipients: to, cc, channel: 'email' },
  })
  return { recipientCount: to.length }
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
