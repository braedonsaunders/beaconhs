// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StationScanResult } from '@/lib/equipment-station'

vi.mock('next/navigation', () => ({
  usePathname: () => '/equipment/station',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/search-input', () => ({ SearchInput: () => null }))
vi.mock('@/components/filter-bar', () => ({ FilterChips: () => null }))
vi.mock('@/components/pagination', () => ({ Pagination: () => null }))
vi.mock('@beaconhs/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => children,
  Button: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) =>
    createElement('button', props),
  Select: (props: Record<string, unknown>) => createElement('select', props),
  Drawer: ({
    open,
    children,
    footer,
  }: {
    open: boolean
    children: React.ReactNode
    footer: React.ReactNode
  }) => (open ? createElement('div', { role: 'dialog' }, children, footer) : null),
}))
vi.mock('@/components/remote-search-select', () => ({
  RemoteSearchSelect: ({
    ariaLabel,
    onOptionChange,
  }: {
    ariaLabel: string
    onOptionChange: (value: unknown) => void
  }) =>
    createElement(
      'button',
      {
        onClick: () =>
          onOptionChange(
            ariaLabel === 'Destination'
              ? { value: 'site', label: 'North site' }
              : { value: 'person', label: 'Alex' },
          ),
      },
      `Pick ${ariaLabel}`,
    ),
}))
vi.mock('@/i18n/generated', () => {
  const identity = (value: unknown) => value
  return {
    GeneratedValue: ({ value }: { value: unknown }) => value,
    GeneratedText: ({ id }: { id: string }) => id,
    useGeneratedTranslations: () => identity,
    useGeneratedValueTranslations: () => identity,
  }
})
import { StationClient } from './_station-client'

const equipment = [
  {
    id: 'unit-1',
    assetTag: 'EQ-1',
    name: 'Drill',
    typeName: 'Tool',
    isOut: false,
    holderName: null,
  },
  {
    id: 'unit-2',
    assetTag: 'EQ-2',
    name: 'Saw',
    typeName: 'Tool',
    isOut: true,
    holderName: 'Taylor',
  },
]
let container: HTMLDivElement
let root: Root
type StationProps = React.ComponentProps<typeof StationClient>
let onScan: Mock<StationProps['onScan']>
let onSearch: Mock<StationProps['onSearch']>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onSearch = vi.fn<StationProps['onSearch']>(async (query, match) => ({
    equipment:
      match === 'code'
        ? equipment.filter(
            (item) => item.assetTag === query || (query === 'qr-token' && item.id === 'unit-1'),
          )
        : equipment,
    people: [],
  }))
  onScan = vi.fn<StationProps['onScan']>(async (input) => ({
    ok: true,
    action: input.direction === 'in' ? 'checked_in' : 'checked_out',
    itemId: equipment.find((item) => item.assetTag === input.code)!.id,
    assetTag: input.code,
    itemName: 'Tool',
    holderName: 'Alex',
    locationName: 'Yard',
    checkoutId: 'checkout',
  }))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function render(extra: Partial<React.ComponentProps<typeof StationClient>> = {}) {
  await act(async () =>
    root.render(
      <StationClient
        surface="app"
        tenantName="Test"
        scanMode="toggle"
        soundEnabled={false}
        requireConditionOnCheckin={false}
        homeLocationName="Yard"
        availableCount={5}
        initialActivePerson={{ id: 'person', name: 'Alex', employeeNo: null, jobTitle: null }}
        onSearch={onSearch}
        onScan={onScan}
        {...extra}
      />,
    ),
  )
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )!
}
async function click(text: string) {
  await act(async () => button(text).click())
}
async function type(query: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Scan or search equipment and people"]',
  )!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(200)
  })
}
async function pick(tag: string) {
  await type(tag)
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.includes(`${tag} ·`))!
      .click(),
  )
}
async function enter(code: string) {
  await type(code)
  await act(async () =>
    container
      .querySelector('input[aria-label="Scan or search equipment and people"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  )
}

describe('equipment station review and instant modes', () => {
  it('stages unique equipment without writing, then confirms explicit mixed directions and reviewed context', async () => {
    await render()
    await pick('EQ-1')
    await pick('EQ-1')
    await pick('EQ-2')
    expect(onScan).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Pending equipment (2)')
    await click('Pick Destination')
    await click('Review movements')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Holder: Alex')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Destination: North site',
    )
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Return location: Yard',
    )
    await click('Confirm movements')
    expect(onScan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: 'EQ-1',
        equipmentItemId: 'unit-1',
        direction: 'out',
        activePersonId: 'person',
        destinationOrgUnitId: 'site',
      }),
    )
    expect(onScan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ code: 'EQ-2', direction: 'in' }),
    )
    expect(container.textContent).not.toContain('Pending equipment (')
  })
  it('lets the operator back out or remove pending items without saving', async () => {
    await render()
    await pick('EQ-1')
    await click('Review movements')
    await click('Back')
    expect(container.textContent).toContain('Pending equipment (1)')
    await click('Remove')
    expect(container.textContent).not.toContain('Pending equipment (')
    expect(onScan).not.toHaveBeenCalled()
  })
  it('reviews an Undo before saving and never marks a failed reversal as undone', async () => {
    await render({ surface: 'kiosk' })
    await enter('EQ-1')
    onScan.mockClear()
    await click('m_164c39255db582')
    expect(onScan).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    onScan.mockResolvedValueOnce({ ok: false, error: 'Return rejected' })
    await click('Confirm movements')
    expect(container.textContent).not.toContain('m_0c753a26cf9595')
    expect(container.textContent).toContain('Pending equipment (1)')
  })
  it('requires a person or destination for checkout, allowing destination-only issuance', async () => {
    await render({ initialActivePerson: null })
    await pick('EQ-1')
    await click('Review movements')
    expect(button('Confirm movements').disabled).toBe(true)
    await click('Back')
    await click('Pick Destination')
    await click('Review movements')
    await click('Confirm movements')
    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ activePersonId: null, destinationOrgUnitId: 'site' }),
    )
  })
  it('retains rejected items and removes successes so retries do not repeat completed movements', async () => {
    await render()
    await pick('EQ-1')
    await pick('EQ-2')
    onScan.mockResolvedValueOnce({ ok: false, error: 'Already checked out' })
    await click('Review movements')
    await click('Confirm movements')
    expect(container.textContent).toContain('Pending equipment (1)')
    expect(container.textContent).toContain('Already checked out')
    onScan.mockClear()
    await click('Review movements')
    await click('Confirm movements')
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ code: 'EQ-1', direction: 'out' }))
  })
  it('stages a phone QR deep link without mutating custody on page load', async () => {
    await render({ initialScanCode: 'qr-token' })
    expect(onSearch).toHaveBeenCalledWith('qr-token', 'code')
    expect(onScan).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Pending equipment (1)')
  })
  it('keeps kiosk scans instant and honors the selected direction even when settings default to toggle', async () => {
    await render({ surface: 'kiosk' })
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((element) => element.textContent?.trim() === 'Out')!
        .click(),
    )
    await enter('EQ-1')
    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ code: 'EQ-1', direction: 'out' }))
    expect(container.textContent).not.toContain('Pending equipment (')
  })
  it('keeps the submit lock until a scan completes and does not double-submit', async () => {
    await render({ surface: 'kiosk' })
    let finish!: (value: StationScanResult) => void
    onScan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await type('EQ-1')
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Scan or search equipment and people"]',
    )!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onScan).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: false, error: 'Unavailable' }))
  })
  it('requires a return condition in instant mode and sends it with check-in', async () => {
    await render({ surface: 'kiosk', requireConditionOnCheckin: true })
    await enter('EQ-2')
    expect(onScan).not.toHaveBeenCalled()
    expect(button('Confirm movements').disabled).toBe(true)
    const select = container.querySelector<HTMLSelectElement>('[role="dialog"] select')!
    await act(async () => {
      select.value = 'damaged'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('Confirm movements')
    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EQ-2', direction: 'in', condition: 'damaged' }),
    )
  })
})
