'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { Camera } from 'lucide-react'
import { Button, Drawer, Label, Select, Textarea } from '@beaconhs/ui'
import { useReseededState } from '@/lib/use-reseeded-state'
import {
  INSPECTION_RESPONSE_LABELS,
  INSPECTION_RESPONSE_TYPES,
  parseInspectionChoiceOptionsText,
  type InspectionResponseType,
} from '@/lib/inspection-response-config'
import { BuilderCheckboxRow } from './checklist-builder'
import {
  INSPECTION_SEVERITIES,
  INSPECTION_SEVERITY_LABELS,
  type InspectionSeverity,
} from './inspection-severity'

export { INSPECTION_RESPONSE_LABELS }
export type { InspectionResponseType }

type QuestionEditorState<C> = {
  mode: 'add' | 'edit'
  groupId?: string | null
  criterion?: C
}

type EditorGroup = { id: string; label: string }

function CriterionGroupSelect({
  groups,
  groupId,
  onChange,
}: {
  groups: EditorGroup[]
  groupId: string | null
  onChange: (groupId: string | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        <GeneratedText id="m_0d513924d97753" />
      </Label>
      <Select value={groupId ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">
          <GeneratedText id="m_124ee6c18e0195" />
        </option>
        <GeneratedValue
          value={groups.map((group) => (
            <option key={group.id} value={group.id}>
              <GeneratedValue value={group.label} />
            </option>
          ))}
        />
      </Select>
    </div>
  )
}

type InspectionCriterion = {
  text: string
  responseType: InspectionResponseType
  choiceOptions: string[]
  requiresPhoto: boolean
  requiresComment: boolean
  groupId?: string | null
}

type InspectionCriterionData = {
  text: string
  responseType: InspectionResponseType
  choiceOptions: string[]
  requiresPhoto: boolean
  requiresComment: boolean
  groupId: string | null
}

export function InspectionCriterionEditorDrawer<C extends InspectionCriterion>({
  editor,
  groups,
  onClose,
  onSave,
}: {
  editor: QuestionEditorState<C> | null
  groups?: EditorGroup[]
  onClose: () => void
  onSave: (data: InspectionCriterionData) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const criterion = editor?.criterion
  const [text, setText] = useReseededState(editor, criterion?.text ?? '')
  const [responseType, setResponseType] = useReseededState<InspectionResponseType>(
    editor,
    criterion && criterion.responseType !== 'rating' ? criterion.responseType : 'pass_fail_na',
  )
  const [choiceOptionsText, setChoiceOptionsText] = useReseededState(
    editor,
    criterion?.choiceOptions.join('\n') ?? '',
  )
  const [requiresPhoto, setRequiresPhoto] = useReseededState(
    editor,
    criterion?.requiresPhoto ?? false,
  )
  const [requiresComment, setRequiresComment] = useReseededState(
    editor,
    criterion?.requiresComment ?? false,
  )
  const [groupId, setGroupId] = useReseededState<string | null>(
    editor,
    editor?.groupId ?? criterion?.groupId ?? null,
  )

  let choiceOptions: string[] = []
  let choiceOptionsError: string | null = null
  if (responseType === 'choice') {
    try {
      choiceOptions = parseInspectionChoiceOptionsText(choiceOptionsText)
    } catch (error) {
      choiceOptionsError = error instanceof Error ? error.message : 'Choice options are invalid'
    }
  }

  return (
    <Drawer
      open={Boolean(editor)}
      onClose={onClose}
      title={tGeneratedValue(
        editor?.mode === 'add' ? tGenerated('m_029dffafbff34b') : tGenerated('m_06b6a61fd2d8b0'),
      )}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button
            disabled={!text.trim() || Boolean(choiceOptionsError)}
            onClick={() =>
              onSave({
                text: text.trim(),
                responseType,
                choiceOptions,
                requiresPhoto,
                requiresComment,
                groupId,
              })
            }
          >
            <GeneratedValue
              value={
                editor?.mode === 'add' ? (
                  <GeneratedText id="m_16c8592e5020a4" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={tGenerated('m_00b89c25d2ce18')}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_15eb6eb85b34f2" />
          </Label>
          <Select
            value={responseType}
            onChange={(event) => setResponseType(event.target.value as InspectionResponseType)}
          >
            <GeneratedValue
              value={INSPECTION_RESPONSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  <GeneratedValue value={INSPECTION_RESPONSE_LABELS[type]} />
                </option>
              ))}
            />
          </Select>
        </div>
        <GeneratedValue
          value={
            responseType === 'choice' ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_02057adc77a443" />
                </Label>
                <Textarea
                  rows={6}
                  value={choiceOptionsText}
                  onChange={(event) => setChoiceOptionsText(event.target.value)}
                  placeholder={tGenerated('m_04aa3d9aa111e6')}
                />
                <GeneratedValue
                  value={
                    choiceOptionsError ? (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        <GeneratedValue value={choiceOptionsError} />
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_0871856ca410e1" />
                      </p>
                    )
                  }
                />
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            groups ? (
              <CriterionGroupSelect groups={groups} groupId={groupId} onChange={setGroupId} />
            ) : null
          }
        />
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <BuilderCheckboxRow
            label={tGenerated('m_0a9994281e867d')}
            checked={requiresPhoto}
            onChange={setRequiresPhoto}
          />
          <BuilderCheckboxRow
            label={tGenerated('m_1cff8028d13785')}
            checked={requiresComment}
            onChange={setRequiresComment}
          />
        </div>
      </div>
    </Drawer>
  )
}

type SeverityCriterion = {
  question: string
  description: string | null
  severity: InspectionSeverity
  requiresPhoto: boolean
  groupId?: string | null
}

type SeverityCriterionData = {
  question: string
  description: string | null
  severity: InspectionSeverity
  requiresPhoto: boolean
  groupId: string | null
}

export function SeverityCriterionEditorDrawer<C extends SeverityCriterion>({
  editor,
  groups,
  onClose,
  onSave,
}: {
  editor: QuestionEditorState<C> | null
  groups?: EditorGroup[]
  onClose: () => void
  onSave: (data: SeverityCriterionData) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const criterion = editor?.criterion
  const [question, setQuestion] = useReseededState(editor, criterion?.question ?? '')
  const [description, setDescription] = useReseededState(editor, criterion?.description ?? '')
  const [severity, setSeverity] = useReseededState<InspectionSeverity>(
    editor,
    criterion?.severity ?? 'medium',
  )
  const [requiresPhoto, setRequiresPhoto] = useReseededState(
    editor,
    criterion?.requiresPhoto ?? false,
  )
  const [groupId, setGroupId] = useReseededState<string | null>(
    editor,
    editor?.groupId ?? criterion?.groupId ?? null,
  )

  return (
    <Drawer
      open={Boolean(editor)}
      onClose={onClose}
      title={tGeneratedValue(
        editor?.mode === 'add' ? tGenerated('m_029dffafbff34b') : tGenerated('m_06b6a61fd2d8b0'),
      )}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button
            disabled={!question.trim()}
            onClick={() =>
              onSave({
                question: question.trim(),
                description: description.trim() || null,
                severity,
                requiresPhoto,
                groupId,
              })
            }
          >
            <GeneratedValue
              value={
                editor?.mode === 'add' ? (
                  <GeneratedText id="m_16c8592e5020a4" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Textarea
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={tGenerated('m_1f0cf0198eb640')}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={tGenerated('m_1f76d2f04d9e1a')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0015e27ccf0f9f" />
          </Label>
          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as InspectionSeverity)}
          >
            <GeneratedValue
              value={INSPECTION_SEVERITIES.map((option) => (
                <option key={option} value={option}>
                  <GeneratedValue value={INSPECTION_SEVERITY_LABELS[option]} />
                </option>
              ))}
            />
          </Select>
        </div>
        <GeneratedValue
          value={
            groups ? (
              <CriterionGroupSelect groups={groups} groupId={groupId} onChange={setGroupId} />
            ) : null
          }
        />
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <BuilderCheckboxRow checked={requiresPhoto} onChange={setRequiresPhoto}>
            <span className="flex items-center gap-1.5">
              <Camera size={13} /> <GeneratedText id="m_0a9994281e867d" />
            </span>
          </BuilderCheckboxRow>
        </div>
      </div>
    </Drawer>
  )
}
