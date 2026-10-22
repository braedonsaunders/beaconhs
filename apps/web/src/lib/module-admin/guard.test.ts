import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleManagementNavigation, redirectToModuleManagement } from './guard'

vi.mock('@/lib/auth', () => ({ requireRequestContext: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (href: string): never => {
    throw new Error(href)
  },
}))

function context(permissions: string[], isSuperAdmin = false) {
  return { permissions: new Set(permissions), isSuperAdmin } as RequestContext
}

describe('management navigation permission boundaries', () => {
  it('does not expose management to operational viewers', () => {
    expect(
      moduleManagementNavigation(context(['equipment.read.all', 'training.read.self'])),
    ).toEqual([])
  })

  it('does not expose class automations to a course-only manager', () => {
    const navigation = moduleManagementNavigation(context(['training.course.manage']))
    expect(navigation.map((module) => module.moduleKey)).toEqual(['training'])
    expect(navigation[0]!.sections.some((section) => section.key === 'class-flows')).toBe(false)
    expect(navigation[0]!.sections.some((section) => section.key === 'flows')).toBe(true)
  })

  it('lets a class manager use the shared workspace without gaining other training settings', () => {
    const navigation = moduleManagementNavigation(context(['training.class.manage']))
    expect(navigation.map((module) => module.moduleKey)).toEqual(['training'])
    expect(navigation[0]!.sections.map((section) => section.key)).toEqual(['class-flows'])
  })

  it('honours wildcard and super-admin permissions and excludes guard-only duplicates', () => {
    const navigation = moduleManagementNavigation(context(['equipment.*']))
    expect(navigation.map((module) => module.moduleKey)).toEqual(['equipment'])
    expect(moduleManagementNavigation(context([], true))).toHaveLength(11)
  })

  it('opens the permitted class page directly from Training manage', async () => {
    vi.mocked(requireRequestContext).mockResolvedValue(context(['training.class.manage']))
    await expect(redirectToModuleManagement('training')).rejects.toThrow('/training/classes/flows')
  })

  it('returns operational viewers to the module instead of exposing configuration', async () => {
    vi.mocked(requireRequestContext).mockResolvedValue(context(['equipment.read.all']))
    await expect(redirectToModuleManagement('equipment')).rejects.toThrow('/equipment')
  })
})
