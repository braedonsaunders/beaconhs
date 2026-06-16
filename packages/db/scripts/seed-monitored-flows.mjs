// One-off data migration: give every monitor-enabled form template an on-submit
// "Start monitored session" Flow that replicates its legacy schema.monitor
// config. This populates the Flows tab for monitored apps (e.g. Lone Worker)
// after the monitoring config moved out of the dedicated Monitor tab into Flows.
//
// Idempotent — skips templates that already have a start_monitored_session
// flow. Safe to re-run. App code keeps the schema.monitor fallback working, so
// running this is about surfacing the flow in the builder, not correctness.
//
//   node packages/db/scripts/seed-monitored-flows.mjs
//
// Reads DATABASE_URL from the environment, else from the repo .env.

import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const here = dirname(fileURLToPath(import.meta.url))
  for (const rel of ['../../../.env', '../../.env', '../.env', '.env']) {
    try {
      const m = readFileSync(resolve(here, rel), 'utf8').match(/^DATABASE_URL=(.+)$/m)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    } catch {
      /* try next */
    }
  }
  throw new Error('DATABASE_URL not found (env or .env)')
}

function buildGraph(m) {
  const action = {
    action: 'start_monitored_session',
    intervalMinutes: m.intervalMinutes ?? 30,
    graceMinutes: m.graceMinutes ?? 10,
  }
  if (m.durationMinutes != null) action.durationMinutes = m.durationMinutes
  if (m.requireGeo) action.requireGeo = true
  if (m.intervalFieldKey) action.intervalFieldKey = m.intervalFieldKey
  if (m.graceFieldKey) action.graceFieldKey = m.graceFieldKey
  if (m.durationFieldKey) action.durationFieldKey = m.durationFieldKey
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trg',
        position: { x: 60, y: 80 },
        data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
      },
      { id: 'mon', position: { x: 380, y: 80 }, data: { kind: 'action', action } },
    ],
    edges: [{ id: 'e1', source: 'trg', target: 'mon', sourceHandle: 'next' }],
  }
}

const sql = postgres(databaseUrl(), { ssl: false, max: 1, connect_timeout: 30 })
try {
  const tenants = await sql`SELECT id, slug FROM tenants ORDER BY slug`
  let found = 0
  let inserted = 0
  let skipped = 0
  for (const tn of tenants) {
    await sql.begin(async (tx) => {
      // RLS: scope this tenant's rows.
      await tx`SELECT set_config('app.tenant_id', ${tn.id}, true)`
      const rows = await tx`
        SELECT DISTINCT ON (template_id) template_id, schema
        FROM form_template_versions
        WHERE schema->'monitor'->>'enabled' = 'true'
        ORDER BY template_id, version DESC`
      for (const r of rows) {
        found++
        const existing = await tx`
          SELECT id FROM form_automations
          WHERE template_id = ${r.template_id} AND graph::text LIKE ${'%start_monitored_session%'}
          LIMIT 1`
        if (existing.length > 0) {
          skipped++
          continue
        }
        await tx`
          INSERT INTO form_automations (tenant_id, template_id, name, enabled, graph)
          VALUES (${tn.id}, ${r.template_id}, ${'Monitored session'}, ${true}, ${sql.json(buildGraph(r.schema.monitor ?? {}))})`
        inserted++
      }
    })
  }
  console.log(
    `[seed-monitored-flows] tenants=${tenants.length} monitor-enabled templates=${found} → inserted=${inserted} skipped(existing)=${skipped}`,
  )
} finally {
  await sql.end()
}
