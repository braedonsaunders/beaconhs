// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppMessages } from '@beaconhs/i18n/messages'
import { MODULE_ADMIN, moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManagementWorkspace } from './module-management-workspace'

const navigation = vi.hoisted(() => ({ pathname: '/equipment/categories', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}))
vi.mock('@/components/sidebar-nav', () => ({ NavIcon: () => null }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  navigation.pathname = '/equipment/categories'
  navigation.push.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(locale: 'en' | 'fr' | 'es' = 'en') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={getAppMessages(locale)}>
        <ModuleManagementWorkspace modules={MODULE_ADMIN}>
          <div data-management-content>Actual management page</div>
        </ModuleManagementWorkspace>
      </NextIntlClientProvider>,
    )
  })
}

describe('management workspace', () => {
  it('renders real content beside AppKit navigation and routes desktop/mobile choices', async () => {
    await render()
    expect(container.querySelector('[data-management-content]')?.textContent).toBe(
      'Actual management page',
    )
    expect(container.querySelector('button[aria-current="page"]')?.textContent).toBe('Categories')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/equipment')
    const buttons = [...container.querySelectorAll('button')]
    await act(async () => buttons.find((button) => button.textContent === 'Work orders')!.click())
    expect(navigation.push).toHaveBeenLastCalledWith('/equipment/flows')
    const select = container.querySelector('select')!
    await act(async () => {
      select.value = 'vehicle-log-settings'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(navigation.push).toHaveBeenLastCalledWith('/equipment/vehicle-log/settings')
  })

  it('tracks a nested editor and leaves operational pages with their full canvas', async () => {
    navigation.pathname = '/hazard-assessments/hazards/types/type-123'
    await render()
    expect(container.querySelector('button[aria-current="page"]')?.textContent).toBe('Hazard types')
    navigation.pathname = '/equipment/maintenance'
    await render()
    expect(container.querySelector('aside')).toBeNull()
    expect(container.textContent).toBe('Actual management page')
  })

  it.each(['en', 'fr', 'es'] as const)(
    'has translated navigation for every section in %s',
    async (locale) => {
      const messages = getAppMessages(locale).ManageWorkspace
      for (const config of MODULE_ADMIN) {
        for (const section of config.sections) {
          expect(messages.groups).toHaveProperty(section.group)
          expect(messages.pages).toHaveProperty(section.label)
        }
      }
      navigation.pathname = moduleAdminByKey('equipment')!.sections[0]!.href
      await render(locale)
      expect(container.querySelector('button[aria-label]')?.getAttribute('aria-label')).toBe(
        messages.page,
      )
    },
  )
})
