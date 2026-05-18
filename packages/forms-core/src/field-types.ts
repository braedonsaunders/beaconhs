import type { FieldType } from './schema'

export type FieldTypeMeta = {
  type: FieldType
  category: 'standard' | 'choice' | 'scoring' | 'picker' | 'media' | 'identity' | 'computed' | 'display'
  label: string
  description: string
  // Whether this field contributes to compliance scoring (Pass/Fail/N/A etc.)
  scoring: boolean
  // Indicates the runtime value shape stored in form_responses.data[fieldId]
  valueKind:
    | 'string'
    | 'number'
    | 'boolean'
    | 'string_array'
    | 'attachment_id'
    | 'attachment_id_array'
    | 'entity_ref'
    | 'entity_ref_array'
    | 'compound'
    | 'none'
}

export const FIELD_TYPES: Record<FieldType, FieldTypeMeta> = {
  // standard
  text: { type: 'text', category: 'standard', label: 'Short text', description: 'Single-line text input', scoring: false, valueKind: 'string' },
  textarea: { type: 'textarea', category: 'standard', label: 'Long text', description: 'Multi-line text area', scoring: false, valueKind: 'string' },
  number: { type: 'number', category: 'standard', label: 'Number', description: 'Numeric input with optional units', scoring: false, valueKind: 'number' },
  date: { type: 'date', category: 'standard', label: 'Date', description: 'Date picker', scoring: false, valueKind: 'string' },
  datetime: { type: 'datetime', category: 'standard', label: 'Date & time', description: 'Date + time picker', scoring: false, valueKind: 'string' },
  time: { type: 'time', category: 'standard', label: 'Time', description: 'Time picker', scoring: false, valueKind: 'string' },
  email: { type: 'email', category: 'standard', label: 'Email', description: 'Email address with validation', scoring: false, valueKind: 'string' },
  phone: { type: 'phone', category: 'standard', label: 'Phone', description: 'Phone number', scoring: false, valueKind: 'string' },
  url: { type: 'url', category: 'standard', label: 'URL', description: 'Web link', scoring: false, valueKind: 'string' },

  // choice
  radio: { type: 'radio', category: 'choice', label: 'Single choice', description: 'Pick one option', scoring: false, valueKind: 'string' },
  checkbox_group: { type: 'checkbox_group', category: 'choice', label: 'Multiple checkboxes', description: 'Pick several options', scoring: false, valueKind: 'string_array' },
  select: { type: 'select', category: 'choice', label: 'Dropdown', description: 'Single-select dropdown', scoring: false, valueKind: 'string' },
  multi_select: { type: 'multi_select', category: 'choice', label: 'Multi-select dropdown', description: 'Multi-select dropdown', scoring: false, valueKind: 'string_array' },

  // scoring
  pass_fail_na: { type: 'pass_fail_na', category: 'scoring', label: 'Pass / Fail / N/A', description: 'Compliance checkpoint', scoring: true, valueKind: 'string' },
  rating: { type: 'rating', category: 'scoring', label: 'Rating', description: 'Numeric scale (e.g. 1–5)', scoring: true, valueKind: 'number' },
  yes_no_comment: { type: 'yes_no_comment', category: 'scoring', label: 'Yes / No + comment', description: 'Yes/No with required comment on No', scoring: true, valueKind: 'compound' },
  traffic_light: { type: 'traffic_light', category: 'scoring', label: 'Traffic light', description: 'Green / Yellow / Red status', scoring: true, valueKind: 'string' },

  // pickers
  person_picker: { type: 'person_picker', category: 'picker', label: 'Person', description: 'Pick a person from the directory', scoring: false, valueKind: 'entity_ref' },
  site_picker: { type: 'site_picker', category: 'picker', label: 'Site', description: 'Pick a site/location', scoring: false, valueKind: 'entity_ref' },
  equipment_picker: { type: 'equipment_picker', category: 'picker', label: 'Equipment', description: 'Pick equipment / asset', scoring: false, valueKind: 'entity_ref' },
  ppe_picker: { type: 'ppe_picker', category: 'picker', label: 'PPE', description: 'Pick a PPE item', scoring: false, valueKind: 'entity_ref' },
  document_picker: { type: 'document_picker', category: 'picker', label: 'Document', description: 'Reference a document from the library', scoring: false, valueKind: 'entity_ref' },
  course_picker: { type: 'course_picker', category: 'picker', label: 'Training course', description: 'Reference a training course', scoring: false, valueKind: 'entity_ref' },

  // media
  photo: { type: 'photo', category: 'media', label: 'Photo', description: 'Camera / gallery upload with annotation', scoring: false, valueKind: 'attachment_id_array' },
  file: { type: 'file', category: 'media', label: 'File', description: 'PDF / Word / Excel upload', scoring: false, valueKind: 'attachment_id_array' },
  video: { type: 'video', category: 'media', label: 'Video', description: 'Short video upload', scoring: false, valueKind: 'attachment_id_array' },
  audio: { type: 'audio', category: 'media', label: 'Audio note', description: 'Voice recording', scoring: false, valueKind: 'attachment_id_array' },

  // identity
  signature: { type: 'signature', category: 'identity', label: 'Signature', description: 'Drawn signature on glass', scoring: false, valueKind: 'attachment_id' },
  typed_attestation: { type: 'typed_attestation', category: 'identity', label: 'Typed attestation', description: 'Typed name + checkbox', scoring: false, valueKind: 'compound' },

  // computed
  formula: { type: 'formula', category: 'computed', label: 'Formula', description: 'Computed from other fields', scoring: false, valueKind: 'number' },
  risk_matrix: { type: 'risk_matrix', category: 'computed', label: 'Risk matrix', description: 'Severity × likelihood', scoring: true, valueKind: 'compound' },

  // display
  heading: { type: 'heading', category: 'display', label: 'Heading', description: 'Section heading text', scoring: false, valueKind: 'none' },
  paragraph: { type: 'paragraph', category: 'display', label: 'Paragraph', description: 'Static help text / instructions', scoring: false, valueKind: 'none' },
  image: { type: 'image', category: 'display', label: 'Image', description: 'Display-only embedded image', scoring: false, valueKind: 'none' },
  divider: { type: 'divider', category: 'display', label: 'Divider', description: 'Visual separator', scoring: false, valueKind: 'none' },
}

export function isScoringField(type: FieldType): boolean {
  return FIELD_TYPES[type].scoring
}
