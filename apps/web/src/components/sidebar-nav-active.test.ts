import { describe, expect, it } from 'vitest'
import { findActiveNavHref } from './sidebar-nav-active'

describe('findActiveNavHref', () => {
  it('uses the deepest matching item for pinned builder app pages', () => {
    const groups = [
      {
        items: [
          { href: '/apps', label: 'Builder' },
          { href: '/apps/templates/lift-plan-template-id/records', label: 'Lift plans' },
        ],
      },
    ]

    expect(findActiveNavHref('/apps/templates/lift-plan-template-id/records', groups)).toBe(
      '/apps/templates/lift-plan-template-id/records',
    )
  })

  it('keeps parent modules active for ordinary nested pages', () => {
    const groups = [{ items: [{ href: '/equipment', label: 'Equipment' }] }]

    expect(findActiveNavHref('/equipment/inspection-types', groups)).toBe('/equipment')
  })

  it('honors exact hub items when a sibling has a longer prefix', () => {
    const groups = [
      {
        items: [
          { href: '/platform/tenants', label: 'Tenants', exact: true },
          { href: '/platform/tenants/new', label: 'Create tenant' },
        ],
      },
    ]

    expect(findActiveNavHref('/platform/tenants/new', groups)).toBe('/platform/tenants/new')
    expect(findActiveNavHref('/platform/tenants/acme', groups)).toBeNull()
  })
})
