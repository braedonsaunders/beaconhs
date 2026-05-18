// Incidents — full taxonomy matching the legacy BeaconHS incident detail page:
//   General (people involved, supervisor, location, classification, events, witnesses, PPE worn)
//   Medical (injury type, EMS/MOL/first-aid/medical/lost-time/modified-duty with conditional sub-fields)
//   Key Metrics (actual + potential severity, 1-5 scales)
//   Photos & Files
//   Sign-Off (lock + investigator)
//
// Investigation is itself a form_response (sourceEntityType='incident').

import { relations } from 'drizzle-orm'
import {
  boolean,
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
import { departments, orgUnits, people } from './org'

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
  'no_injury',
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
    reference: text('reference').notNull(),

    // Top-level taxonomy
    type: incidentType('type').notNull(),
    severity: incidentSeverity('severity').notNull(),
    status: incidentStatus('status').default('reported').notNull(),
    classification: jsonb('classification').$type<Record<string, string>>().default({}).notNull(),

    // Brief
    title: text('title').notNull(),
    description: text('description'),

    // Timestamps
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),

    // Location
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    location: text('location'), // location-on-site / specific area
    weather: text('weather'),
    departmentId: uuid('department_id').references(() => departments.id),

    // People involved (single-FK convenience pointers; multi-person tracked in incident_people)
    reportedByTenantUserId: uuid('reported_by_tenant_user_id').references(() => tenantUsers.id),
    supervisorPersonId: uuid('supervisor_person_id').references(() => people.id),
    foremanText: text('foreman_text'), // freeform when foreman isn't a person row
    externalPeopleInvolved: text('external_people_involved'),
    witnesses: text('witnesses'),

    // Narrative
    eventsLeadingUp: text('events_leading_up'),
    immediateActionTaken: text('immediate_action_taken'),
    ppeWorn: text('ppe_worn'),

    // Medical flags + conditional sub-fields
    criticalInjury: boolean('critical_injury').default(false).notNull(),
    ministryOfLabourNotified: boolean('ministry_of_labour_notified').default(false).notNull(),
    emsNotified: boolean('ems_notified').default(false).notNull(),

    firstAidReceived: boolean('first_aid_received').default(false).notNull(),
    firstAidProvider: text('first_aid_provider'),

    medicalAttentionReceived: boolean('medical_attention_received').default(false).notNull(),
    treatedAtHospital: text('treated_at_hospital'),
    treatedInCity: text('treated_in_city'),
    transportation: text('transportation'),

    lostTime: boolean('lost_time').default(false).notNull(),
    lostTimeFirstDay: date('lost_time_first_day'),
    lostTimeLastDay: date('lost_time_last_day'),
    lostTimeDays: integer('lost_time_days'),

    modifiedDuty: boolean('modified_duty').default(false).notNull(),
    modifiedDutyFirstDay: date('modified_duty_first_day'),
    modifiedDutyLastDay: date('modified_duty_last_day'),
    modifiedDutyDays: integer('modified_duty_days'),

    externallyReportable: boolean('externally_reportable').default(false).notNull(),

    // Key metrics — actual vs potential severity (1-5 scales, matches legacy radio buttons)
    actualSeverity: integer('actual_severity'),
    potentialSeverity: integer('potential_severity'),

    // Investigation
    rootCause: text('root_cause'),
    contributingFactors: jsonb('contributing_factors').$type<string[]>().default([]).notNull(),
    assignedInvestigatorTenantUserId: uuid('assigned_investigator_tenant_user_id').references(
      () => tenantUsers.id,
    ),

    // Lock-on-completion
    inProgress: boolean('in_progress').default(true).notNull(),
    locked: boolean('locked').default(false).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id').references(() => tenantUsers.id),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('incidents_tenant_idx').on(t.tenantId),
    referenceIdx: index('incidents_reference_idx').on(t.tenantId, t.reference),
    statusIdx: index('incidents_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('incidents_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('incidents_site_idx').on(t.tenantId, t.siteOrgUnitId),
  }),
)

// People involved (one incident can involve N employees)
export const incidentPeople = pgTable(
  'incident_people',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id),
    personNameText: text('person_name_text'), // freeform name if not in directory
    role: text('role'), // 'involved' | 'witness' | 'supervisor' | 'foreman'
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_people_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_people_tenant_idx').on(t.tenantId),
  }),
)

// Per-injured-person record
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
    personName: text('person_name'),
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

// Lost time transitions (off → restricted → full duty)
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

// Photos & files attached to an incident (separate from generic attachments
// so we can show them inline on the detail page).
export const incidentAttachments = pgTable(
  'incident_attachments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_attachments_incident_idx').on(t.incidentId),
  }),
)

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [incidents.tenantId], references: [tenants.id] }),
  site: one(orgUnits, { fields: [incidents.siteOrgUnitId], references: [orgUnits.id] }),
  injuries: many(incidentInjuries),
  lostTimeEvents: many(incidentLostTimeEvents),
  involved: many(incidentPeople),
  attachments: many(incidentAttachments),
}))
