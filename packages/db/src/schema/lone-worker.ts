// Lone worker check-in. Timer-based with auto-escalation if missed.

import { relations } from 'drizzle-orm'
import {
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits } from './org'

export const lwSessionStatus = pgEnum('lw_session_status', [
  'active',
  'completed',
  'missed',
  'escalated',
  'cancelled',
])

export const lwSessions = pgTable(
  'lw_sessions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workerTenantUserId: uuid('worker_tenant_user_id')
      .notNull()
      .references(() => tenantUsers.id),
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    task: text('task'),
    intervalMinutes: integer('interval_minutes').notNull(),
    gracePeriodMinutes: integer('grace_period_minutes').default(10).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    expectedEndAt: timestamp('expected_end_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    nextCheckinDueAt: timestamp('next_checkin_due_at', { withTimezone: true }).notNull(),
    status: lwSessionStatus('status').default('active').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('lw_sessions_tenant_idx').on(t.tenantId),
    workerIdx: index('lw_sessions_worker_idx').on(t.tenantId, t.workerTenantUserId),
    statusIdx: index('lw_sessions_status_idx').on(t.tenantId, t.status),
    dueIdx: index('lw_sessions_due_idx').on(t.status, t.nextCheckinDueAt),
  }),
)

export const lwCheckinKind = pgEnum('lw_checkin_kind', [
  'manual',
  'auto_prompted',
  'missed',
  'escalation_acknowledged',
])

export const lwCheckins = pgTable(
  'lw_checkins',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lwSessions.id, { onDelete: 'cascade' }),
    kind: lwCheckinKind('kind').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    note: text('note'),
  },
  (t) => ({
    sessionIdx: index('lw_checkins_session_idx').on(t.sessionId, t.recordedAt),
    tenantIdx: index('lw_checkins_tenant_idx').on(t.tenantId),
  }),
)

export const lwSessionsRelations = relations(lwSessions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [lwSessions.tenantId], references: [tenants.id] }),
  checkins: many(lwCheckins),
}))
