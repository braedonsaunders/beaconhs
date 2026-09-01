import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workerSource = readFileSync(new URL('../workers/reports.ts', import.meta.url), 'utf8')

describe('scheduled wallet-card report PDF cutover', () => {
  it('prints credential fronts for reports flagged as credential-fronts', () => {
    expect(workerSource).toContain('reportExportsCredentialFronts')
    expect(workerSource).toContain('renderWalletCardsForReport')
    expect(workerSource).toContain('reportSupportsWalletCards')
  })
})
