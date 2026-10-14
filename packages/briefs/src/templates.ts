// Built-in brief templates. Picking one creates an ordinary, fully editable
// brief; the template key is kept on the brief for provenance only.

import type { BriefSpec, BriefWindowSpec } from '@beaconhs/db/schema'

export type BriefTemplate = {
  key: string
  name: string
  description: string
  spec: BriefSpec
  /** Sensible defaults for the first schedule created from this template. */
  schedule: {
    cadence: 'daily' | 'weekly' | 'monthly'
    weekdaysOnly: boolean
    dayOfWeek: number | null
    dayOfMonth: number | null
    hour: number
    minute: number
    window: BriefWindowSpec
    split: 'none' | 'department'
  }
}

export const BRIEF_TEMPLATES: readonly BriefTemplate[] = [
  {
    key: 'daily-company-journal',
    name: 'Daily company journal brief',
    description:
      'The morning leadership briefing from every journal written the previous business day — Monday covers the weekend.',
    spec: {
      version: 1,
      sources: [{ key: 'journals.entries', params: { includeDrafts: true, includeLate: true } }],
      instructions:
        'This is the morning company-wide journal summary for leadership. Focus on meaningful work completed or underway; operational risks, blockers, weather impacts, safety concerns, and billing or admin issues; notable wins, customer signals, and delivery progress; and patterns that matter across departments. Give more operational detail, examples, and context than a short digest so it reads as a full morning briefing.',
      sections: [
        {
          key: 'executive_summary',
          title: 'Executive Summary',
          guidance: 'The few points leadership must know first.',
          maxBullets: 5,
        },
        {
          key: 'department_highlights',
          title: 'Department Highlights',
          guidance: 'Concrete activity by department or team where the journals support it.',
          maxBullets: 12,
        },
        {
          key: 'key_wins',
          title: 'Key Wins',
          guidance: 'Completed work, customer praise, milestones.',
          maxBullets: 6,
        },
        {
          key: 'risks_and_blockers',
          title: 'Risks And Blockers',
          guidance:
            'Safety concerns, delays, weather, equipment, staffing, billing or admin issues.',
          maxBullets: 8,
        },
      ],
      targetWords: 750,
      tier: 'smart',
      emptyPolicy: 'send_notice',
      compareWithPrevious: true,
    },
    schedule: {
      cadence: 'daily',
      weekdaysOnly: true,
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 7,
      minute: 5,
      window: { mode: 'previous_business_day' },
      split: 'none',
    },
  },
  {
    key: 'department-daily-journal',
    name: 'Department daily journal brief',
    description:
      "Each recipient gets a brief of their own department's journals from the previous business day.",
    spec: {
      version: 1,
      sources: [{ key: 'journals.entries', params: { includeDrafts: true, includeLate: true } }],
      instructions:
        "Write for the department's manager. Be concrete about crews, sites, and people; call out anything that needs the manager's attention today.",
      sections: [
        { key: 'overview', title: 'Overview', guidance: 'What the team did.', maxBullets: 6 },
        {
          key: 'issues',
          title: 'Issues To Act On',
          guidance: 'Safety, delays, equipment, staffing.',
          maxBullets: 6,
        },
        {
          key: 'recognition',
          title: 'Worth Recognising',
          guidance: 'Good work worth a thank-you.',
          maxBullets: 4,
        },
      ],
      targetWords: 400,
      tier: 'smart',
      emptyPolicy: 'skip',
      compareWithPrevious: false,
    },
    schedule: {
      cadence: 'daily',
      weekdaysOnly: true,
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 7,
      minute: 0,
      window: { mode: 'previous_business_day' },
      split: 'department',
    },
  },
  {
    key: 'weekly-safety-pulse',
    name: 'Weekly safety pulse',
    description:
      'Incidents, corrective actions, inspection and PPE failures, and hazard assessments from the last seven days.',
    spec: {
      version: 1,
      sources: [
        { key: 'incidents', params: {} },
        { key: 'corrective_actions', params: {} },
        { key: 'inspections', params: {} },
        { key: 'ppe_inspections', params: {} },
        { key: 'hazard_assessments', params: {} },
      ],
      instructions:
        'Write for the health and safety manager. Lead with the highest-severity items, connect incidents to failed inspections or hazards where the records support it, and be blunt about overdue corrective actions.',
      sections: [
        { key: 'headline_risks', title: 'Headline Risks', guidance: '', maxBullets: 5 },
        {
          key: 'incidents',
          title: 'Incidents',
          guidance: 'What happened and status.',
          maxBullets: 8,
        },
        {
          key: 'controls',
          title: 'Inspections And Controls',
          guidance: 'Failed inspections, PPE failures, hazard assessments.',
          maxBullets: 8,
        },
        {
          key: 'corrective_actions',
          title: 'Corrective Actions',
          guidance: 'Opened, closed, overdue.',
          maxBullets: 8,
        },
      ],
      targetWords: 700,
      tier: 'smart',
      emptyPolicy: 'send_notice',
      compareWithPrevious: true,
    },
    schedule: {
      cadence: 'weekly',
      weekdaysOnly: false,
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: 7,
      minute: 30,
      window: { mode: 'last_n_days', days: 7 },
      split: 'none',
    },
  },
  {
    key: 'monthly-leadership-hse',
    name: 'Monthly leadership HSE brief',
    description:
      'A month of incidents, corrective actions, inspections, equipment work orders, and journals for leadership.',
    spec: {
      version: 1,
      sources: [
        { key: 'incidents', params: {} },
        { key: 'corrective_actions', params: {} },
        { key: 'inspections', params: {} },
        { key: 'equipment_work_orders', params: {} },
        { key: 'journals.entries', params: { includeDrafts: false, includeLate: false } },
      ],
      instructions:
        'Write for the executive team. Focus on trends, recurring problems, and decisions needed — not individual line items unless they are serious.',
      sections: [
        { key: 'summary', title: 'Month In Review', guidance: '', maxBullets: 6 },
        { key: 'safety', title: 'Safety Performance', guidance: '', maxBullets: 8 },
        { key: 'operations', title: 'Operations And Equipment', guidance: '', maxBullets: 8 },
        { key: 'decisions', title: 'Decisions Needed', guidance: '', maxBullets: 5 },
      ],
      targetWords: 900,
      tier: 'smart',
      emptyPolicy: 'send_notice',
      compareWithPrevious: true,
    },
    schedule: {
      cadence: 'monthly',
      weekdaysOnly: false,
      dayOfWeek: null,
      dayOfMonth: 1,
      hour: 8,
      minute: 0,
      window: { mode: 'since_last_run' },
      split: 'none',
    },
  },
  {
    key: 'journal-pulse',
    name: 'Journal pulse',
    description:
      'Themes, sentiment, and issues across the last 30 days of journals — the AI journal widget for Insights.',
    spec: {
      version: 1,
      sources: [{ key: 'journals.entries', params: { includeDrafts: true, includeLate: false } }],
      instructions:
        'Write for the safety manager. Describe the overall mood and recurring themes across the period, surface concrete issues by site, and recommend actions with a sensible owner.',
      sections: [
        {
          key: 'themes',
          title: 'Themes',
          guidance: 'Recurring topics, most frequent first.',
          maxBullets: 6,
        },
        {
          key: 'issues',
          title: 'Issues',
          guidance: 'Concrete problems, with the site.',
          maxBullets: 6,
        },
        {
          key: 'mood',
          title: 'Mood',
          guidance: 'How the field is feeling, and why.',
          maxBullets: 3,
        },
      ],
      targetWords: 450,
      tier: 'smart',
      emptyPolicy: 'send_notice',
      compareWithPrevious: true,
    },
    schedule: {
      cadence: 'daily',
      weekdaysOnly: true,
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 6,
      minute: 0,
      window: { mode: 'last_n_days', days: 30 },
      split: 'none',
    },
  },
]

export function getBriefTemplate(key: string): BriefTemplate | null {
  return BRIEF_TEMPLATES.find((template) => template.key === key) ?? null
}
