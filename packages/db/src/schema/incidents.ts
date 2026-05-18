// Incidents — first-class taxonomy (type, severity/recordability, body part, lost-time).
// Investigation is a form_response (sourceEntityType='incident').

import { relations } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits, people } from './org'

export const incidentType = pgEnum('incident_type', [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
])

export const incidentSeverity = pgEnum('incident_severity', [
  'first_aid_only',
  'medical_aid',
  'lost_time',
  'fatality',
  'no_injury', // for near-miss / property damage
])

export const incidentStatus = pgEnum('incident_status', [
  'reported',
  'under_investigation',
  'pending_review',
  'closed',
  'reopened',
])

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // tenant-scoped human ID e.g. INC-2026-0001
    type: incidentType('type').notNull(),
    severity: incidentSeverity('severity').notNull(),
    status: incidentStatus('status').default('reported').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    reportedByTenantUserId: uuid('reported_by_tenant_user_id').references(() => tenantUsers.id),
    assignedInvestigatorTenantUserId: uuid('assigned_investigator_tenant_user_id').references(
      () => tenantUsers.id,
    ),
    // Optional structured fields. Per-tenant custom fields live in the
    // attached investigation form response.
    location: text('location'),
    weather: text('weather'),
    immediateActionTaken: text('immediate_action_taken'),
    rootCause: text('root_cause'),
    contributingFactors: jsonb('contributing_factors').$type<string[]>().default([]).notNull(),
    classification: jsonb('classification').$type<Record<string, string>>().default({}).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('incidents_tenant_idx').on(t.tenantId),
    referenceUx: index('incidents_reference_idx').on(t.tenantId, t.reference),
    statusIdx: index('incidents_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('incidents_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('incidents_site_idx').on(t.tenantId, t.siteOrgUnitId),
  }),
)

// Per-injured-person record. An incident can have N injured people.
export const incidentInjuries = pgTable(
  'incident_injuries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id),
    personName: text('person_name'), // freeform when person not in system
    bodyParts: jsonb('body_parts').$type<string[]>().default([]).notNull(),
    injuryTypes: jsonb('injury_types').$type<string[]>().default([]).notNull(),
    treatment: text('treatment'),
    treatedAtFacility: text('treated_at_facility'),
    workedHoursPriorTo: integer('worked_hours_prior_to'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('incident_injuries_tenant_idx').on(t.tenantId),
    incidentIdx: index('incident_injuries_incident_idx').on(t.incidentId),
  }),
)

// Multi-event lost-time tracking (off → restricted → full duty transitions).
export const lostTimeStatus = pgEnum('lost_time_status', ['off_work', 'restricted_duty', 'full_duty'])

export const incidentLostTimeEvents = pgTable(
  'incident_lost_time_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    injuryId: uuid('injury_id').references(() => incidentInjuries.id),
    status: lostTimeStatus('status').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_lost_time_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_lost_time_tenant_idx').on(t.tenantId),
  }),
)

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [incidents.tenantId], references: [tenants.id] }),
  site: one(orgUnits, { fields: [incidents.siteOrgUnitId], references: [orgUnits.id] }),
  injuries: many(incidentInjuries),
  lostTimeEvents: many(incidentLostTimeEvents),
}))
