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
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { departments, orgUnits, people } from './org'
import { incidentClassifications, incidentInjuryTypes } from './incident-classifications'

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
    // Draft-first: instant-created incidents start as a HIDDEN draft — excluded
    // from lists, dashboards, compliance counts, the feed, and notifications
    // until committed (required fields filled). A worker sweeps drafts untouched
    // > 48h. Existing rows default to false (committed).
    isDraft: boolean('is_draft').default(false).notNull(),
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
    // Wave-4: structured first-aid notes (separate from generic narrative
    // fields).  Used by the OSHA-300 supplementary log.
    firstAidGiven: boolean('first_aid_given').default(false).notNull(),
    firstAidNotes: text('first_aid_notes'),

    medicalAttentionReceived: boolean('medical_attention_received').default(false).notNull(),
    treatedAtHospital: text('treated_at_hospital'),
    treatedInCity: text('treated_in_city'),
    transportation: text('transportation'),
    // Wave-4: EMS dispatch trail.  Legacy parity = EMS bool + freeform note;
    // here we split out the call-out flag and the arrival/discharge stamps
    // because the severity-report needs the response-time delta.
    emsCalled: boolean('ems_called').default(false).notNull(),
    emsArrivedAt: timestamp('ems_arrived_at', { withTimezone: true }),
    hospitalName: text('hospital_name'),
    hospitalArrivedAt: timestamp('hospital_arrived_at', { withTimezone: true }),
    dischargedAt: timestamp('discharged_at', { withTimezone: true }),
    attendingPhysician: text('attending_physician'),
    // Ministry-of-Labour notification trail — sub-fields appear once the
    // top-level `ministryOfLabourNotified` flag is set.
    molNotifiedAt: timestamp('mol_notified_at', { withTimezone: true }),
    molReportNumber: text('mol_report_number'),

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
    // Wave-4: blended 1-5 "incident severity rating" used by the
    // severity-trend report.  Distinct from the per-event actual/potential
    // pair so we can roll up across an entire incident family.
    severityRating: integer('severity_rating'),
    // Wave-4: dollar cost of property/asset damage (USD).  Drives the
    // financial line on the incident-cost report.  Stored as numeric to
    // avoid floating-point drift.
    damageEstimate: numeric('damage_estimate', { precision: 14, scale: 2 }),

    // Wave-4: police + insurance trail for vehicle / theft / liability
    // incidents.
    policeNotified: boolean('police_notified').default(false).notNull(),
    policeReportNumber: text('police_report_number'),
    insuranceClaimNumber: text('insurance_claim_number'),

    // Wave-4: explicit FK to the tenant-defined classification taxonomy.
    // Coexists with the legacy `classification` JSON column (which carries
    // the materialised path so old reports keep rendering after an
    // archive).
    classificationId: uuid('classification_id').references(() => incidentClassifications.id, {
      onDelete: 'set null',
    }),

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

    // Typed FK shortcut to the form_response that spawned this incident from
    // the Create-Incident drawer on the response detail page. Lets the
    // response viewer link back to its spawned incident without joining via
    // the polymorphic source columns.
    sourceFormResponseId: uuid('source_form_response_id'),

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
    // Legacy: free-form list of injury labels.  New rows should also set
    // `injuryTypeId` so the report rollups can join against the tenant
    // taxonomy.  We keep the array in place for back-compat and to support
    // multi-type injuries (laceration + chemical burn).
    injuryTypes: jsonb('injury_types').$type<string[]>().default([]).notNull(),
    injuryTypeId: uuid('injury_type_id').references(() => incidentInjuryTypes.id, {
      onDelete: 'set null',
    }),
    treatment: text('treatment'),
    treatedAtFacility: text('treated_at_facility'),
    workedHoursPriorTo: integer('worked_hours_prior_to'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('incident_injuries_tenant_idx').on(t.tenantId),
    incidentIdx: index('incident_injuries_incident_idx').on(t.incidentId),
    injuryTypeIdx: index('incident_injuries_injury_type_idx').on(t.injuryTypeId),
  }),
)

// Lost time transitions (off → restricted → full duty)
export const lostTimeStatus = pgEnum('lost_time_status', [
  'off_work',
  'restricted_duty',
  'full_duty',
])

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

// ---- Investigation sub-tables ---------------------------------------------
//
// Five-step investigation flow (matches legacy Laravel app):
//   1. Data        -> existing incident detail fields
//   2. Events      -> incident_events  (chronological log)
//   3. Cause       -> incident_contributing_factors  (categorised list)
//   4. Root cause  -> incidents.rootCause (text) + incident_root_cause_whys
//                     (optional 1–5 "why" chain)
//   5. Prevention  -> incident_preventative_steps  (owner + target date + status)

// Chronological "what happened, when" entries.
export const incidentEvents = pgTable(
  'incident_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedByTenantUserId: uuid('recorded_by_tenant_user_id').references(() => tenantUsers.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_events_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_events_tenant_idx').on(t.tenantId),
    occurredIdx: index('incident_events_occurred_idx').on(t.incidentId, t.occurredAt),
  }),
)

// Immediate / contributing factors, categorised.
export const incidentFactorCategory = pgEnum('incident_factor_category', [
  'equipment',
  'procedure',
  'training',
  'environment',
  'human',
  'other',
])

export const incidentContributingFactors = pgTable(
  'incident_contributing_factors',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    category: incidentFactorCategory('category').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    incidentIdx: index('incident_contributing_factors_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_contributing_factors_tenant_idx').on(t.tenantId),
  }),
)

// Optional 5-whys chain.  Ordinal 1..5 — caller controls how many rows exist.
export const incidentRootCauseWhys = pgTable(
  'incident_root_cause_whys',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    whyText: text('why_text').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_root_cause_whys_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_root_cause_whys_tenant_idx').on(t.tenantId),
    incidentOrdinalUx: index('incident_root_cause_whys_incident_ordinal_idx').on(
      t.incidentId,
      t.ordinal,
    ),
  }),
)

// Preventative / corrective steps (lighter-weight than corrective_actions —
// captured inline on the investigation tab.  Linking to a full CAPA record is
// a follow-up.)
export const incidentPreventativeStepStatus = pgEnum('incident_preventative_step_status', [
  'planned',
  'in_progress',
  'completed',
])

export const incidentPreventativeSteps = pgTable(
  'incident_preventative_steps',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    targetDate: date('target_date'),
    status: incidentPreventativeStepStatus('status').default('planned').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_preventative_steps_incident_idx').on(t.incidentId),
    tenantIdx: index('incident_preventative_steps_tenant_idx').on(t.tenantId),
    statusIdx: index('incident_preventative_steps_status_idx').on(t.tenantId, t.status),
  }),
)

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [incidents.tenantId], references: [tenants.id] }),
  site: one(orgUnits, { fields: [incidents.siteOrgUnitId], references: [orgUnits.id] }),
  classificationRef: one(incidentClassifications, {
    fields: [incidents.classificationId],
    references: [incidentClassifications.id],
  }),
  injuries: many(incidentInjuries),
  lostTimeEvents: many(incidentLostTimeEvents),
  involved: many(incidentPeople),
  attachments: many(incidentAttachments),
  events: many(incidentEvents),
  contributingFactorRows: many(incidentContributingFactors),
  rootCauseWhys: many(incidentRootCauseWhys),
  preventativeSteps: many(incidentPreventativeSteps),
}))

export const incidentEventsRelations = relations(incidentEvents, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentEvents.incidentId],
    references: [incidents.id],
  }),
  recordedBy: one(tenantUsers, {
    fields: [incidentEvents.recordedByTenantUserId],
    references: [tenantUsers.id],
  }),
}))

export const incidentContributingFactorsRelations = relations(
  incidentContributingFactors,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentContributingFactors.incidentId],
      references: [incidents.id],
    }),
  }),
)

export const incidentRootCauseWhysRelations = relations(incidentRootCauseWhys, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentRootCauseWhys.incidentId],
    references: [incidents.id],
  }),
}))

export const incidentPreventativeStepsRelations = relations(
  incidentPreventativeSteps,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentPreventativeSteps.incidentId],
      references: [incidents.id],
    }),
    owner: one(people, {
      fields: [incidentPreventativeSteps.ownerPersonId],
      references: [people.id],
    }),
  }),
)

export const incidentInjuriesRelations = relations(incidentInjuries, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentInjuries.incidentId],
    references: [incidents.id],
  }),
  injuryTypeRef: one(incidentInjuryTypes, {
    fields: [incidentInjuries.injuryTypeId],
    references: [incidentInjuryTypes.id],
  }),
  person: one(people, {
    fields: [incidentInjuries.personId],
    references: [people.id],
  }),
}))
