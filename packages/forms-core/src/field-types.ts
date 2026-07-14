import type { FieldType, FormField } from './schema'

export type FieldTypeMeta = {
  type: FieldType
  category:
    | 'standard'
    | 'choice'
    | 'scoring'
    | 'picker'
    | 'media'
    | 'identity'
    | 'computed'
    | 'data'
    | 'display'
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
    | 'attachment'
    | 'attachment_array'
    | 'entity_ref'
    | 'entity_ref_array'
    | 'compound'
    | 'none'
}

export const FIELD_TYPES: Record<FieldType, FieldTypeMeta> = {
  // standard
  text: {
    type: 'text',
    category: 'standard',
    label: 'Short text',
    description: 'Single-line text input',
    scoring: false,
    valueKind: 'string',
  },
  long_text: {
    type: 'long_text',
    category: 'standard',
    label: 'Long text',
    description: 'Multi-line text area',
    scoring: false,
    valueKind: 'string',
  },
  number: {
    type: 'number',
    category: 'standard',
    label: 'Number',
    description: 'Numeric input with optional units',
    scoring: false,
    valueKind: 'number',
  },
  slider: {
    type: 'slider',
    category: 'standard',
    label: 'Slider',
    description: 'Pick a number on a min–max range',
    scoring: false,
    valueKind: 'number',
  },
  date: {
    type: 'date',
    category: 'standard',
    label: 'Date',
    description: 'Date picker',
    scoring: false,
    valueKind: 'string',
  },
  datetime: {
    type: 'datetime',
    category: 'standard',
    label: 'Date & time',
    description: 'Date + time picker',
    scoring: false,
    valueKind: 'string',
  },
  time: {
    type: 'time',
    category: 'standard',
    label: 'Time',
    description: 'Time picker',
    scoring: false,
    valueKind: 'string',
  },
  gps: {
    type: 'gps',
    category: 'standard',
    label: 'Location (GPS)',
    description: 'Capture the device location',
    scoring: false,
    valueKind: 'compound',
  },
  email: {
    type: 'email',
    category: 'standard',
    label: 'Email',
    description: 'Email address with validation',
    scoring: false,
    valueKind: 'string',
  },
  phone: {
    type: 'phone',
    category: 'standard',
    label: 'Phone',
    description: 'Phone number',
    scoring: false,
    valueKind: 'string',
  },
  url: {
    type: 'url',
    category: 'standard',
    label: 'URL',
    description: 'Web link',
    scoring: false,
    valueKind: 'string',
  },
  rich_text: {
    type: 'rich_text',
    category: 'standard',
    label: 'Rich text',
    description: 'Formatted text — bold, lists, links',
    scoring: false,
    valueKind: 'string',
  },
  address: {
    type: 'address',
    category: 'standard',
    label: 'Address',
    description: 'Postal address with autocomplete',
    scoring: false,
    valueKind: 'compound',
  },
  qr_scanner: {
    type: 'qr_scanner',
    category: 'standard',
    label: 'QR / barcode scan',
    description: 'Scan a QR code or barcode with the camera',
    scoring: false,
    valueKind: 'string',
  },
  table: {
    type: 'table',
    category: 'standard',
    label: 'Table',
    description: 'Grid of cells — addable or predefined rows',
    scoring: false,
    valueKind: 'compound',
  },

  // choice
  radio: {
    type: 'radio',
    category: 'choice',
    label: 'Single choice',
    description: 'Pick one option',
    scoring: false,
    valueKind: 'string',
  },
  checkbox_group: {
    type: 'checkbox_group',
    category: 'choice',
    label: 'Multiple checkboxes',
    description: 'Pick several options',
    scoring: false,
    valueKind: 'string_array',
  },
  select: {
    type: 'select',
    category: 'choice',
    label: 'Dropdown',
    description: 'Single-select dropdown',
    scoring: false,
    valueKind: 'string',
  },
  multi_select: {
    type: 'multi_select',
    category: 'choice',
    label: 'Multi-select dropdown',
    description: 'Multi-select dropdown',
    scoring: false,
    valueKind: 'string_array',
  },
  ranking: {
    type: 'ranking',
    category: 'choice',
    label: 'Ranking',
    description: 'Drag options into a ranked order',
    scoring: false,
    valueKind: 'string_array',
  },

  // scoring
  pass_fail_na: {
    type: 'pass_fail_na',
    category: 'scoring',
    label: 'Pass / Fail / N/A',
    description: 'Compliance checkpoint',
    scoring: true,
    valueKind: 'string',
  },
  rating: {
    type: 'rating',
    category: 'scoring',
    label: 'Rating',
    description: 'Numeric scale (e.g. 1–5)',
    scoring: true,
    valueKind: 'number',
  },
  yes_no_comment: {
    type: 'yes_no_comment',
    category: 'scoring',
    label: 'Yes / No + comment',
    description: 'Yes/No with required comment on No',
    scoring: true,
    valueKind: 'compound',
  },
  traffic_light: {
    type: 'traffic_light',
    category: 'scoring',
    label: 'Traffic light',
    description: 'Green / Yellow / Red status',
    scoring: true,
    valueKind: 'string',
  },
  matrix: {
    type: 'matrix',
    category: 'choice',
    label: 'Rating grid',
    description: 'Rate each row on a shared scale (Likert)',
    scoring: false,
    valueKind: 'compound',
  },

  // pickers
  person_picker: {
    type: 'person_picker',
    category: 'picker',
    label: 'Person',
    description: 'Pick a person from the directory',
    scoring: false,
    valueKind: 'entity_ref',
  },
  multi_person_picker: {
    type: 'multi_person_picker',
    category: 'picker',
    label: 'People (multiple)',
    description: 'Pick one or more people from the directory',
    scoring: false,
    valueKind: 'entity_ref_array',
  },
  customer_picker: {
    type: 'customer_picker',
    category: 'picker',
    label: 'Customer',
    description: 'Pick a customer (org unit at the customer level)',
    scoring: false,
    valueKind: 'entity_ref',
  },
  site_picker: {
    type: 'site_picker',
    category: 'picker',
    label: 'Site',
    description: 'Pick a site/location (org unit at the site level)',
    scoring: false,
    valueKind: 'entity_ref',
  },
  project_picker: {
    type: 'project_picker',
    category: 'picker',
    label: 'Project',
    description: 'Pick a project / job (org unit at the project level)',
    scoring: false,
    valueKind: 'entity_ref',
  },
  area_picker: {
    type: 'area_picker',
    category: 'picker',
    label: 'Area',
    description: 'Pick an area (org unit at the area level)',
    scoring: false,
    valueKind: 'entity_ref',
  },
  // media
  photo: {
    type: 'photo',
    category: 'media',
    label: 'Photo',
    description: 'Camera / gallery upload with annotation',
    scoring: false,
    valueKind: 'attachment_array',
  },
  photo_upload: {
    type: 'photo_upload',
    category: 'media',
    label: 'Photo upload',
    description: 'Camera / gallery upload (alias of photo)',
    scoring: false,
    valueKind: 'attachment_array',
  },
  photo_ai: {
    type: 'photo_ai',
    category: 'media',
    label: 'Photo + AI analysis',
    description: 'Capture a photo and flag missing PPE / hazards with AI',
    scoring: false,
    valueKind: 'compound',
  },
  photo_annotated: {
    type: 'photo_annotated',
    category: 'media',
    label: 'Photo + markup',
    description: 'Capture a photo and drop numbered markers on hazards',
    scoring: false,
    valueKind: 'compound',
  },
  file: {
    type: 'file',
    category: 'media',
    label: 'File',
    description: 'PDF / Word / Excel upload',
    scoring: false,
    valueKind: 'attachment_array',
  },
  video: {
    type: 'video',
    category: 'media',
    label: 'Video',
    description: 'Short video upload',
    scoring: false,
    valueKind: 'attachment_array',
  },
  audio: {
    type: 'audio',
    category: 'media',
    label: 'Audio note',
    description: 'Voice recording',
    scoring: false,
    valueKind: 'attachment_array',
  },
  sketch: {
    type: 'sketch',
    category: 'media',
    label: 'Diagram / sketch',
    description: 'Freehand drawing canvas — shapes, arrows, text (Excalidraw)',
    scoring: false,
    valueKind: 'compound',
  },

  // identity
  signature: {
    type: 'signature',
    category: 'identity',
    label: 'Signature',
    description: 'Drawn signature on glass',
    scoring: false,
    valueKind: 'compound',
  },
  typed_attestation: {
    type: 'typed_attestation',
    category: 'identity',
    label: 'Typed attestation',
    description: 'Typed name + checkbox',
    scoring: false,
    valueKind: 'compound',
  },

  // computed
  formula: {
    type: 'formula',
    category: 'computed',
    label: 'Formula',
    description: 'Computed from other fields',
    scoring: false,
    valueKind: 'none',
  },
  risk_matrix: {
    type: 'risk_matrix',
    category: 'computed',
    label: 'Risk matrix',
    description: 'Severity × likelihood',
    scoring: true,
    valueKind: 'compound',
  },

  // data-bound
  lookup: {
    type: 'lookup',
    category: 'data',
    label: 'Lookup',
    description: 'Pick a record from a data source — can auto-fill other fields',
    scoring: false,
    valueKind: 'string',
  },
  data_table: {
    type: 'data_table',
    category: 'data',
    label: 'Data table',
    description: 'Show or select rows from a data source',
    scoring: false,
    valueKind: 'string_array',
  },
  metric: {
    type: 'metric',
    category: 'data',
    label: 'KPI / chart',
    description: 'A live number or chart aggregated from a data source',
    scoring: false,
    valueKind: 'none',
  },

  // display
  heading: {
    type: 'heading',
    category: 'display',
    label: 'Heading',
    description: 'Section heading text',
    scoring: false,
    valueKind: 'none',
  },
  paragraph: {
    type: 'paragraph',
    category: 'display',
    label: 'Paragraph',
    description: 'Static help text / instructions',
    scoring: false,
    valueKind: 'none',
  },
  divider: {
    type: 'divider',
    category: 'display',
    label: 'Divider',
    description: 'Visual separator',
    scoring: false,
    valueKind: 'none',
  },
}

export function isScoringField(type: FieldType): boolean {
  return FIELD_TYPES[type].scoring
}

/** Whether a field owns a caller-supplied value in a persisted response. */
export function isResponseValueField(type: FieldType): boolean {
  return FIELD_TYPES[type].valueKind !== 'none'
}

/** Whether this configured field instance owns a persisted response value. */
export function storesResponseValue(field: FormField): boolean {
  if (!isResponseValueField(field.type)) return false
  if (field.type !== 'data_table') return true
  return field.binding?.selectable === 'single' || field.binding?.selectable === 'multi'
}
