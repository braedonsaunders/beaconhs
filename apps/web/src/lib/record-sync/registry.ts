// The record sync registry: one saver per module that queues record edits on
// the device (see lib/offline-drafts/record-sync-modules.ts). Each saver
// reuses its module's own update rules — permission, visibility, lock state,
// validation, side effects, audit, and revalidation — and applies every edit
// as a compare-and-set (see edits.ts).

import type { RequestContext } from '@beaconhs/tenant'
import { saveAppRecordEdits } from '@/app/(app)/apps/_lib/record-edits'
import { correctiveActionRecordSaver } from '@/app/(app)/corrective-actions/_record-edits'
import { documentRecordSaver } from '@/app/(app)/documents/_record-edits'
import { equipmentRecordSaver } from '@/app/(app)/equipment/_record-edits'
import { equipmentInspectionRecordSaver } from '@/app/(app)/equipment/inspections/_record-edits'
import { hazardAssessmentRecordSaver } from '@/app/(app)/hazard-assessments/_record-edits'
import { incidentRecordSaver } from '@/app/(app)/incidents/_record-edits'
import { inspectionRecordSaver } from '@/app/(app)/inspections/_record-edits'
import { journalRecordSaver } from '@/app/(app)/journals/_record-edits'
import { locationRecordSaver } from '@/app/(app)/locations/_record-edits'
import { personRecordSaver } from '@/app/(app)/people/_record-edits'
import { ppeItemRecordSaver } from '@/app/(app)/ppe/_record-edits'
import { trainingAssessmentRecordSaver } from '@/app/(app)/training/assessments/_record-edits'
import { trainingAuthorityRecordSaver } from '@/app/(app)/training/authorities/_record-edits'
import { trainingClassRecordSaver } from '@/app/(app)/training/classes/_record-edits'
import { trainingRecordSaver } from '@/app/(app)/training/records/_record-edits'
import { skillAssignmentRecordSaver } from '@/app/(app)/training/skills/_record-edits'
import { skillTypeRecordSaver } from '@/app/(app)/training/skills/types/_record-edits'
import type { RecordSyncModule } from '@/lib/offline-drafts/record-sync-modules'
import type { RecordSyncResult } from '@/lib/offline-drafts/protocol'
import type { RecordSaver } from './edits'
import { parseRecordSyncRequest } from './request'

const RECORD_SAVERS: Record<RecordSyncModule, RecordSaver> = {
  apps: saveAppRecordEdits,
  incidents: incidentRecordSaver,
  'corrective-actions': correctiveActionRecordSaver,
  'hazard-assessments': hazardAssessmentRecordSaver,
  inspections: inspectionRecordSaver,
  'equipment-inspections': equipmentInspectionRecordSaver,
  journals: journalRecordSaver,
  'training-records': trainingRecordSaver,
  'training-assessments': trainingAssessmentRecordSaver,
  'training-skills': skillAssignmentRecordSaver,
  'training-skill-types': skillTypeRecordSaver,
  'training-classes': trainingClassRecordSaver,
  'training-authorities': trainingAuthorityRecordSaver,
  people: personRecordSaver,
  locations: locationRecordSaver,
  equipment: equipmentRecordSaver,
  'ppe-items': ppeItemRecordSaver,
  documents: documentRecordSaver,
}

/** Entry point for /api/records/sync. */
export async function saveRecordEdits(
  ctx: RequestContext,
  input: unknown,
): Promise<RecordSyncResult> {
  const request = parseRecordSyncRequest(input)
  if (!request) return { ok: false, error: 'Invalid sync payload.', reason: 'invalid' }
  return RECORD_SAVERS[request.module](ctx, request.recordId, request.patches)
}
