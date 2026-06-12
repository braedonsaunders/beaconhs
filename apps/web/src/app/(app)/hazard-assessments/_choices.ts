// Curated option vocabularies for the structured sub-form fields. The legacy
// app stored these as small lookup tables (WAHCommunication / WAHAccess /
// WAHEquipment); here they're curated constants — every multi-pick field also
// accepts free-text additions, so crews are never blocked by the list.

export const WAH_TYPES = [
  'Ladder',
  'Step ladder',
  'Scaffold',
  'Elevated work platform (EWP)',
  'Scissor lift',
  'Boom lift',
  'Roof work',
  'Suspended access',
  'Leading edge',
] as const

export const WAH_COMMUNICATION = [
  'Radio',
  'Hand signals',
  'Verbal / line of sight',
  'Spotter',
  'Air horn / whistle',
  'Phone',
] as const

export const WAH_ACCESS = [
  'Extension ladder',
  'Step ladder',
  'Scaffold stair tower',
  'Scissor lift',
  'Boom lift',
  'Fixed stairs / platform',
  'Man basket',
] as const

export const WAH_EQUIPMENT = [
  'Full-body harness',
  'Shock-absorbing lanyard',
  'Self-retracting lifeline (SRL)',
  'Engineered anchor point',
  'Horizontal lifeline',
  'Guardrails',
  'Travel restraint',
  'Safety net',
  'Ladder tie-off',
] as const

export const CS_COMMUNICATION = [
  'Voice',
  'Radio',
  'Hand signals',
  'Rope signals',
  'Air horn',
  'Intrinsically safe phone',
] as const

export const CS_RESCUE_EQUIPMENT = [
  'Tripod & winch',
  'Retrieval line',
  'Full-body harness',
  'SCBA',
  'Supplied-air respirator',
  'Stretcher / SKED',
  'First aid kit',
  'Resuscitator / O₂ kit',
  'Fire extinguisher',
] as const

export const ARC_FLASH_PPE = [
  'Arc-rated shirt & pants',
  'Arc-rated coverall',
  'Arc-flash suit (40 cal/cm²)',
  'Arc-rated face shield',
  'Arc-rated balaclava',
  'Arc-flash hood',
  'Insulated rubber gloves + leather protectors',
  'Hard hat (Class E)',
  'Safety glasses',
  'Hearing protection',
  'Leather footwear',
] as const

export const ARC_FLASH_LEVELS = ['HRC 0', 'HRC 1', 'HRC 2', 'HRC 3', 'HRC 4'] as const

export const CS_TYPE_OPTIONS = [
  { value: 'integrated', label: 'Integrated permit (this form)' },
  { value: 'paper', label: 'Paper permit (attached separately)' },
] as const

export const CS_RESCUE_STYLE_OPTIONS = [
  { value: 'entry', label: 'Entry rescue (trained team enters)' },
  { value: 'non_entry', label: 'Non-entry rescue (retrieval from outside)' },
] as const
