import 'server-only'

// Corrective Actions FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES['corrective-actions']. No spawnCorrectiveAction — a CA
// spawning a CA is intentionally not offered.

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  orgUnits,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { fmtDate, fmtDateTime, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createCorrectiveActionFlowAdapter(
  ctx: RequestContext,
  caId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'corrective-actions',
    subjectId: caId,
    notifyCategory: 'ca',
    auditEntityType: 'corrective_action',
    deepLink: () => `/corrective-actions/${caId}`,
    pdfJob: () => ({ kind: 'ca', tenantId: ctx.tenantId, caId }),

    async loadValues() {
      const ownerTU = alias(tenantUsers, 'ca_owner_tu')
      const ownerU = alias(users, 'ca_owner_u')
      const abTU = alias(tenantUsers, 'ca_ab_tu')
      const abU = alias(users, 'ca_ab_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: correctiveActions,
            siteName: orgUnits.name,
            ownerName: ownerU.name,
            assignedByName: abU.name,
          })
          .from(correctiveActions)
          .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
          .leftJoin(ownerTU, eq(ownerTU.id, correctiveActions.ownerTenantUserId))
          .leftJoin(ownerU, eq(ownerU.id, ownerTU.userId))
          .leftJoin(abTU, eq(abTU.id, correctiveActions.assignedByTenantUserId))
          .leftJoin(abU, eq(abU.id, abTU.userId))
          .where(eq(correctiveActions.id, caId))
          .limit(1),
      )
      if (!head) return {}
      const r = head.r

      const [steps, photos] = await Promise.all([
        ctx.db((tx) =>
          tx
            .select({
              kind: caCompleteSteps.kind,
              description: caCompleteSteps.description,
              completedAt: caCompleteSteps.completedAt,
              byName: users.name,
            })
            .from(caCompleteSteps)
            .leftJoin(tenantUsers, eq(tenantUsers.id, caCompleteSteps.completedByTenantUserId))
            .leftJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(caCompleteSteps.caId, caId))
            .orderBy(asc(caCompleteSteps.entityOrder)),
        ),
        ctx.db((tx) =>
          tx
            .select({ caption: caPhotos.caption, r2Key: attachments.r2Key })
            .from(caPhotos)
            .innerJoin(attachments, eq(attachments.id, caPhotos.attachmentId))
            .where(eq(caPhotos.caId, caId)),
        ),
      ])

      return {
        status: r.status ?? null,
        status_label: titleize(r.status),
        reference: r.reference ?? null,
        title: r.title ?? null,
        description: r.description ?? '',
        severity: r.severity ?? null,
        severity_label: titleize(r.severity),
        source_label: titleize(r.source),
        root_cause: r.rootCause ?? '',
        action_taken: r.actionTaken ?? '',
        assigned_on: fmtDate(r.assignedOn),
        due_on: fmtDate(r.dueOn),
        site_name: head.siteName ?? '',
        owner_name: head.ownerName ?? '',
        assigned_by_name: head.assignedByName ?? '',
        // FK ids for conditions / recipient `field` targets.
        site_org_unit_id: r.siteOrgUnitId ?? null,
        owner_tenant_user_id: r.ownerTenantUserId ?? null,
        // Collections.
        complete_steps: steps.map((s) => ({
          kind: titleize(s.kind),
          description: s.description ?? '',
          completed_by_name: s.byName ?? '',
          completed_at: fmtDateTime(s.completedAt),
        })),
        photos: photos.map((p) => ({ url: publicUrl(p.r2Key), caption: p.caption ?? '' })),
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: correctiveActions.ownerTenantUserId })
          .from(correctiveActions)
          .where(eq(correctiveActions.id, caId))
          .limit(1),
      )
      const tuid = r?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
