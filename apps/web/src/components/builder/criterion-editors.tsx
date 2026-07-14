'use client'

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
      <Label>Section</Label>
      <Select value={groupId ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Ungrouped</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.label}
          </option>
        ))}
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
      title={editor?.mode === 'add' ? 'Add question' : 'Edit question'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
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
            {editor?.mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Question</Label>
          <Textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. Are walkways clear and unobstructed?"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Response type</Label>
          <Select
            value={responseType}
            onChange={(event) => setResponseType(event.target.value as InspectionResponseType)}
          >
            {INSPECTION_RESPONSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {INSPECTION_RESPONSE_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>
        {responseType === 'choice' ? (
          <div className="space-y-1.5">
            <Label>Options (one per line)</Label>
            <Textarea
              rows={6}
              value={choiceOptionsText}
              onChange={(event) => setChoiceOptionsText(event.target.value)}
              placeholder={'Safe\nNeeds attention\nNot observed'}
            />
            {choiceOptionsError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{choiceOptionsError}</p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspectors select exactly one option. Existing records keep their original option
                list if this question changes later.
              </p>
            )}
          </div>
        ) : null}
        {groups ? (
          <CriterionGroupSelect groups={groups} groupId={groupId} onChange={setGroupId} />
        ) : null}
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <BuilderCheckboxRow
            label="Require a photo"
            checked={requiresPhoto}
            onChange={setRequiresPhoto}
          />
          <BuilderCheckboxRow
            label="Require a comment"
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
      title={editor?.mode === 'add' ? 'Add question' : 'Edit question'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
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
            {editor?.mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Question</Label>
          <Textarea
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Webbing free of cuts, fraying, or burns?"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional guidance shown to the inspector."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Severity on fail</Label>
          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as InspectionSeverity)}
          >
            {INSPECTION_SEVERITIES.map((option) => (
              <option key={option} value={option}>
                {INSPECTION_SEVERITY_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>
        {groups ? (
          <CriterionGroupSelect groups={groups} groupId={groupId} onChange={setGroupId} />
        ) : null}
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <BuilderCheckboxRow checked={requiresPhoto} onChange={setRequiresPhoto}>
            <span className="flex items-center gap-1.5">
              <Camera size={13} /> Require a photo
            </span>
          </BuilderCheckboxRow>
        </div>
      </div>
    </Drawer>
  )
}
