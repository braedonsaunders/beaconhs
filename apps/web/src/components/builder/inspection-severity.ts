export const INSPECTION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export type InspectionSeverity = (typeof INSPECTION_SEVERITIES)[number]

export const INSPECTION_SEVERITY_LABELS: Record<InspectionSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High (creates corrective action)',
  critical: 'Critical (creates corrective action)',
}

export function inspectionSeverityBadgeVariant(
  severity: InspectionSeverity,
): 'destructive' | 'warning' | 'secondary' {
  if (severity === 'critical' || severity === 'high') return 'destructive'
  return severity === 'medium' ? 'warning' : 'secondary'
}
