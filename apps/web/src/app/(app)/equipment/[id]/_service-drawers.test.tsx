// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../_service-actions', () => ({
  recordServiceCompletion: vi.fn(),
  saveServicePlan: vi.fn(),
  saveEquipmentMeter: vi.fn(),
}))
vi.mock('@/lib/offline-drafts/use-online-action', () => ({
  useOnlineAction: () => async (_action: string, run: () => Promise<void>) => run(),
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('@beaconhs/ui', async (original) => ({
  ...(await original<typeof import('@beaconhs/ui')>()),
  UrlDrawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
}))
import { ServiceDrawers } from './_service-drawers'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
it('offers optional engine hours on a calendar-only completion', async () => {
  await act(async () =>
    root.render(
      <ServiceDrawers
        itemId="item"
        today="2026-10-22"
        closeHref="/equipment/item"
        drawer="service-complete"
        editing={{
          id: 'plan',
          cycleId: 'cycle',
          lastCompletedOn: null,
          name: 'Oil change',
          match: 'any',
          isActive: true,
          rules: [{ kind: 'calendar', every: 3, unit: 'month', dueOn: '2026-10-22' }],
        }}
        meters={[]}
        readings={{ engine_hours: null, odometer: null }}
      />,
    ),
  )
  const hours = container.querySelector<HTMLInputElement>('#completion-engine_hours')!
  expect(hours).not.toBeNull()
  expect(hours.required).toBe(false)
  expect(hours.value).toBe('')
  expect(hours.step).toBe('0.1')
})
