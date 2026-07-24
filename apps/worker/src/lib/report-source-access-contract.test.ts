import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workerSource = readFileSync(new URL('../workers/reports.ts', import.meta.url), 'utf8')

describe('scheduled report source authorization contract', () => {
  it('rebuilds the Insights source inventory for the run-as member', () => {
    expect(workerSource).toContain('resolveMembershipAccess')
    expect(workerSource).toContain(
      "canAccessTemplate(requestCtx, template, resolved.roleKeys, 'operate')",
    )
    expect(workerSource).toContain('discoverEntitiesWithScopedApps')
    expect(workerSource).toContain('loadBeaconReportCatalog(tx, sources)')
  })

  it('does not fall back to the static report-only source inventory', () => {
    expect(workerSource).not.toMatch(/loadBeaconReportCatalog\(tx\)(?!,)/)
  })
})
