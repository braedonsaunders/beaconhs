import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type JournalFile = {
  entries?: Array<{ tag: string; when: number }>
}

export type MigrationFile = {
  tag: string
  createdAt: number
  hash: string
}

export type MigrationTrackerRow = {
  hash: string
  createdAt: string | number | bigint | null
}

type MigrationState = {
  applied: MigrationFile[]
  pending: MigrationFile[]
  unknownTrackerRows: number
}

export function readMigrationFiles(folder: string): MigrationFile[] {
  const journalPath = resolve(folder, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as JournalFile
  const entries = journal.entries ?? []
  if (entries.length === 0) throw new Error(`Migration journal is empty: ${journalPath}`)

  const seenTags = new Set<string>()
  let previousCreatedAt = -1
  return entries.map((entry) => {
    if (!entry.tag || !Number.isSafeInteger(entry.when) || entry.when <= previousCreatedAt) {
      throw new Error(`Migration journal entries must have unique tags and increasing timestamps`)
    }
    if (seenTags.has(entry.tag)) throw new Error(`Duplicate migration tag: ${entry.tag}`)
    seenTags.add(entry.tag)
    previousCreatedAt = entry.when

    const sqlText = readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8')
    return {
      tag: entry.tag,
      createdAt: entry.when,
      hash: createHash('sha256').update(sqlText).digest('hex'),
    }
  })
}

function normalizeTrackerRows(rows: MigrationTrackerRow[]) {
  return rows.map((row) => {
    const createdAt = Number(row.createdAt)
    if (!row.hash || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
      throw new Error('Migration tracker contains an invalid hash or timestamp')
    }
    return { hash: row.hash, createdAt }
  })
}

export function validateMigrationState(
  migrations: MigrationFile[],
  trackerRows: MigrationTrackerRow[],
  options: { allowLegacyBefore?: number; requireComplete?: boolean } = {},
): MigrationState {
  if (migrations.length === 0) throw new Error('No migration files were provided')
  if (trackerRows.length === 0) {
    throw new Error(
      'Existing BeaconHS schema has no migration history. Refusing to guess which DDL is applied.',
    )
  }

  const normalizedRows = normalizeTrackerRows(trackerRows)
  const latestTrackedAt = Math.max(...normalizedRows.map((row) => row.createdAt))
  const latestMigrationAt = migrations.at(-1)!.createdAt
  if (latestTrackedAt > latestMigrationAt) {
    throw new Error(
      `Migration tracker is ahead of this checkout (${latestTrackedAt} > ${latestMigrationAt})`,
    )
  }

  const trackerKeys = new Set(normalizedRows.map((row) => `${row.createdAt}:${row.hash}`))
  const trackerTimestamps = new Set(normalizedRows.map((row) => row.createdAt))
  const applied = migrations.filter((migration) => migration.createdAt <= latestTrackedAt)
  const missingApplied = applied.filter(
    (migration) =>
      !trackerKeys.has(`${migration.createdAt}:${migration.hash}`) &&
      !(
        options.allowLegacyBefore &&
        migration.createdAt < options.allowLegacyBefore &&
        trackerTimestamps.has(migration.createdAt)
      ),
  )
  if (missingApplied.length > 0) {
    throw new Error(
      `Migration history is inconsistent before ${latestTrackedAt}; missing or modified: ${missingApplied
        .map((migration) => migration.tag)
        .join(', ')}`,
    )
  }

  const pending = migrations.filter((migration) => migration.createdAt > latestTrackedAt)
  if (options.requireComplete && pending.length > 0) {
    throw new Error(
      `Migrations were not applied: ${pending.map((migration) => migration.tag).join(', ')}`,
    )
  }

  const expectedKeys = new Set(
    migrations.map((migration) => `${migration.createdAt}:${migration.hash}`),
  )
  return {
    applied,
    pending,
    unknownTrackerRows: normalizedRows.filter(
      (row) => !expectedKeys.has(`${row.createdAt}:${row.hash}`),
    ).length,
  }
}
