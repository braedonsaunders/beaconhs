// ETL command-line entry. Run via: pnpm --filter @beaconhs/etl etl <command> [...args]
import { SOURCE_DBS, TENANT_SLUG_BY_DB, type SourceDbName } from './config'
import * as src from './source/mssql'

const [cmd, ...args] = process.argv.slice(2)

function isSourceDb(s: string): s is SourceDbName {
  return SOURCE_DBS.includes(s)
}

async function counts() {
  if (SOURCE_DBS.length === 0) {
    console.log('No source DBs configured. Set ETL_SOURCE_DBS for private migration adapters.')
    return
  }
  for (const db of SOURCE_DBS) {
    const rows = await src.query<{ tbl: string; rows: number }>(
      db,
      `SELECT t.name AS tbl, SUM(CASE WHEN ps.index_id IN (0,1) THEN ps.row_count ELSE 0 END) AS rows
       FROM sys.tables t LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id=t.object_id
       GROUP BY t.name ORDER BY rows DESC`,
    )
    const total = rows.reduce((a, r) => a + Number(r.rows || 0), 0)
    const tenant = TENANT_SLUG_BY_DB[db] ?? '(unmapped)'
    console.log(`\n## ${db} -> ${tenant} (${rows.length} tables, ${total.toLocaleString()} rows)`)
    for (const r of rows) {
      console.log(
        `  ${r.tbl.padEnd(40)} ${Number(r.rows || 0)
          .toLocaleString()
          .padStart(12)}`,
      )
    }
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

async function clusterCheck() {
  const { connect } = await import('./crosswalk')
  const sql = connect()
  try {
    const r = await sql`select current_database() db, current_user usr, version() v`
    console.log(`OK connected: ${r[0]!.db}/${r[0]!.usr}`)
    console.log(r[0]!.v)
  } catch (e: any) {
    console.error(`FAILED to reach DATABASE_URL: ${e.message}`)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 3 })
  }
}

function help(usage?: string) {
  if (usage) {
    console.error(`usage: etl ${usage}`)
    return
  }
  console.log(
    `BeaconHS ETL

Read-only source inspection:
  counts                 row counts for configured source DBs
  sample <db> <table> [n] print sample rows
  cols <db> <table>       column list

Target Postgres:
  cluster-check           test DATABASE_URL
  bootstrap               create configured tenants + roles + templates
  import                  run configured loaders once
  sync                    run configured loaders in incremental mode

Configure private adapters with ETL_SOURCE_DBS, ETL_TENANT_SLUG_BY_DB, and ETL_SOURCE_URL.
Configured source DBs: ${SOURCE_DBS.length ? SOURCE_DBS.join(', ') : '(none)'}`,
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
    case 'cluster-check':
      await clusterCheck()
      break
    case 'bootstrap': {
      const { bootstrap } = await import('./bootstrap')
      await bootstrap()
      break
    }
    case 'import':
    case 'sync': {
      const { runImport } = await import('./orchestrator')
      const { ALL_LOADERS } = await import('./loaders')
      const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
      if (ALL_LOADERS.length === 0) {
        console.log('No public ETL loaders configured. Add private loaders before import/sync.')
      }
      await runImport(ALL_LOADERS, { only, mode: cmd === 'sync' ? 'sync' : 'import' })
      break
    }
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
