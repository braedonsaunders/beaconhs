// ETL command-line entry. Run via: pnpm --filter @beaconhs/etl etl <command> [...args]
import { SOURCE_DBS, TENANT_SLUG_BY_DB, type SourceDbName } from './config'
import * as src from './source/mssql'

const [cmd, ...args] = process.argv.slice(2)

function isSourceDb(s: string): s is SourceDbName {
  return (SOURCE_DBS as string[]).includes(s)
}

async function counts() {
  for (const db of SOURCE_DBS) {
    const rows = await src.query<{ tbl: string; rows: number }>(
      db,
      `SELECT t.name AS tbl, SUM(CASE WHEN ps.index_id IN (0,1) THEN ps.row_count ELSE 0 END) AS rows
       FROM sys.tables t LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id=t.object_id
       GROUP BY t.name ORDER BY rows DESC`,
    )
    const total = rows.reduce((a, r) => a + Number(r.rows || 0), 0)
    console.log(`\n## ${db} → ${TENANT_SLUG_BY_DB[db]}  (${rows.length} tables, ${total.toLocaleString()} rows)`)
    for (const r of rows) console.log(`  ${r.tbl.padEnd(40)} ${Number(r.rows || 0).toLocaleString().padStart(12)}`)
  }
}

async function sampleCmd() {
  const [db, table, n] = args
  if (!db || !isSourceDb(db) || !table) return help('sample <db> <table> [n]')
  console.dir(await src.sample(db, table, Number(n ?? 3)), { depth: null })
}

async function cols() {
  const [db, table] = args
  if (!db || !isSourceDb(db) || !table) return help('cols <db> <table>')
  const rows = await src.query(
    db,
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table.replace(/'/g, "''")}' ORDER BY ORDINAL_POSITION`,
  )
  console.dir(rows, { depth: null })
}

// Spot-check: print count + 1 sample row for a handful of core mapped tables, to eyeball the mapping.
async function verify() {
  const spot: Array<[SourceDbName, string]> = [
    ['beaconHS', 'INCIDENTLOG'],
    ['beaconHS', 'HAZIDJSA'],
    ['beaconHS', 'DAILYJOURNALS'],
    ['beaconHS', 'CORRECTIVEACTIONS'],
    ['toolCRIB', 'EQUIPMENT'],
    ['peopleApp', 'EMPLOYEESHR'],
  ]
  for (const [db, table] of spot) {
    const n = await src.rowCount(db, table)
    const [row] = await src.sample(db, table, 1)
    console.log(`\n### ${db}.${table}  (${n.toLocaleString()} rows)`)
    console.dir(row, { depth: null })
  }
}

async function clusterCheck() {
  const { connect } = await import('./crosswalk')
  const sql = connect()
  try {
    const r = await sql`select current_database() db, current_user usr, version() v`
    console.log(`OK connected: ${r[0]!.db}/${r[0]!.usr}`)
    console.log(r[0]!.v)
  } catch (e: any) {
    console.error(`FAILED to reach DATABASE_URL: ${e.message}`)
    if (/pg_hba|no encryption|SSL/.test(e.message)) {
      console.error('\nHint: the cluster has no pg_hba.conf rule for this host, or requires/forbids SSL.')
    }
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 3 })
  }
}

function help(usage?: string) {
  if (usage) console.error(`usage: etl ${usage}`)
  else
    console.log(
      `BeaconHS ETL\n\nRead-only (legacy MSSQL):\n  counts                 row counts for all in-scope source tables\n  sample <db> <table> [n] print sample rows\n  cols <db> <table>       column list\n  verify                  spot-check core mapped tables\n\nCluster (needs DATABASE_URL access):\n  cluster-check           test the target Postgres connection\n  bootstrap               create tenants + admin users + roles + templates   [Phase 1]\n  import [--dry-run]      one-time bulk import                               [Phase 2]\n  sync                    incremental upsert                                 [Phase 3]\n  reconcile               source vs target row-count report\n\ndbs: ${SOURCE_DBS.join(', ')}`,
    )
}

async function main() {
  switch (cmd) {
    case 'counts':
      await counts()
      break
    case 'sample':
      await sampleCmd()
      break
    case 'cols':
      await cols()
      break
    case 'verify':
      await verify()
      break
    case 'cluster-check':
      await clusterCheck()
      break
    case 'bootstrap': {
      const { bootstrap } = await import('./bootstrap')
      await bootstrap()
      break
    }
    case 'import': {
      const { runImport } = await import('./orchestrator')
      const { RASSAUN_LOADERS } = await import('./loaders')
      const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
      await runImport(RASSAUN_LOADERS, { only })
      break
    }
    case 'sync': {
      const { runImport } = await import('./orchestrator')
      const { RASSAUN_LOADERS } = await import('./loaders')
      const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
      await runImport(RASSAUN_LOADERS, { only, mode: 'sync' })
      break
    }
    case 'reconcile':
      console.error(`"${cmd}" is not implemented yet — depends on cluster access (see plan Phase 1+).`)
      process.exitCode = 1
      break
    default:
      help()
  }
  await src.closeAll()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
  src.closeAll().finally(() => process.exit(process.exitCode ?? 1))
})
