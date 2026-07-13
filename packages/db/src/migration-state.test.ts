import { describe, expect, it } from 'vitest'
import { validateMigrationState, type MigrationFile } from './migration-state'

const migrations: MigrationFile[] = [
  { tag: '0000_init', createdAt: 100, hash: 'hash-0' },
  { tag: '0001_feature', createdAt: 200, hash: 'hash-1' },
  { tag: '0002_future', createdAt: 300, hash: 'hash-2' },
]

describe('validateMigrationState', () => {
  it('keeps a genuinely new migration pending instead of pre-registering it', () => {
    const state = validateMigrationState(migrations, [
      { createdAt: 100, hash: 'hash-0' },
      { createdAt: 200, hash: 'hash-1' },
    ])

    expect(state.applied.map((migration) => migration.tag)).toEqual(['0000_init', '0001_feature'])
    expect(state.pending.map((migration) => migration.tag)).toEqual(['0002_future'])
  })

  it('fails closed when an existing schema has no migration ledger', () => {
    expect(() => validateMigrationState(migrations, [])).toThrow(/no migration history/i)
  })

  it('detects an edited or missing historical migration', () => {
    expect(() =>
      validateMigrationState(migrations, [
        { createdAt: 100, hash: 'modified-hash' },
        { createdAt: 200, hash: 'hash-1' },
      ]),
    ).toThrow(/missing or modified: 0000_init/)
  })

  it('accepts only timestamp-matched baseline history before an explicit cutover', () => {
    const state = validateMigrationState(
      migrations,
      [
        { createdAt: 100, hash: 'pre-squash-baseline-hash' },
        { createdAt: 200, hash: 'hash-1' },
      ],
      { allowLegacyBefore: 150 },
    )

    expect(state.applied.map((migration) => migration.tag)).toEqual(['0000_init', '0001_feature'])
    expect(state.pending.map((migration) => migration.tag)).toEqual(['0002_future'])
  })

  it('does not excuse a missing baseline row during cutover', () => {
    expect(() =>
      validateMigrationState(migrations, [{ createdAt: 200, hash: 'hash-1' }], {
        allowLegacyBefore: 150,
      }),
    ).toThrow(/missing or modified: 0000_init/)
  })

  it('rejects a tracker created by a newer checkout', () => {
    expect(() =>
      validateMigrationState(migrations, [{ createdAt: 400, hash: 'unknown-future' }]),
    ).toThrow(/ahead of this checkout/)
  })

  it('requires every migration after the migrator returns', () => {
    expect(() =>
      validateMigrationState(
        migrations,
        [
          { createdAt: 100, hash: 'hash-0' },
          { createdAt: 200, hash: 'hash-1' },
        ],
        { requireComplete: true },
      ),
    ).toThrow(/0002_future/)
  })

  it('allows older tracker rows from the pre-squash migration history', () => {
    const state = validateMigrationState(migrations, [
      { createdAt: 50, hash: 'legacy-hash' },
      { createdAt: 100, hash: 'hash-0' },
      { createdAt: 200, hash: 'hash-1' },
      { createdAt: 300, hash: 'hash-2' },
    ])

    expect(state.pending).toEqual([])
    expect(state.unknownTrackerRows).toBe(1)
  })
})
