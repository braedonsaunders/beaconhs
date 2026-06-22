// Friendly, branded labels for the internal form-template `category` keys. The
// raw keys (e.g. 'jsha') must NEVER surface to a user — JHSA is branded "Hazard
// Assessment" everywhere, like the native module. Unknown categories fall back to
// a humanised version of the key.

const FORM_CATEGORY_LABELS: Record<string, string> = {
  jsha: 'Hazard Assessment',
  toolbox_talk: 'Toolbox Talk',
  inspection: 'Inspection',
  equipment_inspection: 'Equipment Inspection',
  incident_investigation: 'Incident Investigation',
  lift_plan: 'Lift Plan',
  lone_worker: 'Lone Worker',
  wah: 'Working at Heights',
  custom: 'Custom',
}

export function formCategoryLabel(category: string | null | undefined): string {
  if (!category) return ''
  const known = FORM_CATEGORY_LABELS[category]
  if (known) return known
  const spaced = category.replace(/_/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
