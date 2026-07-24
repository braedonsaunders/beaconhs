import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('seeded report portrait cutover', () => {
  it('updates every Beacon-owned seed without touching tenant-created reports', () => {
    const migration = readFileSync(
      new URL('../drizzle/0027_report_portrait_cutover.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain(`'{orientation}'`)
    expect(migration).toContain(`'"portrait"'::jsonb`)
    expect(migration).toContain(`"seed_key" IS NOT NULL`)
    expect(migration).toContain(`'["beacon-default"]'::jsonb`)
  })
})
