import { describe, expect, it } from 'vitest'
import { normalizeNotifyJobData } from './queues/notify'
import { assertOutboundDispatchJob } from './queues/outbound'
import { assertPdfJobData } from './queues/pdf'
import { assertPushJobData } from './queues/push'
import { assertReportRunJobData } from './queues/reports'
import { assertScheduledTick } from './queues/scheduled'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_ID = '20000000-0000-4000-8000-000000000001'

describe('queue payload validation', () => {
  it('normalizes notification recipients and rejects unsafe or oversized data', () => {
    expect(
      normalizeNotifyJobData({
        tenantId: TENANT_ID,
        userIds: [' user-one ', 'user-one', 'user-two'],
        category: 'incident',
        type: 'incident.created',
        title: 'Incident created',
        linkPath: '/incidents/one',
      }).userIds,
    ).toEqual(['user-one', 'user-two'])
    expect(() =>
      normalizeNotifyJobData({
        tenantId: TENANT_ID,
        userIds: ['user-one'],
        category: 'incident',
        type: 'incident.created',
        title: 'Incident created',
        linkPath: 'https://attacker.example',
      }),
    ).toThrow(/app-relative/)
    expect(() =>
      normalizeNotifyJobData({
        tenantId: TENANT_ID,
        userIds: ['user-one'],
        category: 'incident',
        type: 'incident.created',
        title: 'Incident created',
        data: { large: 'x'.repeat(70_000) },
      }),
    ).toThrow(/serialized bytes/)
  })

  it('binds outbound payload identity and size to its dispatch', () => {
    expect(() =>
      assertOutboundDispatchJob({
        tenantId: TENANT_ID,
        automationId: OTHER_ID,
        event: { type: 'incident.created', tenantId: OTHER_ID, subjectId: OTHER_ID, items: [] },
      }),
    ).toThrow(/identity/)
  })

  it('validates durable ids on push, report, and scheduled work', () => {
    expect(() =>
      assertPushJobData({
        tenantId: TENANT_ID,
        userId: 'user-one',
        subscriptionId: 'not-a-uuid',
        title: 'Alert',
      }),
    ).toThrow(/subscriptionId/)
    expect(() =>
      assertReportRunJobData({ tenantId: TENANT_ID, scheduleId: OTHER_ID, runId: 'bad' }),
    ).toThrow(/runId/)
    expect(() =>
      assertScheduledTick({
        kind: 'sync_run',
        tenantId: TENANT_ID,
        connectionId: 'bad',
        trigger: 'manual',
      }),
    ).toThrow(/connectionId/)
  })

  it('binds durable PDF targets and bounds render payloads', () => {
    expect(() =>
      assertPdfJobData({
        kind: 'record_summary',
        tenantId: TENANT_ID,
        subjectId: OTHER_ID,
        entityType: 'form_response',
        heading: 'Form response',
        fields: [],
        artifactTarget: { kind: 'form_response', responseId: OTHER_ID },
      }),
    ).not.toThrow()
    expect(() =>
      assertPdfJobData({
        kind: 'record_summary',
        tenantId: TENANT_ID,
        subjectId: OTHER_ID,
        entityType: 'form_response',
        heading: 'Form response',
        fields: [],
        artifactTarget: { kind: 'form_response', responseId: TENANT_ID },
      }),
    ).toThrow(/identity/)
    expect(() =>
      assertPdfJobData({
        kind: 'template_pdf',
        tenantId: TENANT_ID,
        html: 'x'.repeat(2 * 1024 * 1024 + 1),
        paperSize: 'letter',
        orientation: 'portrait',
        marginMm: 12,
        entityType: 'form_response',
        entityId: OTHER_ID,
      }),
    ).toThrow(/too large|exceeds/)
  })
})
