import 'server-only'

// Maps a (subjectType, subjectKey) back to its FlowSubjectAdapter — so the
// gate-resume path can rebuild the right adapter from a stored flow_gates row.
// Native-module adapters register here as they're wired (Phase 8).

import { can, type RequestContext } from '@beaconhs/tenant'
import { createFormFlowAdapter } from '@/app/(app)/forms/_lib/form-flow-adapter'
import { canManageModule } from '@/lib/module-admin/guard'
import { createJournalFlowAdapter } from './adapters/journals'
import { createHazidFlowAdapter } from './adapters/hazid'
import { createIncidentFlowAdapter } from './adapters/incidents'
import { createCorrectiveActionFlowAdapter } from './adapters/corrective-actions'
import { createInspectionFlowAdapter } from './adapters/inspections'
import { createTrainingFlowAdapter } from './adapters/training'
import { createEquipmentFlowAdapter } from './adapters/equipment'
import { createDocumentFlowAdapter } from './adapters/documents'
import type { FlowSubjectAdapter } from './types'

export type ModuleFlowAdapterFactory = (
  ctx: RequestContext,
  subjectId: string,
) => FlowSubjectAdapter

// moduleKey → adapter factory. One entry per flow-capable native module.
export const MODULE_FLOW_ADAPTERS: Record<string, ModuleFlowAdapterFactory> = {
  journals: createJournalFlowAdapter,
  hazid: createHazidFlowAdapter,
  incidents: createIncidentFlowAdapter,
  'corrective-actions': createCorrectiveActionFlowAdapter,
  inspections: createInspectionFlowAdapter,
  training: createTrainingFlowAdapter,
  equipment: createEquipmentFlowAdapter,
  documents: createDocumentFlowAdapter,
}

export function buildFlowAdapter(
  ctx: RequestContext,
  subjectType: 'form_template' | 'module',
  subjectKey: string | null,
  subjectId: string,
): FlowSubjectAdapter | null {
  if (subjectType === 'form_template') return createFormFlowAdapter(ctx, subjectId)
  if (subjectType === 'module' && subjectKey) {
    return MODULE_FLOW_ADAPTERS[subjectKey]?.(ctx, subjectId) ?? null
  }
  return null
}

/** Who may resolve a gate / manage flows for a subject. */
export function canManageSubjectGates(
  ctx: RequestContext,
  subjectType: 'form_template' | 'module',
  subjectKey: string | null,
): boolean {
  if (ctx.isSuperAdmin) return true
  if (subjectType === 'form_template') return can(ctx, 'forms.response.read.all')
  if (subjectType === 'module' && subjectKey) return canManageModule(ctx, subjectKey)
  return false
}
