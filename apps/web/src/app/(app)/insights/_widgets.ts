// Catalogue of Insights dashboard widgets. Pure data — imported by both the
// server page and the client grid/palette.

import type { InsightDashboardLayout } from '@beaconhs/db/schema'

export type InsightWidgetCategory = 'ai' | 'journal' | 'safety' | 'compliance' | 'operations'

export type InsightWidgetMeta = {
  id: string
  label: string
  description: string
  category: InsightWidgetCategory
  defaultSize: { w: number; h: number }
  minSize: { w: number; h: number }
}

export const INSIGHT_CATEGORY_LABELS: Record<InsightWidgetCategory, string> = {
  ai: 'AI',
  journal: 'Journals',
  safety: 'Safety',
  compliance: 'Compliance',
  operations: 'Operations',
}

const KPI = { defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 } }
const CHART = { defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 } }

export const INSIGHT_WIDGETS: InsightWidgetMeta[] = [
  // AI
  {
    id: 'ai-analysis',
    label: 'AI journal analysis',
    description:
      'Sentiment, surfaced issues & recommended corrective actions from recent journals.',
    category: 'ai',
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 4, h: 5 },
  },

  // Journals
  {
    id: 'journal-total',
    label: 'Journal entries',
    description: 'Total entries logged.',
    category: 'journal',
    ...KPI,
  },
  {
    id: 'journal-last30',
    label: 'Journals · last 30 days',
    description: 'Entries in the last 30 days.',
    category: 'journal',
    ...KPI,
  },
  {
    id: 'journal-people',
    label: 'People journaling',
    description: 'Distinct people who have logged.',
    category: 'journal',
    ...KPI,
  },
  {
    id: 'journal-activity',
    label: 'Journal activity',
    description: 'Entries per week, last 12 weeks.',
    category: 'journal',
    ...CHART,
  },
  {
    id: 'journal-by-site',
    label: 'Journals by site',
    description: 'Entry volume per site.',
    category: 'journal',
    ...CHART,
  },
  {
    id: 'journal-top-topics',
    label: 'Top journal topics',
    description: 'Most common AI-tagged topics.',
    category: 'journal',
    ...CHART,
  },
  {
    id: 'journal-by-dow',
    label: 'Journals by weekday',
    description: 'When entries are logged.',
    category: 'journal',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
  },

  // Safety
  {
    id: 'kpi-incidents',
    label: 'Incidents · 30 days',
    description: 'Incidents in the last 30 days vs prior.',
    category: 'safety',
    ...KPI,
  },
  {
    id: 'kpi-days-recordable',
    label: 'Days since recordable',
    description: 'Days since the last recordable incident.',
    category: 'safety',
    ...KPI,
  },
  {
    id: 'kpi-open-cas',
    label: 'Open corrective actions',
    description: 'Currently open CAs.',
    category: 'safety',
    ...KPI,
  },
  {
    id: 'kpi-overdue-cas',
    label: 'Overdue corrective actions',
    description: 'CAs past their due date.',
    category: 'safety',
    ...KPI,
  },
  {
    id: 'chart-trir',
    label: 'TRIR trend',
    description: 'Total recordable incident rate, 12 months.',
    category: 'safety',
    ...CHART,
  },
  {
    id: 'chart-dart',
    label: 'DART trend',
    description: 'Days away / restricted / transfer rate.',
    category: 'safety',
    ...CHART,
  },
  {
    id: 'chart-severity',
    label: 'Severity distribution',
    description: '12-month incident severity pyramid.',
    category: 'safety',
    ...CHART,
  },
  {
    id: 'chart-ca-aging',
    label: 'CA aging',
    description: 'Open corrective actions by age.',
    category: 'safety',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
  },
  {
    id: 'chart-top-sites',
    label: 'Top sites by incidents',
    description: 'Sites with the most incidents.',
    category: 'safety',
    ...CHART,
  },

  // Compliance
  {
    id: 'kpi-training-compliance',
    label: 'Training compliance',
    description: 'Percent of training complete.',
    category: 'compliance',
    ...KPI,
  },
  {
    id: 'kpi-doc-compliance',
    label: 'Document compliance',
    description: 'Percent of documents acknowledged.',
    category: 'compliance',
    ...KPI,
  },

  // Operations
  {
    id: 'kpi-lw-active',
    label: 'Active lone workers',
    description: 'Live lone-worker sessions.',
    category: 'operations',
    ...KPI,
  },
  {
    id: 'kpi-ppe-issues',
    label: 'Open PPE issues',
    description: 'Reported PPE issues outstanding.',
    category: 'operations',
    ...KPI,
  },
  {
    id: 'kpi-submissions',
    label: 'Submissions today',
    description: 'Form submissions logged today.',
    category: 'operations',
    ...KPI,
  },
  {
    id: 'kpi-inspections',
    label: 'Inspections MTD',
    description: 'Inspections completed this month.',
    category: 'operations',
    ...KPI,
  },
  {
    id: 'kpi-people',
    label: 'Active people',
    description: 'Active people on this tenant.',
    category: 'operations',
    ...KPI,
  },
]

export const INSIGHT_WIDGET_MAP = new Map(INSIGHT_WIDGETS.map((w) => [w.id, w]))

export function insightWidget(id: string): InsightWidgetMeta | undefined {
  return INSIGHT_WIDGET_MAP.get(id)
}

/** A sensible starter dashboard for first-time users. */
export const DEFAULT_INSIGHT_LAYOUT: InsightDashboardLayout = {
  widgets: [
    { id: 'journal-total', x: 0, y: 0, w: 3, h: 2 },
    { id: 'journal-last30', x: 3, y: 0, w: 3, h: 2 },
    { id: 'kpi-incidents', x: 6, y: 0, w: 3, h: 2 },
    { id: 'kpi-open-cas', x: 9, y: 0, w: 3, h: 2 },
    { id: 'ai-analysis', x: 0, y: 2, w: 6, h: 6 },
    { id: 'journal-activity', x: 6, y: 2, w: 6, h: 4 },
    { id: 'chart-severity', x: 6, y: 6, w: 6, h: 4 },
    { id: 'journal-top-topics', x: 0, y: 8, w: 6, h: 4 },
    { id: 'journal-by-site', x: 6, y: 10, w: 6, h: 4 },
    { id: 'kpi-training-compliance', x: 0, y: 12, w: 3, h: 2 },
    { id: 'kpi-doc-compliance', x: 3, y: 12, w: 3, h: 2 },
  ],
}
