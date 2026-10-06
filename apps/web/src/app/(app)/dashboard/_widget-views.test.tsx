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
  it('shows current gear and non-inspectable clothing with accurate actions', () => {
    const html = render([
      {
        id: 'harness',
        typeName: 'Harness',
        serialNumber: '106164646-104',
        size: null,
        status: 'issued',
        inspectionKind: 'annual',
        canRecordPreUse: true,
        inspectionState: 'current',
        inspectionDueOn: '2027-01-21',
      },
      {
        id: 'shirt',
        typeName: 'Hi Viz Shirts',
        serialNumber: null,
        size: null,
        status: 'issued',
        inspectionKind: null,
        canRecordPreUse: false,
        inspectionState: 'not_required',
        inspectionDueOn: null,
      },
    ])
    expect(html).toContain('Harness')
    expect(html).toContain('Current')
    expect(html).toContain('Hi Viz Shirts')
    expect(html).toContain('Not required')
    expect(html).toContain('Assigned PPE: 2')
    expect(html).toContain('kind=pre_use')
    expect(html).not.toContain('kind=annual')
    expect(html).not.toContain('kind=null')
    expect(html).not.toContain('/ppe/shirt?')
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
          inspectionKind: 'annual',
          canRecordPreUse: false,
          inspectionState: 'current',
          inspectionDueOn: '2027-01-21',
        },
      ]),
    ).toContain('Out of service')
    expect(render([])).toContain('No PPE assigned to you.')
  })
})
