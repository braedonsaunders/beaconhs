import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
vi.mock('server-only', () => ({}))
vi.mock('./flows/adapters/training-classes', () => ({
  createTrainingClassFlowAdapter: () => ({ loadValues: async () => ({ attendee_count: 2 }) }),
}))
import { assertClassEmailConfigured } from './training-class-email'
function ctx(trigger: string): RequestContext {
  return {
    db: vi.fn().mockResolvedValue([
      {
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: 'trigger',
              position: { x: 0, y: 0 },
              data: { kind: 'trigger', trigger: { trigger } },
            },
            {
              id: 'email',
              position: { x: 100, y: 0 },
              data: {
                kind: 'action',
                action: {
                  action: 'send_email',
                  mode: 'inline',
                  subject: 'Class',
                  bodyTemplate: 'Ready',
                  to: [{ type: 'field', field: 'attendee_emails' }],
                },
              },
            },
          ],
          edges: [{ id: 'edge', source: 'trigger', target: 'email', sourceHandle: 'next' }],
        },
      },
    ]),
  } as unknown as RequestContext
}
describe('class email configuration', () => {
  it('does not mistake an obsolete creation email for a manager send action', async () => {
    await expect(
      assertClassEmailConfigured(ctx('on_create'), 'class', 'class_confirmed'),
    ).rejects.toThrow('Configure an enabled Email class flow')
  })
  it('requires a separately configured reminder branch', async () => {
    await expect(
      assertClassEmailConfigured(ctx('class_confirmed'), 'class', 'class_reminder'),
    ).rejects.toThrow('Configure an enabled class reminder')
    await expect(
      assertClassEmailConfigured(ctx('class_reminder'), 'class', 'class_reminder'),
    ).resolves.toBeUndefined()
  })
  it('accepts a runnable manager email branch', async () => {
    await expect(
      assertClassEmailConfigured(ctx('class_confirmed'), 'class', 'class_confirmed'),
    ).resolves.toBeUndefined()
  })
})
