import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { DashboardMetrics } from './_metrics'

vi.mock('../equipment/_actions', () => ({ checkInEquipment: vi.fn() }))
vi.mock('./_quick-actions', () => ({ QuickActions: () => null }))
vi.mock('@/i18n/generated', async () => {
  const { default: messages } = await import('../../../../../../packages/i18n/src/messages/en.json')
  return {
    GeneratedValue: ({ value }: { value: ReactNode }) => value,
    GeneratedText: ({ id }: { id: string }) => id,
    useGeneratedTranslations:
      () =>
      (key: keyof typeof messages.Generated, values: Record<string, string> = {}) =>
        (messages.Generated[key] ?? key).replace(
          /\{value\d+\}/g,
          (token) => values[token.slice(1, -1)] ?? token,
        ),
    useGeneratedValueTranslations: () => (value: string) => value,
  }
})
import { WidgetCard } from './_widget-views'

function render(items: DashboardMetrics['myPpe']) {
  return renderToStaticMarkup(
    <WidgetCard
      widgetId="personal-my-ppe"
      data={{ myPpe: items } as DashboardMetrics}
      todayIso="2026-10-01"
    />,
  )
}
describe('My PPE assigned gear', () => {
  it('offers pre-use inspections without pills for current annuals or pre-use-only gear', () => {
    const html = render([
      {
        id: 'harness',
        typeName: 'Harness',
        serialNumber: '106164646-104',
        size: null,
        status: 'issued',
        canRecordPreUse: true,
        annualInspectionState: 'current',
        annualInspectionDueOn: '2027-01-21',
      },
      {
        id: 'gloves',
        typeName: 'Protective gloves',
        serialNumber: null,
        size: null,
        status: 'issued',
        canRecordPreUse: true,
        annualInspectionState: 'not_required',
        annualInspectionDueOn: null,
      },
    ])
    expect(html).toContain('Harness')
    expect(html).not.toContain('Current')
    expect(html).toContain('Protective gloves')
    expect(html).not.toContain('Not required')
    expect(html).not.toContain('Annual')
    expect(html).toContain('Assigned PPE: 2')
    expect(html).toContain('kind=pre_use')
    expect(html).not.toContain('kind=annual')
    expect(html).not.toContain('kind=null')
    expect(html).toContain('/ppe/gloves?')
  })
  it('shows annual warnings beside a pre-use-only inspection shortcut', () => {
    const html = render([
      {
        id: 'annual-due',
        typeName: 'Harness',
        serialNumber: '106164646-104',
        size: null,
        status: 'issued',
        canRecordPreUse: true,
        annualInspectionState: 'never_inspected',
        annualInspectionDueOn: null,
      },
    ])
    expect(html).toContain('Annual')
    expect(html).toContain('Never inspected')
    expect(html).toContain('kind=pre_use')
    expect(html).not.toContain('kind=annual')
  })
  it('warns about held out-of-service gear and gives an assignment empty state', () => {
    expect(
      render([
        {
          id: 'failed',
          typeName: 'Harness',
          serialNumber: null,
          size: null,
          status: 'out_of_service',
          canRecordPreUse: false,
          annualInspectionState: 'current',
          annualInspectionDueOn: '2027-01-21',
        },
      ]),
    ).toContain('Out of service')
    expect(render([])).toContain('No assigned PPE needs inspection.')
  })
})
