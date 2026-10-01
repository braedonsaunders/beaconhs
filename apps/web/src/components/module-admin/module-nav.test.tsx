import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { BUILTIN_ROLES } from '@beaconhs/db/schema'

const state = vi.hoisted(() => ({ permissions: new Set<string>() }))
vi.mock('@/lib/auth', () => ({
  getRequestContext: async () => ({ isSuperAdmin: false, permissions: state.permissions }),
  requireRequestContext: async () => ({ isSuperAdmin: false, permissions: state.permissions }),
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
}))
import { ModuleNav } from './module-nav'

async function nav(permissions: string[], active: string) {
  state.permissions = new Set(permissions)
  return renderToStaticMarkup(await ModuleNav({ moduleKey: 'journals', active }))
}

describe('journal reading and administration navigation', () => {
  it.each(['workspace', 'records'])(
    'lets supervisors browse Records without administration from %s',
    async (active) => {
      const permissions = BUILTIN_ROLES.foreman!.permissions
      expect(permissions).toContain('journals.update.own')
      expect(permissions).not.toContain('journals.assign')
      const html = await nav(permissions, active)
      expect(html).toContain('href="/journals/records"')
      expect(html).not.toContain('href="/journals/manage"')
      expect(html).not.toContain('href="/journals/tags"')
      expect(html).not.toContain('href="/journals/flows"')
    },
  )
  it('keeps self-only workers out of Records and Manage, and administrators able to manage', async () => {
    const own = await nav(BUILTIN_ROLES.worker!.permissions, 'workspace')
    expect(own).not.toContain('/journals/records')
    expect(own).not.toContain('/journals/manage')
    const manager = await nav(['journals.read.all', 'journals.assign'], 'workspace')
    expect(manager).toContain('/journals/records')
    expect(manager).toContain('/journals/manage')
  })
})
