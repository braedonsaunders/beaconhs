'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// PPE criteria BANK builder — same 1/3-2/3 shell + drag list as the type
// builder, but flat (a bank is just a reusable, severity-aware pool of criteria
// that PPE types import from).

import type * as React from 'react'
import { Badge } from '@beaconhs/ui'
import {
  CriteriaBankSettings,
  FlatCriteriaBankBuilder,
} from '@/components/builder/flat-bank-builder'
import { SeverityCriterionEditorDrawer } from '@/components/builder/criterion-editors'
import {
  inspectionSeverityBadgeVariant as severityVariant,
  type InspectionSeverity as Severity,
} from '@/components/builder/inspection-severity'
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
  { value: 'head', label: 'Head protection' },
  { value: 'eye', label: 'Eye protection' },
  { value: 'hand', label: 'Hand protection' },
  { value: 'foot', label: 'Foot protection' },
  { value: 'fall', label: 'Fall protection' },
  { value: 'respiratory', label: 'Respiratory protection' },
  { value: 'hearing', label: 'Hearing protection' },
  { value: 'high_vis', label: 'High visibility' },
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
  question: string
  description: string | null
  severity: Severity
  requiresPhoto: boolean
}

type CriterionData = Omit<BuilderBankCriterion, 'id' | 'sequence'>

export function PpeBankBuilder({
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
      intro="A bank is a reusable pool of questions. Build it once, then import it into any PPE type as a section."
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
            <GeneratedValue value={criterion.question} />
          </span>
          <Badge variant={severityVariant(criterion.severity)} className="text-[10px]">
            <GeneratedValue value={criterion.severity} />
          </Badge>
          <GeneratedValue
            value={
              criterion.requiresPhoto ? (
                <Badge variant="outline" className="text-[10px]">
                  <GeneratedText id="m_07cb1cfb72cff4" />
                </Badge>
              ) : null
            }
          />
        </>
      )}
      renderEditor={(props) => (
        <SeverityCriterionEditorDrawer
          editor={props.editor}
          onClose={props.onClose}
          onSave={({ question, description, severity, requiresPhoto }) =>
            props.onSave({ question, description, severity, requiresPhoto })
          }
        />
      )}
    />
  )
}
