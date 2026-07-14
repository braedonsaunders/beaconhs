'use client'

// Inspection BANK builder — same 1/3-2/3 shell + drag list as the type builder,
// but flat (a bank is just a reusable pool of criteria that types import from).

import type * as React from 'react'
import { Badge } from '@beaconhs/ui'
import {
  CriteriaBankSettings,
  FlatCriteriaBankBuilder,
} from '@/components/builder/flat-bank-builder'
import {
  INSPECTION_RESPONSE_LABELS as RESPONSE_LABELS,
  InspectionCriterionEditorDrawer,
  type InspectionResponseType as ResponseType,
} from '@/components/builder/criterion-editors'
import {
  addBankCriterion,
  deleteBankCriterion,
  reorderBankCriteria,
  toggleBankPublished,
  updateBank,
  updateBankCriterion,
} from '../_actions'

const CATEGORIES = [
  { value: '', label: '— None —' },
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'ppe_check', label: 'PPE check' },
  { value: 'equipment_check', label: 'Equipment check' },
  { value: 'vehicle_check', label: 'Vehicle check' },
  { value: 'workplace_audit', label: 'Workplace audit' },
  { value: 'other', label: 'Other' },
]

type BuilderBank = {
  id: string
  name: string
  description: string | null
  category: string | null
  isPublished: boolean
}
type BuilderBankCriterion = {
  id: string
  sequence: number
  text: string
  responseType: ResponseType
  choiceOptions: string[]
  requiresPhoto: boolean
  requiresComment: boolean
}

type CriterionData = Omit<BuilderBankCriterion, 'id' | 'sequence'>

export function InspectionBankBuilder({
  bank,
  criteria: initialCriteria,
  activitySlot,
}: {
  bank: BuilderBank
  criteria: BuilderBankCriterion[]
  activitySlot: React.ReactNode
}) {
  return (
    <FlatCriteriaBankBuilder<BuilderBankCriterion, CriterionData>
      bank={bank}
      initialCriteria={initialCriteria}
      activitySlot={activitySlot}
      intro="A bank is a reusable pool of questions. Build it once, then import it into any inspection type as a section."
      emptyDescription="Add questions inspectors will answer. You can reorder them anytime."
      settings={<CriteriaBankSettings bank={bank} categories={CATEGORIES} update={updateBank} />}
      actions={{
        add: (data) => addBankCriterion({ bankId: bank.id, ...data }),
        update: (id, data) => updateBankCriterion({ bankId: bank.id, id, ...data }),
        delete: (id) => deleteBankCriterion({ bankId: bank.id, id }),
        reorder: (ids) => reorderBankCriteria({ bankId: bank.id, ids }),
        setPublished: (next) => toggleBankPublished({ id: bank.id, next }),
      }}
      materializeCriterion={({ id, sequence, data }) => ({ id, sequence, ...data })}
      renderCriterion={(criterion) => (
        <>
          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {criterion.text}
          </span>
          <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
            {RESPONSE_LABELS[criterion.responseType]}
          </span>
          {criterion.responseType === 'choice' ? (
            <Badge variant="outline" className="text-[10px]">
              {criterion.choiceOptions.length} options
            </Badge>
          ) : null}
          {criterion.requiresPhoto ? (
            <Badge variant="outline" className="text-[10px]">
              photo
            </Badge>
          ) : null}
          {criterion.requiresComment ? (
            <Badge variant="outline" className="text-[10px]">
              comment
            </Badge>
          ) : null}
        </>
      )}
      renderEditor={(props) => (
        <InspectionCriterionEditorDrawer
          editor={props.editor}
          onClose={props.onClose}
          onSave={({ text, responseType, choiceOptions, requiresPhoto, requiresComment }) =>
            props.onSave({ text, responseType, choiceOptions, requiresPhoto, requiresComment })
          }
        />
      )}
    />
  )
}
