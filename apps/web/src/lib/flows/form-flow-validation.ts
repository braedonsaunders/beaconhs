import {
  FORM_STATUS_VALUES,
  FORM_TEMPLATE_ACTIONS,
  FORM_TEMPLATE_TRIGGERS,
  SKIP_FIELD_TYPES,
  hasPhotosCompanion,
  isAttachmentArrayField,
  labelText,
  lintAutomationGraph,
  storesResponseValue,
  type AutomationGraph,
  type FlowFieldKind,
  type FlowSubjectProfile,
  type FormField,
  type FormSchemaV1,
} from '@beaconhs/forms-core'

function fieldKind(field: FormField): FlowFieldKind {
  if (field.type === 'number' || field.type === 'slider' || field.type === 'rating') return 'number'
  if (field.type === 'date' || field.type === 'datetime' || field.type === 'time') return 'date'
  if (field.type === 'person_picker' || field.type === 'multi_person_picker') return 'person'
  if (['customer_picker', 'project_picker', 'site_picker', 'area_picker'].includes(field.type)) {
    return 'org_unit'
  }
  if (
    ['select', 'radio', 'pass_fail_na', 'rating', 'traffic_light', 'multi_select'].includes(
      field.type,
    )
  ) {
    return 'enum'
  }
  return 'text'
}

export function formFlowProfile(
  templateId: string,
  label: string,
  schema: FormSchemaV1,
): FlowSubjectProfile {
  const fields = schema.sections.flatMap((section) =>
    section.repeating
      ? []
      : section.fields
          .filter((field) => !SKIP_FIELD_TYPES.has(field.type))
          .map((field) => ({
            key: field.id,
            label: labelText(field.label, field.id),
            kind: fieldKind(field),
            writable: storesResponseValue(field),
            photoSource: isAttachmentArrayField(field.type) || hasPhotosCompanion(field.type),
            textOutput:
              storesResponseValue(field) && ['text', 'long_text', 'rich_text'].includes(field.type),
          })),
  )
  fields.push(
    {
      key: 'compliance_score',
      label: 'Compliance score',
      kind: 'number',
      writable: false,
      photoSource: false,
      textOutput: false,
    },
    {
      key: 'compliance_status',
      label: 'Compliance status',
      kind: 'enum',
      writable: false,
      photoSource: false,
      textOutput: false,
    },
  )
  return {
    subjectType: 'form_template',
    subjectKey: templateId,
    label,
    triggers: FORM_TEMPLATE_TRIGGERS,
    actions: FORM_TEMPLATE_ACTIONS,
    statusValues: FORM_STATUS_VALUES,
    fields,
  }
}

function actionFieldReferences(graph: AutomationGraph): Array<{ where: string; field: string }> {
  const refs: Array<{ where: string; field: string }> = []
  for (const node of graph.nodes) {
    if (node.data.kind === 'gate' && node.data.gate.assignee.type === 'field') {
      refs.push({ where: `Gate ${node.id} assignee`, field: node.data.gate.assignee.field })
      continue
    }
    if (node.data.kind !== 'action') continue
    const action = node.data.action
    if (action.action === 'send_email') {
      for (const target of action.to) {
        if (target.type === 'field') {
          refs.push({ where: `Action ${node.id} recipient`, field: target.field })
        }
      }
    } else if (action.action === 'create_capa' && action.assignee?.type === 'field') {
      refs.push({ where: `Action ${node.id} assignee`, field: action.assignee.field })
    }
  }
  return refs
}

export function lintFormFlowGraph(
  graph: AutomationGraph,
  templateId: string,
  label: string,
  schema: FormSchemaV1,
): string[] {
  const profile = formFlowProfile(templateId, label, schema)
  const fields = new Map<string, FormField>()
  for (const section of schema.sections) {
    if (section.repeating) continue
    for (const field of section.fields) fields.set(field.id, field)
  }
  const readableIds = new Set(profile.fields.map((field) => field.key))
  const writableIds = new Set(
    [...fields.values()].filter((field) => storesResponseValue(field)).map((field) => field.id),
  )
  const errors = lintAutomationGraph(graph, readableIds, profile)

  for (const ref of actionFieldReferences(graph)) {
    if (!readableIds.has(ref.field))
      errors.push(`${ref.where} references unknown field "${ref.field}"`)
  }

  for (const node of graph.nodes) {
    if (node.data.kind === 'trigger' && node.data.trigger.trigger === 'manual') {
      if (!node.data.trigger.buttonId.trim() || !node.data.trigger.label.trim()) {
        errors.push(`Trigger ${node.id}: manual buttons require an id and label.`)
      }
    }
    if (node.data.kind === 'gate') {
      if (!node.data.gate.title.trim()) errors.push(`Gate ${node.id}: title is required.`)
      continue
    }
    if (node.data.kind !== 'action') continue
    const action = node.data.action
    if (action.action === 'set_field' && !writableIds.has(action.field)) {
      errors.push(`Action ${node.id}: set_field must target a stored, top-level response field.`)
    } else if (action.action === 'analyze_photos') {
      const photoField = fields.get(action.fieldId)
      if (
        !photoField ||
        (!isAttachmentArrayField(photoField.type) && !hasPhotosCompanion(photoField.type))
      ) {
        errors.push(`Action ${node.id}: analyze_photos requires a top-level photo field.`)
      }
      if (action.storeInField) {
        const output = fields.get(action.storeInField)
        if (
          !output ||
          !storesResponseValue(output) ||
          !['text', 'long_text', 'rich_text'].includes(output.type)
        ) {
          errors.push(`Action ${node.id}: photo analysis output requires a text response field.`)
        }
      }
    } else if (action.action === 'start_monitored_session') {
      for (const [name, fieldId] of [
        ['interval', action.intervalFieldKey],
        ['grace', action.graceFieldKey],
        ['duration', action.durationFieldKey],
      ] as const) {
        if (fieldId && !['number', 'slider'].includes(fields.get(fieldId)?.type ?? '')) {
          errors.push(`Action ${node.id}: ${name} binding requires a top-level number field.`)
        }
      }
    } else if (action.action === 'create_capa' && !action.titleTemplate.trim()) {
      errors.push(`Action ${node.id}: CAPA title is required.`)
    } else if (action.action === 'create_incident' && !action.titleTemplate.trim()) {
      errors.push(`Action ${node.id}: incident title is required.`)
    } else if (action.action === 'notify_role' && (!action.role.trim() || !action.message.trim())) {
      errors.push(`Action ${node.id}: notification role and message are required.`)
    }
  }
  return Array.from(new Set(errors))
}
