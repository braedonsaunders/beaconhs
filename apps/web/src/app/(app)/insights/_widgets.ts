// Catalogue of Insights dashboard widgets. Pure data — imported by both the
// server page and the client grid/palette.

import type { BhqlQuery, InsightDashboardLayout } from '@beaconhs/db/schema'

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
    label: 'Active monitored sessions',
    description: 'Live monitored sessions across every app.',
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

/** Built-in widgets that are now real BHQL-backed cards: the dashboard runs these
 *  queries under RLS and renders them through the SAME engine + visualization as
 *  user-built cards (no per-tenant seeding — the keys are stable). Widgets without
 *  an entry here still render via the legacy WidgetView (the few computed rollups
 *  + the on-demand AI journal analysis). */
export const BUILTIN_QUERIES: Record<
  string,
  { query: BhqlQuery; vizType: string; vizSettings?: Record<string, unknown> }
> = {
  'kpi-incidents': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          filter: {
            combinator: 'and',
            rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 30 }],
          },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-open-cas': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'corrective_actions',
          filter: { combinator: 'and', rules: [{ field: 'status', op: 'eq', value: 'open' }] },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'chart-severity': {
    vizType: 'row',
    vizSettings: {
      showValues: true,
      colorByCategory: true,
      colors: {
        fatality: '#0f172a',
        lost_time: '#e11d48',
        medical_aid: '#fb7185',
        first_aid_only: '#f59e0b',
        no_injury: '#94a3b8',
      },
    },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          breakouts: [{ field: 'severity', alias: 'severity' }],
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'journal-total': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [{ source: 'journal_entries', aggregations: [{ fn: 'count', alias: 'count' }] }],
    },
  },
  'journal-last30': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entries',
          filter: {
            combinator: 'and',
            rules: [{ field: 'created_at', op: 'between_days_ago', value: 30 }],
          },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'journal-activity': {
    vizType: 'area',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entries',
          breakouts: [
            { field: 'created_at', alias: 'week', bin: { kind: 'temporal', unit: 'week' } },
          ],
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  // TRIR = recordable incidents ÷ hours worked × 200000, over the trailing year.
  // View-free: recordables come from `incidents`, hours from the separate
  // `incident_hours_periods` table, joined by the cross-source engine (no grain →
  // CROSS JOIN of two single-row aggregates). Replaces the report_incident_rates view.
  'chart-trir': {
    vizType: 'scalar',
    vizSettings: { valueField: 'trir', decimals: 2 },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          filter: {
            combinator: 'and',
            rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 365 }],
          },
          aggregations: [
            {
              fn: 'count',
              alias: 'rec',
              filter: {
                combinator: 'and',
                rules: [
                  { field: 'severity', op: 'in', value: ['medical_aid', 'lost_time', 'fatality'] },
                ],
              },
            },
            {
              kind: 'calc',
              alias: 'trir',
              numerator: 'rec',
              denominator: 'hrs',
              multiplier: 200000,
            },
          ],
          joinedSources: [
            {
              source: 'incident_hours_periods',
              filter: {
                combinator: 'and',
                rules: [{ field: 'period_start', op: 'between_days_ago', value: 365 }],
              },
              measures: [{ fn: 'sum', field: 'total_hours', alias: 'hrs' }],
              on: [],
            },
          ],
        },
      ],
    },
  },
  // DART = lost-time/restricted incidents ÷ hours worked × 200000 (OSHA), trailing
  // year. Same view-free cross-source shape as TRIR; numerator = lost_time incidents.
  'chart-dart': {
    vizType: 'scalar',
    vizSettings: { valueField: 'dart', decimals: 2 },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          filter: {
            combinator: 'and',
            rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 365 }],
          },
          aggregations: [
            {
              fn: 'count',
              alias: 'd',
              filter: {
                combinator: 'and',
                rules: [{ field: 'lost_time', op: 'is_true' }],
              },
            },
            { kind: 'calc', alias: 'dart', numerator: 'd', denominator: 'hrs', multiplier: 200000 },
          ],
          joinedSources: [
            {
              source: 'incident_hours_periods',
              filter: {
                combinator: 'and',
                rules: [{ field: 'period_start', op: 'between_days_ago', value: 365 }],
              },
              measures: [{ fn: 'sum', field: 'total_hours', alias: 'hrs' }],
              on: [],
            },
          ],
        },
      ],
    },
  },
  // Journals grouped by SITE NAME — follows the site_org_unit_id FK to org_units.
  'journal-by-site': {
    vizType: 'bar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entries',
          breakouts: [{ field: 'site_org_unit_id.name', alias: 'site' }],
          aggregations: [{ fn: 'count', alias: 'count' }],
          orderBy: [{ ref: 'count', direction: 'desc' }],
          limit: 12,
        },
      ],
    },
  },
  // Top tags — a plain group-by on the normalized journal_entry_tags table.
  'journal-top-topics': {
    vizType: 'bar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entry_tags',
          breakouts: [{ field: 'tag', alias: 'tag' }],
          aggregations: [{ fn: 'count', alias: 'count' }],
          orderBy: [{ ref: 'count', direction: 'desc' }],
          limit: 12,
        },
      ],
    },
  },
  'journal-people': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entries',
          aggregations: [{ fn: 'count_distinct', field: 'person_id', alias: 'count' }],
        },
      ],
    },
  },
  'chart-top-sites': {
    vizType: 'row',
    vizSettings: { showValues: true, colorByCategory: true },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          filter: {
            combinator: 'and',
            rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 90 }],
          },
          breakouts: [{ field: 'site_org_unit_id.name', alias: 'site' }],
          aggregations: [{ fn: 'count', alias: 'count' }],
          orderBy: [{ ref: 'count', direction: 'desc' }],
          limit: 5,
        },
      ],
    },
  },
  'kpi-overdue-cas': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'corrective_actions',
          filter: {
            combinator: 'and',
            rules: [
              { field: 'closed_at', op: 'is_null' },
              { field: 'due_on', op: 'before_now' },
            ],
          },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-submissions': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'form_responses',
          filter: { combinator: 'and', rules: [{ field: 'submitted_at', op: 'since_today' }] },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-inspections': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'inspection_records',
          filter: {
            combinator: 'and',
            rules: [
              { field: 'occurred_at', op: 'this_month' },
              { field: 'status', op: 'in', value: ['submitted', 'closed'] },
            ],
          },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-people': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'people',
          filter: { combinator: 'and', rules: [{ field: 'status', op: 'eq', value: 'active' }] },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-ppe-issues': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'ppe_issue_reports',
          filter: { combinator: 'and', rules: [{ field: 'status', op: 'eq', value: 'open' }] },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  'kpi-lw-active': {
    vizType: 'scalar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'form_responses',
          filter: {
            combinator: 'and',
            rules: [{ field: 'monitor_status', op: 'eq', value: 'active' }],
          },
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  // Training compliance % — off the unified compliance engine's scoreboard
  // (compliance_status), filtered to training + cert obligations via the
  // obligation FK. Replaces the decommissioned legacy assignment-records table.
  'kpi-training-compliance': {
    vizType: 'scalar',
    vizSettings: { valueField: 'pct', decimals: 0, suffix: '%' },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'compliance_status',
          filter: {
            combinator: 'and',
            rules: [
              {
                field: 'obligation_id.source_module',
                op: 'in',
                value: ['training', 'cert_requirement'],
              },
            ],
          },
          aggregations: [
            { fn: 'count', alias: 'total' },
            {
              fn: 'count',
              alias: 'completed',
              filter: {
                combinator: 'and',
                rules: [{ field: 'status', op: 'eq', value: 'completed' }],
              },
            },
            {
              kind: 'calc',
              alias: 'pct',
              numerator: 'completed',
              denominator: 'total',
              multiplier: 100,
            },
          ],
        },
      ],
    },
  },
  // Document compliance % — straight off the unified compliance engine's
  // materialized scoreboard (compliance_status), filtered to document obligations
  // via the obligation FK. No many-to-many audience resolution, no view, no JS loop.
  'kpi-doc-compliance': {
    vizType: 'scalar',
    vizSettings: { valueField: 'pct', decimals: 0, suffix: '%' },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'compliance_status',
          filter: {
            combinator: 'and',
            rules: [{ field: 'obligation_id.source_module', op: 'eq', value: 'document' }],
          },
          aggregations: [
            { fn: 'count', alias: 'total' },
            {
              fn: 'count',
              alias: 'done',
              filter: {
                combinator: 'and',
                rules: [{ field: 'status', op: 'eq', value: 'completed' }],
              },
            },
            {
              kind: 'calc',
              alias: 'pct',
              numerator: 'done',
              denominator: 'total',
              multiplier: 100,
            },
          ],
        },
      ],
    },
  },
  // Days since the last recordable incident — a custom aggregation (datediff over
  // the latest recordable's date), no view, no JS.
  'kpi-days-recordable': {
    vizType: 'scalar',
    vizSettings: { valueField: 'days', decimals: 0 },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'incidents',
          aggregations: [
            {
              kind: 'expr',
              alias: 'days',
              expr: {
                ex: 'call',
                fn: 'datediff',
                args: [
                  { ex: 'lit', value: 'day' },
                  {
                    ex: 'agg',
                    fn: 'max',
                    arg: { ex: 'field', field: 'occurred_at' },
                    filter: {
                      combinator: 'and',
                      rules: [
                        {
                          field: 'severity',
                          op: 'in',
                          value: ['medical_aid', 'lost_time', 'fatality'],
                        },
                      ],
                    },
                  },
                  { ex: 'call', fn: 'now', args: [] },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  // Open corrective actions bucketed by age — a computed CASE breakout (datediff
  // age vs created_at), no view.
  'chart-ca-aging': {
    vizType: 'row',
    vizSettings: {
      showValues: true,
      colorByCategory: true,
      colors: {
        '< 7 days': '#10b981',
        '7–30 days': '#14b8a6',
        '30–60 days': '#f59e0b',
        '60+ days': '#e11d48',
      },
    },
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'corrective_actions',
          filter: { combinator: 'and', rules: [{ field: 'closed_at', op: 'is_null' }] },
          breakouts: [
            {
              alias: 'bucket',
              expr: {
                ex: 'case',
                branches: [
                  {
                    when: {
                      ex: 'compare',
                      op: '<',
                      left: {
                        ex: 'call',
                        fn: 'datediff',
                        args: [
                          { ex: 'lit', value: 'day' },
                          { ex: 'field', field: 'created_at' },
                          { ex: 'call', fn: 'now', args: [] },
                        ],
                      },
                      right: { ex: 'lit', value: 7 },
                    },
                    then: { ex: 'lit', value: '< 7 days' },
                  },
                  {
                    when: {
                      ex: 'compare',
                      op: '<',
                      left: {
                        ex: 'call',
                        fn: 'datediff',
                        args: [
                          { ex: 'lit', value: 'day' },
                          { ex: 'field', field: 'created_at' },
                          { ex: 'call', fn: 'now', args: [] },
                        ],
                      },
                      right: { ex: 'lit', value: 30 },
                    },
                    then: { ex: 'lit', value: '7–30 days' },
                  },
                  {
                    when: {
                      ex: 'compare',
                      op: '<',
                      left: {
                        ex: 'call',
                        fn: 'datediff',
                        args: [
                          { ex: 'lit', value: 'day' },
                          { ex: 'field', field: 'created_at' },
                          { ex: 'call', fn: 'now', args: [] },
                        ],
                      },
                      right: { ex: 'lit', value: 60 },
                    },
                    then: { ex: 'lit', value: '30–60 days' },
                  },
                ],
                else: { ex: 'lit', value: '60+ days' },
              },
            },
          ],
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    },
  },
  // Journals by weekday — a datepart('dow') computed breakout, no view.
  'journal-by-dow': {
    vizType: 'bar',
    query: {
      version: 'bhql/1',
      display: 'table',
      pivot: null,
      stages: [
        {
          source: 'journal_entries',
          breakouts: [
            {
              alias: 'dow',
              expr: {
                ex: 'call',
                fn: 'datepart',
                args: [
                  { ex: 'lit', value: 'dow' },
                  { ex: 'field', field: 'entry_date' },
                ],
              },
            },
          ],
          aggregations: [{ fn: 'count', alias: 'count' }],
          orderBy: [{ ref: 'dow', direction: 'asc' }],
        },
      ],
    },
  },
}
