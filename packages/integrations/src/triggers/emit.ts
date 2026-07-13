// Event builders — one per trigger. Each builds flat Item(s) from data already
// in scope at the source action. Keeping
// payload-shaping here means the trigger registry stays pure and the source
// actions stay compact. These builders are pure: the originating mutation
// stores the returned event in domain_event_outbox inside its DB transaction.

import type { IntegrationEvent, Item, Scalar } from '../types'

function iso(d: unknown): string {
  if (!d) return ''
  if (d instanceof Date) return d.toISOString()
  const dt = new Date(String(d))
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString()
}

function s(v: unknown): Scalar {
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function baseUrl(): string {
  // Same resolution order as apps/web + apps/worker app-base-url helpers.
  return (
    process.env.PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    ''
  ).replace(/\/$/, '')
}
function link(path: string): string {
  const b = baseUrl()
  return b ? `${b}${path}` : path
}

// --- training --------------------------------------------------------------

export interface TrainingAttendeeFact {
  personId: string
  externalEmployeeId: string | null
  firstName: string
  lastName: string
  departmentName: string | null
  attended: boolean
  hours: number
}

export function trainingClassCompletedEvent(
  tenantId: string,
  e: {
    classId: string
    course: { code: string; name: string }
    startsAt: string
    endsAt: string
    hoursPerDay: number
    lengthDays: number
    attendees: TrainingAttendeeFact[]
  },
): IntegrationEvent {
  const items: Item[] = e.attendees.map((a) => ({
    classId: e.classId,
    'course.code': s(e.course.code),
    'course.name': s(e.course.name),
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    hoursPerDay: e.hoursPerDay,
    lengthDays: e.lengthDays,
    personId: a.personId,
    externalEmployeeId: a.externalEmployeeId,
    firstName: s(a.firstName),
    lastName: s(a.lastName),
    fullName: `${a.firstName} ${a.lastName}`.trim(),
    departmentName: a.departmentName,
    hours: a.hours,
    attended: a.attended,
  }))
  return { type: 'training.class.completed', tenantId, subjectId: e.classId, items }
}

// --- incidents -------------------------------------------------------------

export function incidentCreatedEvent(
  tenantId: string,
  i: {
    id: string
    reference?: string | null
    type?: string | null
    severity?: string | null
    status?: string | null
    title?: string | null
    description?: string | null
    occurredAt?: unknown
    location?: string | null
    reportedByName?: string | null
  },
): IntegrationEvent {
  return {
    type: 'incident.created',
    tenantId,
    subjectId: i.id,
    items: [
      {
        incidentId: i.id,
        reference: s(i.reference),
        type: s(i.type),
        severity: s(i.severity),
        status: s(i.status),
        title: s(i.title),
        description: s(i.description),
        occurredAt: iso(i.occurredAt),
        location: s(i.location),
        reportedByName: s(i.reportedByName),
        createdAt: iso(new Date()),
        url: link(`/incidents/${i.id}`),
      },
    ],
  }
}

export function incidentStatusChangedEvent(
  tenantId: string,
  i: {
    id: string
    reference?: string | null
    title?: string | null
    type?: string | null
    severity?: string | null
    fromStatus?: string | null
    toStatus: string
  },
): IntegrationEvent {
  return {
    type: 'incident.status_changed',
    tenantId,
    subjectId: i.id,
    items: [
      {
        incidentId: i.id,
        reference: s(i.reference),
        title: s(i.title),
        type: s(i.type),
        severity: s(i.severity),
        fromStatus: s(i.fromStatus),
        toStatus: s(i.toStatus),
        changedAt: iso(new Date()),
        url: link(`/incidents/${i.id}`),
      },
    ],
  }
}

// --- corrective actions ----------------------------------------------------

export function correctiveActionCreatedEvent(
  tenantId: string,
  c: {
    id: string
    reference?: string | null
    title?: string | null
    status?: string | null
    severity?: string | null
    source?: string | null
    dueOn?: unknown
    assignedOn?: unknown
    ownerName?: string | null
    assignedByName?: string | null
  },
): IntegrationEvent {
  return {
    type: 'corrective_action.created',
    tenantId,
    subjectId: c.id,
    items: [
      {
        caId: c.id,
        reference: s(c.reference),
        title: s(c.title),
        status: s(c.status),
        severity: s(c.severity),
        source: s(c.source),
        dueOn: iso(c.dueOn),
        assignedOn: iso(c.assignedOn),
        ownerName: s(c.ownerName),
        assignedByName: s(c.assignedByName),
        url: link(`/corrective-actions/${c.id}`),
      },
    ],
  }
}

export function correctiveActionClosedEvent(
  tenantId: string,
  c: {
    id: string
    reference?: string | null
    title?: string | null
    status?: string | null
    severity?: string | null
    closedAt?: unknown
    ownerName?: string | null
  },
): IntegrationEvent {
  return {
    type: 'corrective_action.closed',
    tenantId,
    subjectId: c.id,
    items: [
      {
        caId: c.id,
        reference: s(c.reference),
        title: s(c.title),
        status: s(c.status ?? 'closed'),
        severity: s(c.severity),
        closedAt: iso(c.closedAt ?? new Date()),
        ownerName: s(c.ownerName),
        url: link(`/corrective-actions/${c.id}`),
      },
    ],
  }
}

// --- forms -----------------------------------------------------------------

export function formSubmittedEvent(
  tenantId: string,
  r: {
    id: string
    templateId?: string | null
    templateName?: string | null
    status?: string | null
    submittedByName?: string | null
    submittedAt?: unknown
    complianceScore?: number | null
    complianceStatus?: string | null
    data?: Record<string, unknown> | null
  },
): IntegrationEvent {
  const item: Item = {
    responseId: r.id,
    templateId: s(r.templateId),
    templateName: s(r.templateName),
    status: s(r.status),
    submittedByName: s(r.submittedByName),
    submittedAt: iso(r.submittedAt ?? new Date()),
    complianceScore: r.complianceScore ?? null,
    complianceStatus: s(r.complianceStatus),
    url: link(`/apps/responses/${r.id}`),
  }
  // Flatten the form's own fields as data.<key> tokens.
  for (const [k, v] of Object.entries(r.data ?? {})) {
    item[`data.${k}`] = s(typeof v === 'object' ? JSON.stringify(v) : v)
  }
  return { type: 'form.submitted', tenantId, subjectId: r.id, items: [item] }
}

// --- hazard assessments ----------------------------------------------------

export function hazardAssessmentCreatedEvent(
  tenantId: string,
  h: {
    id: string
    reference?: string | null
    status?: string | null
    typeName?: string | null
    occurredAt?: unknown
    locationOnSite?: string | null
    supervisorName?: string | null
    reportedByName?: string | null
  },
): IntegrationEvent {
  return {
    type: 'hazard_assessment.created',
    tenantId,
    subjectId: h.id,
    items: [
      {
        assessmentId: h.id,
        reference: s(h.reference),
        status: s(h.status),
        typeName: s(h.typeName),
        occurredAt: iso(h.occurredAt),
        locationOnSite: s(h.locationOnSite),
        supervisorName: s(h.supervisorName),
        reportedByName: s(h.reportedByName),
        url: link(`/hazard-assessments/${h.id}`),
      },
    ],
  }
}

// --- journals --------------------------------------------------------------

export function journalEntrySubmittedEvent(
  tenantId: string,
  j: {
    id: string
    reference?: string | null
    title?: string | null
    status?: string | null
    submittedAt?: unknown
    entryDate?: unknown
    authorName?: string | null
    siteName?: string | null
    summary?: string | null
  },
): IntegrationEvent {
  return {
    type: 'journal_entry.submitted',
    tenantId,
    subjectId: j.id,
    items: [
      {
        entryId: j.id,
        reference: s(j.reference),
        title: s(j.title),
        status: s(j.status ?? 'submitted'),
        submittedAt: iso(j.submittedAt ?? new Date()),
        entryDate: iso(j.entryDate),
        authorName: s(j.authorName),
        siteName: s(j.siteName),
        summary: s(j.summary),
        url: link(`/journals/${j.id}`),
      },
    ],
  }
}
