// Write/draft tools — propose→confirm→commit. These NEVER mutate inside the loop:
// each returns a signed ProposedAction that the UI renders as a confirm card; the
// real insert happens only in _commit-actions.ts after the user clicks Apply.

import { z } from 'zod'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { incidents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { moduleScopeWhere } from '@/lib/visibility'
import { signProposal, type CaPreview, type IncidentPreview } from './proposals'
import type { AssistantToolDef, ToolResult } from './types'

const CA_SEVERITY = ['low', 'medium', 'high', 'critical'] as const
const INCIDENT_TYPE = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const
const INCIDENT_SEVERITY = [
  'first_aid_only',
  'medical_aid',
  'lost_time',
  'fatality',
  'no_injury',
] as const

function normIsoDate(v: string | undefined): string | null {
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

async function loadVisibleIncident(
  ctx: RequestContext,
  tx: Database,
  id: string,
): Promise<{ id: string; reference: string; siteOrgUnitId: string | null } | null> {
  const conds: SQL[] = [eq(incidents.id, id), isNull(incidents.deletedAt)]
  // Same tiered predicate as the /incidents list (moduleScopeWhere).
  const vis = await moduleScopeWhere(ctx, tx, {
    prefix: 'incidents',
    ownerCols: [incidents.reportedByTenantUserId],
    siteCol: incidents.siteOrgUnitId,
  })
  if (vis) conds.push(vis)
  const [row] = await tx
    .select({
      id: incidents.id,
      reference: incidents.reference,
      siteOrgUnitId: incidents.siteOrgUnitId,
    })
    .from(incidents)
    .where(and(...conds))
    .limit(1)
  return row ?? null
}

const draftCorrectiveAction: AssistantToolDef = {
  name: 'draft_corrective_action',
  description:
    'Draft (do NOT create) a corrective action for the user to review and confirm. Optionally derive context from an incident id. You cannot create it directly — the user must click Apply. Never say you created it; say you drafted it.',
  category: 'write',
  requiresConfirmation: true,
  gate: { mode: 'anyOf', perms: ['ca.create'] },
  inputSchema: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    severity: z.enum(CA_SEVERITY).optional(),
    dueOn: z.string().optional().describe('Due date as YYYY-MM-DD'),
    fromIncidentId: z.string().uuid().optional().describe('Incident this CA addresses'),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as {
      title: string
      description?: string
      severity?: CaPreview['severity']
      dueOn?: string
      fromIncidentId?: string
    }
    if (!can(ctx, 'ca.create')) return { ok: false, error: 'forbidden' }
    return ctx.db(async (tx) => {
      let source: CaPreview['source'] = 'observation'
      let sourceEntityType: string | null = null
      let sourceEntityId: string | null = null
      let siteOrgUnitId: string | null = null
      if (a.fromIncidentId) {
        const inc = await loadVisibleIncident(ctx, tx, a.fromIncidentId)
        if (!inc) return { ok: false, error: 'source_incident_not_found' }
        source = 'incident'
        sourceEntityType = 'incident'
        sourceEntityId = inc.id
        siteOrgUnitId = inc.siteOrgUnitId
      }
      const preview: CaPreview = {
        title: a.title.trim().slice(0, 200),
        description: a.description?.trim().slice(0, 4000) ?? null,
        severity: a.severity ?? 'medium',
        source,
        sourceEntityType,
        sourceEntityId,
        siteOrgUnitId,
        dueOn: normIsoDate(a.dueOn),
      }
      const confirmToken = signProposal('create_corrective_action', preview, ctx)
      return {
        ok: true,
        data: { proposed: { kind: 'create_corrective_action', preview, confirmToken } },
        note: 'Drafted for the user to review — nothing is created until they click Apply.',
      }
    })
  },
}

const draftIncident: AssistantToolDef = {
  name: 'draft_incident',
  description:
    'Draft (do NOT create) an incident report for the user to review and confirm. You cannot create it directly — the user must click Apply. Never say you reported it; say you drafted it.',
  category: 'write',
  requiresConfirmation: true,
  gate: { mode: 'anyOf', perms: ['incidents.create'] },
  inputSchema: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    type: z.enum(INCIDENT_TYPE),
    severity: z.enum(INCIDENT_SEVERITY),
    occurredAt: z.string().optional().describe('ISO datetime; defaults to now'),
    location: z.string().max(200).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as {
      title: string
      description?: string
      type: IncidentPreview['type']
      severity: IncidentPreview['severity']
      occurredAt?: string
      location?: string
    }
    if (!can(ctx, 'incidents.create')) return { ok: false, error: 'forbidden' }
    const occurred = a.occurredAt ? new Date(a.occurredAt) : new Date()
    const preview: IncidentPreview = {
      title: a.title.trim().slice(0, 200),
      description: a.description?.trim().slice(0, 4000) ?? null,
      type: a.type,
      severity: a.severity,
      occurredAt: Number.isNaN(occurred.getTime())
        ? new Date().toISOString()
        : occurred.toISOString(),
      location: a.location?.trim().slice(0, 200) ?? null,
    }
    const confirmToken = signProposal('create_incident', preview, ctx)
    return {
      ok: true,
      data: { proposed: { kind: 'create_incident', preview, confirmToken } },
      note: 'Drafted for the user to review — nothing is created until they click Apply.',
    }
  },
}

export const WRITE_TOOLS: AssistantToolDef[] = [draftCorrectiveAction, draftIncident]
