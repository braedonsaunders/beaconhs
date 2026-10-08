import { describe, expect, it, vi } from 'vitest'
import { expandRepeatMarkers, renderEmail, sanitizeEmailHtml } from '@beaconhs/email-render'
import { automationGraphSchema } from '@beaconhs/forms-core'
import type { AutomationGraph } from '@beaconhs/forms-core'
import {
  seedTrainingClassBookingEmail,
  TRAINING_CLASS_BOOKING_SOURCE,
} from './training-class-email'

const template = { id: 'a20ea372-fbba-4999-b959-db738b55879b', isActive: true, deletedAt: null }
function query(rows: unknown[]) {
  const promise = Promise.resolve(rows)
  return Object.assign(promise, {
    from: () => query(rows),
    where: () => query(rows),
    limit: () => query(rows),
  })
}
function transaction(
  flows: { id: string; graph: AutomationGraph }[] = [],
  created = true,
  existing = template,
) {
  const values = vi.fn((_input: unknown) => ({
    onConflictDoNothing: () => ({
      returning: () => Promise.resolve(created ? [{ id: template.id }] : []),
    }),
    returning: () => Promise.resolve([{ id: 'new-flow' }]),
  }))
  const set = vi.fn((_input: unknown) => ({ where: () => Promise.resolve([]) }))
  const tx = {
    execute: vi.fn().mockResolvedValue([]),
    insert: vi.fn((_input: unknown) => ({ values })),
    select: vi
      .fn()
      .mockReturnValueOnce(query([existing]))
      .mockReturnValueOnce(query(flows)),
    update: vi.fn((_input: unknown) => ({ set })),
  }
  return { tx: tx as unknown as Parameters<typeof seedTrainingClassBookingEmail>[0], values, set }
}
function bookingGraph(): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { kind: 'trigger', trigger: { trigger: 'class_confirmed' } },
      },
      {
        id: 'email',
        position: { x: 320, y: 0 },
        data: {
          kind: 'action',
          action: {
            action: 'send_email',
            mode: 'inline',
            subject: 'Our class: {{course_name}}',
            bodyTemplate:
              'A training class was scheduled.\n\nCourse: {{course_name}}\nStarts: {{starts_at}}\nEnds: {{ends_at}}\nClass location: {{site_name}}\nInstructor: {{instructor_name}}\n\n',
            to: [
              { type: 'field', field: 'attendee_emails' },
              { type: 'literal', email: 'coordinator@example.com' },
            ],
            attachPdf: true,
          },
        },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'email', sourceHandle: 'next' }],
  }
}

describe('native training booking email default', () => {
  it('renders every attendee after native designer sanitization with safe merge values', () => {
    const source = sanitizeEmailHtml(TRAINING_CLASS_BOOKING_SOURCE)
    expect(source).toContain('data-each="attendees"')
    const email = renderEmail(
      {
        mode: 'template',
        subjectTemplate: 'Class: {{course_name}}',
        compiledHtml: expandRepeatMarkers(source),
      },
      {
        course_name: 'First aid',
        starts_at: 'Oct 30, 2026, 7:30 AM',
        ends_at: 'Oct 30, 2026, 12:00 PM',
        site_name: 'North Conference Room',
        instructor_name: '',
        notes: '',
        attendee_count: 2,
        attendees: [
          { name: 'Mackenzie & Mann', email: 'mackenzie@example.com' },
          { name: 'Matt "Wood"', email: 'matt@example.com' },
        ],
      },
    )
    expect(email.html).toContain('Mackenzie &amp; Mann')
    expect(email.html).toContain('Matt &quot;Wood&quot;')
    expect(email.html).not.toContain('<Wood>')
    expect(email.html).toContain('Attendees (2)')
    expect(email.html).not.toContain('{{')
    expect(email.text).toContain('mackenzie@example.com')
    expect(email.text).toContain('matt@example.com')
    expect(email.text).toContain('7:30 AM')
    expect(email.text).toContain('12:00 PM')
    expect(email.text).not.toContain('Instructor')
    expect(email.text).not.toContain('Notes')
    expect(email.text).not.toContain('Qualified Instructor')
  })

  it('provisions one manual flow for new tenants using the native library template', async () => {
    const { tx, values } = transaction()
    expect(await seedTrainingClassBookingEmail(tx, 'tenant')).toMatchObject({
      templateCreated: true,
      flowsChanged: 1,
    })
    const flow = values.mock.calls
      .map((call) => call[0] as unknown as { graph?: AutomationGraph })
      .find((row) => row.graph)
    expect(automationGraphSchema.safeParse(flow?.graph).success).toBe(true)
    expect(flow?.graph?.nodes[0]?.data).toEqual({
      kind: 'trigger',
      trigger: { trigger: 'class_confirmed' },
    })
    expect(flow?.graph?.nodes[1]?.data).toMatchObject({
      action: { mode: 'template', templateId: template.id },
    })
  })

  it('upgrades the former default body while preserving recipients, subject, attachments and graph wiring', async () => {
    const graph = bookingGraph()
    const { tx, set } = transaction([{ id: 'flow', graph }])
    expect(
      await seedTrainingClassBookingEmail(tx, 'tenant', { upgradeInlineFlows: true }),
    ).toMatchObject({ flowsChanged: 1 })
    const next = (set.mock.calls[0]?.[0] as unknown as { graph: AutomationGraph }).graph
    expect(next.edges).toEqual(graph.edges)
    expect(next.nodes[0]).toEqual(graph.nodes[0])
    expect(next.nodes[1]?.data).toMatchObject({
      action: {
        mode: 'template',
        templateId: template.id,
        subjectOverride: 'Our class: {{course_name}}',
        attachPdf: true,
        to: [
          { type: 'field', field: 'attendee_emails' },
          { type: 'literal', email: 'coordinator@example.com' },
        ],
      },
    })
    expect(next.nodes[1]?.data).not.toHaveProperty('action.bodyTemplate')
    expect(automationGraphSchema.safeParse(next).success).toBe(true)
  })

  it('preserves an existing customized body and never adds a duplicate manual flow', async () => {
    const graph = bookingGraph()
    const node = graph.nodes[1]!
    if (node.data.kind === 'action' && node.data.action.action === 'send_email')
      node.data.action.bodyTemplate = 'Bring your own lunch.'
    const { tx, values, set } = transaction([{ id: 'flow', graph }], false)
    expect(
      await seedTrainingClassBookingEmail(tx, 'tenant', { upgradeInlineFlows: true }),
    ).toMatchObject({ templateCreated: false, flowsChanged: 0 })
    expect(set).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledTimes(1)
  })

  it('is idempotent and preserves edits to saved native templates', async () => {
    const graph = bookingGraph()
    const node = graph.nodes[1]!
    if (node.data.kind === 'action' && node.data.action.action === 'send_email')
      node.data.action = { action: 'send_email', to: [], mode: 'template', templateId: template.id }
    const { tx, values, set } = transaction([{ id: 'flow', graph }], false)
    expect(
      await seedTrainingClassBookingEmail(tx, 'tenant', { upgradeInlineFlows: true }),
    ).toMatchObject({ templateCreated: false, flowsChanged: 0 })
    expect(set).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledTimes(1)
  })

  it('respects a disabled template instead of creating a flow that cannot deliver', async () => {
    const { tx, values } = transaction([], false, { ...template, isActive: false })
    expect(await seedTrainingClassBookingEmail(tx, 'tenant', { upgradeInlineFlows: true })).toEqual(
      { templateId: null, templateCreated: false, flowsChanged: 0 },
    )
    expect(values).toHaveBeenCalledTimes(1)
  })
})
