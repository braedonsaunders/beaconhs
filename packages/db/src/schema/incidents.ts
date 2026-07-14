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
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { formResponses } from './forms'
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
    flowExecutionKey: text('flow_execution_key'),

    // Top-level taxonomy
    type: incidentType('type').notNull(),
    severity: incidentSeverity('severity').notNull(),
    status: incidentStatus('status').default('reported').notNull(),
    // Draft-first: instant-created incidents start as a HIDDEN draft — excluded
    // from lists, dashboards, compliance counts, the feed, and notifications
    // until committed (required fields filled). A worker sweeps drafts untouched
    // > 48h. Existing rows default to false (committed).
    isDraft: boolean('is_draft').default(false).notNull(),
    // Brief
    title: text('title').notNull(),
    description: text('description'),

    // Timestamps
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),

    // Location
    siteOrgUnitId: uuid('site_org_unit_id'),
    location: text('location'), // location-on-site / specific area
    weather: text('weather'),
    departmentId: uuid('department_id'),

    // People involved (single-FK convenience pointers; multi-person tracked in incident_people)
    reportedByTenantUserId: uuid('reported_by_tenant_user_id'),
    supervisorPersonId: uuid('supervisor_person_id'),
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
    firstAidProvider: text('first_aid_provider'),
    // Structured first-aid notes (separate from generic narrative fields).
    // Used by the OSHA-300 supplementary log.
    firstAidGiven: boolean('first_aid_given').default(false).notNull(),
    firstAidNotes: text('first_aid_notes'),

    medicalAttentionReceived: boolean('medical_attention_received').default(false).notNull(),
    treatedInCity: text('treated_in_city'),
    transportation: text('transportation'),
    // EMS dispatch trail, including response-time and hospital timestamps.
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

    // Explicit FK to the tenant-defined classification taxonomy.
    classificationId: uuid('classification_id'),

    // Investigation
    rootCause: text('root_cause'),
    contributingFactors: jsonb('contributing_factors').$type<string[]>().default([]).notNull(),
    assignedInvestigatorTenantUserId: uuid('assigned_investigator_tenant_user_id'),

    // Lock-on-completion
    inProgress: boolean('in_progress').default(true).notNull(),
    locked: boolean('locked').default(false).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id'),

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
    tenantIdIdUx: uniqueIndex('incidents_tenant_id_id_ux').on(t.tenantId, t.id),
    referenceIdx: index('incidents_reference_idx').on(t.tenantId, t.reference),
    statusIdx: index('incidents_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('incidents_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('incidents_site_idx').on(t.tenantId, t.siteOrgUnitId),
    departmentIdx: index('incidents_department_idx').on(t.tenantId, t.departmentId),
    reportedByIdx: index('incidents_reported_by_idx').on(t.tenantId, t.reportedByTenantUserId),
    supervisorIdx: index('incidents_supervisor_idx').on(t.tenantId, t.supervisorPersonId),
    classificationIdx: index('incidents_classification_idx').on(t.tenantId, t.classificationId),
    investigatorIdx: index('incidents_investigator_idx').on(
      t.tenantId,
      t.assignedInvestigatorTenantUserId,
    ),
    closedByIdx: index('incidents_closed_by_idx').on(t.tenantId, t.closedByTenantUserId),
    sourceResponseIdx: index('incidents_source_response_idx').on(
      t.tenantId,
      t.sourceFormResponseId,
    ),
    flowExecutionUx: uniqueIndex('incidents_flow_execution_ux').on(t.tenantId, t.flowExecutionKey),
    siteFk: foreignKey({
      name: 'incidents_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    departmentFk: foreignKey({
      name: 'incidents_tenant_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    reportedByFk: foreignKey({
      name: 'incidents_tenant_reported_by_fk',
      columns: [t.tenantId, t.reportedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    supervisorFk: foreignKey({
      name: 'incidents_tenant_supervisor_fk',
      columns: [t.tenantId, t.supervisorPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    investigatorFk: foreignKey({
      name: 'incidents_tenant_investigator_fk',
      columns: [t.tenantId, t.assignedInvestigatorTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    closedByFk: foreignKey({
      name: 'incidents_tenant_closed_by_fk',
      columns: [t.tenantId, t.closedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
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
    incidentId: uuid('incident_id').notNull(),
    personId: uuid('person_id'),
    personNameText: text('person_name_text'), // freeform name if not in directory
    role: text('role'), // 'involved' | 'witness' | 'supervisor' | 'foreman'
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_people_incident_idx').on(t.tenantId, t.incidentId),
    personIdx: index('incident_people_person_idx').on(t.tenantId, t.personId),
    tenantIdx: index('incident_people_tenant_idx').on(t.tenantId),
    incidentFk: foreignKey({
      name: 'incident_people_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'incident_people_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }),
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
    incidentId: uuid('incident_id').notNull(),
    personId: uuid('person_id'),
    personName: text('person_name'),
    bodyParts: jsonb('body_parts').$type<string[]>().default([]).notNull(),
    // Descriptive outcome/result is intentionally separate from the managed
    // injury-type taxonomy. An injury can have many canonical types through
    // incident_injury_type_assignments below.
    injuryResult: text('injury_result'),
    treatment: text('treatment'),
    treatedAtFacility: text('treated_at_facility'),
    workedHoursPriorTo: integer('worked_hours_prior_to'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('incident_injuries_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('incident_injuries_tenant_id_id_ux').on(t.tenantId, t.id),
    incidentIdx: index('incident_injuries_incident_idx').on(t.tenantId, t.incidentId),
    personIdx: index('incident_injuries_person_idx').on(t.tenantId, t.personId),
    incidentFk: foreignKey({
      name: 'incident_injuries_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'incident_injuries_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }),
  }),
)

// Canonical many-to-many link between an injured-person record and the
// tenant-managed injury-type taxonomy. Keeping tenant_id on the link and both
// composite foreign keys makes cross-tenant assignments impossible even if a
// caller bypasses an application-level lookup.
export const incidentInjuryTypeAssignments = pgTable(
  'incident_injury_type_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    injuryId: uuid('injury_id').notNull(),
    injuryTypeId: uuid('injury_type_id').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('incident_injury_type_assignments_tenant_idx').on(t.tenantId),
    injuryIdx: index('incident_injury_type_assignments_injury_idx').on(t.tenantId, t.injuryId),
    injuryTypeIdx: index('incident_injury_type_assignments_type_idx').on(
      t.tenantId,
      t.injuryTypeId,
    ),
    tenantInjuryTypeUx: uniqueIndex('incident_injury_type_assignments_injury_type_ux').on(
      t.tenantId,
      t.injuryId,
      t.injuryTypeId,
    ),
    injuryFk: foreignKey({
      name: 'incident_injury_type_assignments_tenant_injury_fk',
      columns: [t.tenantId, t.injuryId],
      foreignColumns: [incidentInjuries.tenantId, incidentInjuries.id],
    }).onDelete('cascade'),
    injuryTypeFk: foreignKey({
      name: 'incident_injury_type_assignments_tenant_type_fk',
      columns: [t.tenantId, t.injuryTypeId],
      foreignColumns: [incidentInjuryTypes.tenantId, incidentInjuryTypes.id],
    }),
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
    incidentId: uuid('incident_id').notNull(),
    injuryId: uuid('injury_id'),
    status: lostTimeStatus('status').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_lost_time_incident_idx').on(t.tenantId, t.incidentId),
    injuryIdx: index('incident_lost_time_injury_idx').on(t.tenantId, t.injuryId),
    tenantIdx: index('incident_lost_time_tenant_idx').on(t.tenantId),
    incidentFk: foreignKey({
      name: 'incident_lost_time_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
    injuryFk: foreignKey({
      name: 'incident_lost_time_tenant_injury_fk',
      columns: [t.tenantId, t.injuryId],
      foreignColumns: [incidentInjuries.tenantId, incidentInjuries.id],
    }),
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
    incidentId: uuid('incident_id').notNull(),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_attachments_incident_idx').on(t.tenantId, t.incidentId),
    incidentFk: foreignKey({
      name: 'incident_attachments_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
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
    incidentId: uuid('incident_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedByTenantUserId: uuid('recorded_by_tenant_user_id'),
    description: text('description').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_events_incident_idx').on(t.tenantId, t.incidentId),
    recordedByIdx: index('incident_events_recorded_by_idx').on(
      t.tenantId,
      t.recordedByTenantUserId,
    ),
    tenantIdx: index('incident_events_tenant_idx').on(t.tenantId),
    occurredIdx: index('incident_events_occurred_idx').on(t.incidentId, t.occurredAt),
    incidentFk: foreignKey({
      name: 'incident_events_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
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
    incidentId: uuid('incident_id').notNull(),
    category: incidentFactorCategory('category').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    incidentIdx: index('incident_contributing_factors_incident_idx').on(t.tenantId, t.incidentId),
    tenantIdx: index('incident_contributing_factors_tenant_idx').on(t.tenantId),
    incidentFk: foreignKey({
      name: 'incident_contributing_factors_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
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
    incidentId: uuid('incident_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    whyText: text('why_text').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_root_cause_whys_incident_idx').on(t.tenantId, t.incidentId),
    tenantIdx: index('incident_root_cause_whys_tenant_idx').on(t.tenantId),
    incidentOrdinalUx: uniqueIndex('incident_root_cause_whys_tenant_incident_ordinal_ux').on(
      t.tenantId,
      t.incidentId,
      t.ordinal,
    ),
    incidentFk: foreignKey({
      name: 'incident_root_cause_whys_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
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
    incidentId: uuid('incident_id').notNull(),
    description: text('description').notNull(),
    ownerPersonId: uuid('owner_person_id'),
    targetDate: date('target_date'),
    status: incidentPreventativeStepStatus('status').default('planned').notNull(),
    ...timestamps,
  },
  (t) => ({
    incidentIdx: index('incident_preventative_steps_incident_idx').on(t.tenantId, t.incidentId),
    ownerIdx: index('incident_preventative_steps_owner_idx').on(t.tenantId, t.ownerPersonId),
    tenantIdx: index('incident_preventative_steps_tenant_idx').on(t.tenantId),
    statusIdx: index('incident_preventative_steps_status_idx').on(t.tenantId, t.status),
    incidentFk: foreignKey({
      name: 'incident_preventative_steps_tenant_incident_fk',
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
    }).onDelete('cascade'),
  }),
)

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [incidents.tenantId], references: [tenants.id] }),
  site: one(orgUnits, {
    fields: [incidents.tenantId, incidents.siteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
  classificationRef: one(incidentClassifications, {
    fields: [incidents.tenantId, incidents.classificationId],
    references: [incidentClassifications.tenantId, incidentClassifications.id],
  }),
  sourceFormResponse: one(formResponses, {
    fields: [incidents.tenantId, incidents.sourceFormResponseId],
    references: [formResponses.tenantId, formResponses.id],
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
    fields: [incidentEvents.tenantId, incidentEvents.incidentId],
    references: [incidents.tenantId, incidents.id],
  }),
  recordedBy: one(tenantUsers, {
    fields: [incidentEvents.tenantId, incidentEvents.recordedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
}))

export const incidentContributingFactorsRelations = relations(
  incidentContributingFactors,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentContributingFactors.tenantId, incidentContributingFactors.incidentId],
      references: [incidents.tenantId, incidents.id],
    }),
  }),
)

export const incidentRootCauseWhysRelations = relations(incidentRootCauseWhys, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentRootCauseWhys.tenantId, incidentRootCauseWhys.incidentId],
    references: [incidents.tenantId, incidents.id],
  }),
}))

export const incidentPreventativeStepsRelations = relations(
  incidentPreventativeSteps,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentPreventativeSteps.tenantId, incidentPreventativeSteps.incidentId],
      references: [incidents.tenantId, incidents.id],
    }),
    owner: one(people, {
      fields: [incidentPreventativeSteps.tenantId, incidentPreventativeSteps.ownerPersonId],
      references: [people.tenantId, people.id],
    }),
  }),
)

export const incidentInjuriesRelations = relations(incidentInjuries, ({ one, many }) => ({
  incident: one(incidents, {
    fields: [incidentInjuries.tenantId, incidentInjuries.incidentId],
    references: [incidents.tenantId, incidents.id],
  }),
  person: one(people, {
    fields: [incidentInjuries.tenantId, incidentInjuries.personId],
    references: [people.tenantId, people.id],
  }),
  injuryTypeAssignments: many(incidentInjuryTypeAssignments),
}))

export const incidentInjuryTypeAssignmentsRelations = relations(
  incidentInjuryTypeAssignments,
  ({ one }) => ({
    injury: one(incidentInjuries, {
      fields: [incidentInjuryTypeAssignments.tenantId, incidentInjuryTypeAssignments.injuryId],
      references: [incidentInjuries.tenantId, incidentInjuries.id],
    }),
    injuryType: one(incidentInjuryTypes, {
      fields: [incidentInjuryTypeAssignments.tenantId, incidentInjuryTypeAssignments.injuryTypeId],
      references: [incidentInjuryTypes.tenantId, incidentInjuryTypes.id],
    }),
  }),
)
