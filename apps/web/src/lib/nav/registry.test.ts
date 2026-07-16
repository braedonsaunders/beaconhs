import { describe, expect, it } from 'vitest'
import type { TenantNavConfig } from '@beaconhs/db/schema'
import {
  buildDefaultNavConfig,
  NAV_MODULES,
  stampKnownModules,
  withMissingModules,
} from './registry'

function moduleKeysOf(config: TenantNavConfig): string[] {
  return config.groups
    .flatMap((g) => g.items)
    .flatMap((i) => (i.kind === 'module' ? [i.moduleKey] : []))
}

describe('withMissingModules', () => {
  it('keeps a deliberately deleted module deleted when the config is stamped', () => {
    const config = stampKnownModules(buildDefaultNavConfig())
    config.groups = config.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => !(i.kind === 'module' && i.moduleKey === 'equipment')),
    }))

    const resolved = withMissingModules(config)
    expect(moduleKeysOf(resolved)).not.toContain('equipment')
  })

  it('keeps a deliberately deleted group (and all its modules) deleted when stamped', () => {
    const config = stampKnownModules(buildDefaultNavConfig())
    const frontlineKeys = NAV_MODULES.filter((m) => m.group === 'Frontline').map((m) => m.key)
    config.groups = config.groups.filter((g) => g.id !== 'frontline')

    const resolved = withMissingModules(config)
    expect(resolved.groups.some((g) => g.id === 'frontline')).toBe(false)
    for (const key of frontlineKeys) expect(moduleKeysOf(resolved)).not.toContain(key)
  })

  it('appends a module shipped after the save (absent from the stamp)', () => {
    const config = stampKnownModules(buildDefaultNavConfig())
    // Simulate "equipment shipped after this config was saved": drop it from
    // both the layout and the known stamp.
    config.groups = config.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => !(i.kind === 'module' && i.moduleKey === 'equipment')),
    }))
    config.knownModuleKeys = config.knownModuleKeys?.filter((k) => k !== 'equipment')

    const resolved = withMissingModules(config)
    expect(moduleKeysOf(resolved)).toContain('equipment')
  })

  it('appends every missing module for legacy rows without a stamp', () => {
    const config = buildDefaultNavConfig()
    config.groups = config.groups.filter((g) => g.id !== 'frontline')

    const resolved = withMissingModules(config)
    const keys = moduleKeysOf(resolved)
    for (const m of NAV_MODULES) expect(keys).toContain(m.key)
  })

  it('returns the input untouched when nothing is missing', () => {
    const config = stampKnownModules(buildDefaultNavConfig())
    expect(withMissingModules(config)).toBe(config)
  })
})

describe('stampKnownModules', () => {
  it('stamps the full current registry regardless of what the layout contains', () => {
    const stamped = stampKnownModules({ version: 1, groups: [] })
    expect(stamped.knownModuleKeys?.sort()).toEqual(NAV_MODULES.map((m) => m.key).sort())
  })
})
