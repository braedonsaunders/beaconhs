// adminapp2 timesheet export.
//
// Re-implements the legacy beaconhs "dump time on class close" behaviour as an
// opt-in, tenant-scoped integration. On `training.class.completed` it writes one
// weekly `timesheet` container row per attended person per ISO week into an
// external SQL Server (adminapp2), exactly as the legacy app did — preserving
// adminapp2's downstream human approval step (rows land isSubmitted=false).
//
// Two deliberate improvements over the legacy code:
//   * Credentials are sealed per-tenant (no hardcoded connection string).
//   * Idempotent + reversible: every external row id is recorded in the export
//     ledger, so re-completing a class deletes the prior rows before re-posting
//     (the legacy code blindly re-inserted and double-posted).
//
// Everything vendor-specific lives in this folder. Core only emits the event.

import { and, eq } from 'drizzle-orm'
import { integrationExportLog } from '@beaconhs/db/schema'
import { connectDb } from '@beaconhs/sync'
import type {
  IntegrationEvent,
  IntegrationResult,
  OutboundIntegration,
  OutboundIntegrationContext,
} from '../types'

const KEY = 'adminapp2-timesheet'
const EXTERNAL_SYSTEM = 'adminapp2'
const SUBJECT_TYPE = 'training_class'

// Legacy constants (overridable via config). payrollItem=1, item=2551 were
// hardcoded in TrainingClassApiController::completeClass.
const DEFAULT_PAYROLL_ITEM = 1
const DEFAULT_SERVICE_ITEM = 2551
const DEFAULT_TABLE = 'timesheet'
// The legacy hardcoded division→department map.
const DEFAULT_DEPARTMENT_MAP = 'Mechanical=1\nElectrical=2\nShop=3\nOverhead=4\nTraining=5'
// Multi-day classes with no explicit hours_per_day fall back to a workday.
const FALLBACK_HOURS_PER_DAY = 8

interface ParsedConfig {
  host: string
  port?: number
  database: string
  username: string
  table: string
  payrollItem: number
  serviceItem: number
  departmentMap: Map<string, number>
}

function parseDepartmentMap(raw: unknown): Map<string, number> {
  const map = new Map<string, number>()
  const text = typeof raw === 'string' && raw.trim() ? raw : DEFAULT_DEPARTMENT_MAP
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const name = line.slice(0, eq).trim().toLowerCase()
    const id = Number(line.slice(eq + 1).trim())
    if (name && Number.isFinite(id)) map.set(name, id)
  }
  return map
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseConfig(config: Record<string, unknown>): ParsedConfig {
  return {
    host: String(config.host ?? '').trim(),
    port: config.port != null && config.port !== '' ? num(config.port, 1433) : undefined,
    database: String(config.database ?? '').trim(),
    username: String(config.username ?? '').trim(),
    table: String(config.table ?? '').trim() || DEFAULT_TABLE,
    payrollItem: num(config.payrollItem, DEFAULT_PAYROLL_ITEM),
    serviceItem: num(config.item, DEFAULT_SERVICE_ITEM),
    departmentMap: parseDepartmentMap(config.departmentMap),
  }
}

// --- date helpers (UTC, date-granular like a timesheet) -------------------

function atUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}
function sundayOnOrBefore(d: Date): Date {
  return addDays(d, -d.getUTCDay()) // getUTCDay: 0=Sun..6=Sat
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface WeekRow {
  dateStart: string
  dateEnd: string
  dayHours: number[] // [Sun..Sat]
}

// Fan `hoursPerDay` across the `lengthDays`-day class span into one row per ISO
// week (Sun→Sat), zero-filling days outside the span. Mirrors the legacy spread.
function buildWeekRows(startsAtIso: string, hoursPerDay: number, lengthDays: number): WeekRow[] {
  const startDate = atUtcMidnight(new Date(startsAtIso))
  const span = Math.max(1, Math.floor(lengthDays))
  const lastDate = addDays(startDate, span - 1)
  const rows: WeekRow[] = []
  let weekStart = sundayOnOrBefore(startDate)
  for (let guard = 0; guard < 60 && weekStart <= lastDate; guard++) {
    const dayHours = [0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i)
      if (day >= startDate && day <= lastDate) dayHours[i] = hoursPerDay
    }
    if (dayHours.some((h) => h > 0)) {
      rows.push({ dateStart: ymd(weekStart), dateEnd: ymd(addDays(weekStart, 6)), dayHours })
    }
    weekStart = addDays(weekStart, 7)
  }
  return rows
}

// --- SQL helpers (raw, identifiers bracket-quoted, values literal-escaped) --

function qid(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}
function lit(v: string | number | null): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return `N'${v.replace(/'/g, "''")}'`
}

// Exact column names as adminapp2's Timesheet model expects them.
const INSERT_COLS = [
  'customer',
  'department',
  'employee',
  'item',
  'memo',
  'payrollItem',
  'day1Hours',
  'day2Hours',
  'day3Hours',
  'day4Hours',
  'day5Hours',
  'day6Hours',
  'day7Hours',
  'dateStart',
  'dateEnd',
  'isSubmitted',
] as const

// --- the integration -------------------------------------------------------

async function loadPriorRefs(ctx: OutboundIntegrationContext, classId: string): Promise<string[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({ externalRef: integrationExportLog.externalRef })
      .from(integrationExportLog)
      .where(
        and(
          eq(integrationExportLog.tenantId, ctx.tenantId),
          eq(integrationExportLog.integrationKey, KEY),
          eq(integrationExportLog.subjectType, SUBJECT_TYPE),
          eq(integrationExportLog.subjectId, classId),
        ),
      ),
  )
  return rows.map((r) => r.externalRef).filter((r): r is string => !!r)
}

async function connect(cfg: ParsedConfig, password: string) {
  return connectDb({
    dbKind: 'mssql',
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    username: cfg.username,
    password,
  })
}

async function test(ctx: OutboundIntegrationContext): Promise<IntegrationResult> {
  const cfg = parseConfig(ctx.config)
  const password = ctx.secrets.password ?? ''
  if (!cfg.host || !cfg.database || !cfg.username || !password) {
    return { ok: false, error: 'Host, database, username and password are required.' }
  }
  let conn: Awaited<ReturnType<typeof connectDb>> | null = null
  try {
    conn = await connect(cfg, password)
    await conn.query('SELECT 1 AS ok')
    return { ok: true, summary: `Connected to ${cfg.database} on ${cfg.host}.` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (conn) await conn.close().catch(() => {})
  }
}

async function handle(
  ctx: OutboundIntegrationContext,
  event: IntegrationEvent,
): Promise<IntegrationResult> {
  if (event.type !== 'training.class.completed') return { ok: true }

  const cfg = parseConfig(ctx.config)
  const password = ctx.secrets.password ?? ''
  if (!cfg.host || !cfg.database || !cfg.username || !password) {
    return {
      ok: false,
      error: 'Connection is not configured (host, database, username, password).',
    }
  }

  // Resolve who to post: attended people with an external employee id.
  const skipped: string[] = []
  const toPost = event.attendees.filter((a) => {
    if (!a.attended) return false
    if (!a.externalEmployeeId) {
      skipped.push(`${a.lastName}, ${a.firstName}`)
      return false
    }
    return true
  })
  for (const name of skipped) ctx.log('warn', `No external employee id for ${name} — skipped.`)

  const weekRows = buildWeekRows(event.startsAt, event.hoursPerDay, event.lengthDays)

  // Prior posts for this class (for idempotent re-completion).
  const priorRefs = await loadPriorRefs(ctx, event.classId)

  const tableQ = qid(cfg.table)
  const colList = INSERT_COLS.map(qid).join(',')
  const inserted: {
    externalRef: string
    personId: string
    dateStart: string
    dayHours: number[]
  }[] = []
  let externalReconciled = false
  let pushError: string | null = null
  let conn: Awaited<ReturnType<typeof connectDb>> | null = null

  try {
    conn = await connect(cfg, password)

    // Reverse the prior push first so re-completion never double-posts.
    if (priorRefs.length > 0) {
      const inList = priorRefs.map((r) => (/^\d+$/.test(r) ? r : lit(r))).join(',')
      await conn.query(`DELETE FROM ${tableQ} WHERE ${qid('id')} IN (${inList})`)
    }
    externalReconciled = true

    for (const a of toPost) {
      const department = a.departmentName
        ? (cfg.departmentMap.get(a.departmentName.trim().toLowerCase()) ?? null)
        : null
      for (const wk of weekRows) {
        const values = [
          lit(null), // customer — non-billable internal training
          lit(department),
          lit(a.externalEmployeeId), // employee = external (NetSuite) id
          lit(cfg.serviceItem),
          lit(event.course.name), // memo
          lit(cfg.payrollItem),
          ...wk.dayHours.map((h) => lit(h)),
          lit(wk.dateStart),
          lit(wk.dateEnd),
          lit(0), // isSubmitted = false (human approves in adminapp2)
        ].join(',')
        const res = await conn.query(
          `INSERT INTO ${tableQ} (${colList}) OUTPUT INSERTED.${qid('id')} VALUES (${values})`,
        )
        const row0 = res[0]
        const ref = row0 && row0.id != null ? String(row0.id) : ''
        if (ref) {
          inserted.push({
            externalRef: ref,
            personId: a.personId,
            dateStart: wk.dateStart,
            dayHours: wk.dayHours,
          })
        }
      }
    }
  } catch (e) {
    pushError = e instanceof Error ? e.message : String(e)
  } finally {
    if (conn) await conn.close().catch(() => {})
  }

  // Reconcile the ledger only if we actually touched the external system — if
  // the connection failed we leave the prior ledger intact so a later run can
  // still reverse those rows.
  if (externalReconciled) {
    await ctx.db(async (tx) => {
      await tx
        .delete(integrationExportLog)
        .where(
          and(
            eq(integrationExportLog.tenantId, ctx.tenantId),
            eq(integrationExportLog.integrationKey, KEY),
            eq(integrationExportLog.subjectType, SUBJECT_TYPE),
            eq(integrationExportLog.subjectId, event.classId),
          ),
        )
      if (inserted.length > 0) {
        await tx.insert(integrationExportLog).values(
          inserted.map((r) => ({
            tenantId: ctx.tenantId,
            integrationKey: KEY,
            subjectType: SUBJECT_TYPE,
            subjectId: event.classId,
            externalSystem: EXTERNAL_SYSTEM,
            externalRef: r.externalRef,
            status: 'pushed' as const,
            detail: { personId: r.personId, dateStart: r.dateStart, dayHours: r.dayHours },
          })),
        )
      }
    })
  }

  if (pushError) return { ok: false, error: pushError }

  const skipNote = skipped.length ? ` (${skipped.length} skipped: no external id)` : ''
  return {
    ok: true,
    summary: `Posted ${inserted.length} timesheet row(s) for ${toPost.length} attendee(s)${skipNote}.`,
  }
}

export const adminapp2Timesheet: OutboundIntegration = {
  key: KEY,
  name: 'adminapp2 — training time export',
  description:
    'On training class completion, post each attended person’s hours into an external adminapp2 SQL Server timesheet (one weekly row per person), preserving adminapp2’s approval step. Re-completing a class reverses and re-posts.',
  events: ['training.class.completed'],
  configFields: [
    {
      key: 'host',
      label: 'SQL Server host',
      type: 'text',
      required: true,
      placeholder: '10.0.0.44',
    },
    { key: 'port', label: 'Port', type: 'number', placeholder: '1433' },
    {
      key: 'database',
      label: 'Database',
      type: 'text',
      required: true,
      placeholder: 'AdminApp2',
    },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'webapp' },
    {
      key: 'table',
      label: 'Timesheet table',
      type: 'text',
      placeholder: 'timesheet',
      help: 'The weekly timesheet container table. Default: timesheet.',
    },
    {
      key: 'payrollItem',
      label: 'Payroll item id',
      type: 'number',
      placeholder: '1',
      help: 'External payrollItem internal id posted on each row.',
    },
    {
      key: 'item',
      label: 'Service item id',
      type: 'number',
      placeholder: '2551',
      help: 'External service-item internal id for training labour.',
    },
    {
      key: 'departmentMap',
      label: 'Department map',
      type: 'textarea',
      help: 'One per line: "Department name = external department id". Names match a person’s department.',
      placeholder: DEFAULT_DEPARTMENT_MAP,
    },
  ],
  secretFields: [{ key: 'password', label: 'Password', required: true }],
  test,
  handle,
}

// Exported for unit-testing the pure mapping logic.
export const _internal = { buildWeekRows, parseDepartmentMap, FALLBACK_HOURS_PER_DAY }
