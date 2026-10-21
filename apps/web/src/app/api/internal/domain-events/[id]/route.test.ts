import { beforeEach, describe, expect, it, vi } from 'vitest'
import { domainEventOutbox, tenants, users, type DomainEventActor } from '@beaconhs/db/schema'

const state = vi.hoisted(() => ({
  signed: true,
  status: 'publishing',
  accountExists: true,
  actor: {} as DomainEventActor,
  execute: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
}))
vi.mock('@beaconhs/events', () => ({ verifyDomainEventRequest: () => state.signed }))
vi.mock('@beaconhs/db', () => ({
  db: {},
  withSuperAdmin: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) =>
    run({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === domainEventOutbox)
                return [
                  {
                    id: ID,
                    tenantId: TENANT,
                    status: state.status,
                    payload: {
                      web: {
                        kind: 'module_flow',
                        moduleKey: 'hazid',
                        event: 'on_create',
                        subjectId: SUBJECT,
                        actor: state.actor,
                      },
                    },
                  },
                ]
              if (table === users) return state.accountExists ? [{ id: state.actor.userId }] : []
              if (table === tenants) return [{ defaultLanguage: 'en', enabledLanguages: ['en'] }]
              return []
            },
          }),
        }),
      }),
    }),
}))
vi.mock('@beaconhs/tenant', () => ({
  makeTenantContext: (_db: unknown, actor: Record<string, unknown>) => ({
    ...actor,
    db: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ update: () => ({ set: () => ({ where: state.update }) }) }),
  }),
}))
vi.mock('@/app/(app)/apps/_lib/recap-email', () => ({ sendFormResponseRecapEmail: vi.fn() }))
vi.mock('@/app/(app)/apps/_lib/run-automations', () => ({
  runOnSubmitAutomations: vi.fn(),
  runStatusChangeAutomations: vi.fn(),
}))
vi.mock('@/lib/flows/run-module-flows', () => ({ executeModuleFlowsNow: state.execute }))
vi.mock('@/lib/flows/resume-flow-gate', () => ({ resumeFlowGateNow: vi.fn() }))

import { POST } from './route'

const ID = '10000000-0000-4000-8000-000000000001'
const TENANT = '20000000-0000-4000-8000-000000000001'
const SUBJECT = '30000000-0000-4000-8000-000000000001'
const request = () =>
  POST(new Request('http://localhost/api/internal/domain-events/' + ID, { method: 'POST' }), {
    params: Promise.resolve({ id: ID }),
  })

beforeEach(() => {
  state.signed = true
  state.status = 'publishing'
  state.accountExists = true
  state.actor = {
    userId: 'validTextAccountId0123456789012345',
    membershipId: null,
    personId: null,
    timezone: 'America/Toronto',
  }
  state.execute.mockClear()
  state.update.mockClear()
})

describe('signed domain command account identity and cancellation', () => {
  it.each(['validTextAccountId0123456789012345', '40000000-0000-4000-8000-000000000001'])(
    'accepts an existing text account ID: %s',
    async (id) => {
      state.actor.userId = id
      expect((await request()).status).toBe(200)
      expect(state.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: id, tenantId: TENANT }),
        expect.objectContaining({ subjectId: SUBJECT }),
        ID,
      )
      expect(state.update).toHaveBeenCalledOnce()
    },
  )
  it('rejects an unknown account without executing a flow', async () => {
    state.accountExists = false
    expect((await request()).status).toBe(422)
    expect(state.execute).not.toHaveBeenCalled()
  })
  it.each(['pending', 'cancelled'])('does not execute a %s event', async (status) => {
    state.status = status
    expect((await request()).status).toBe(409)
    expect(state.execute).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })
  it('still requires a signed request', async () => {
    state.signed = false
    expect((await request()).status).toBe(401)
    expect(state.execute).not.toHaveBeenCalled()
  })
  it.each(['membershipId', 'personId'] as const)('still requires a UUID for %s', async (field) => {
    state.actor[field] = 'invalid'
    expect((await request()).status).toBe(422)
    expect(state.execute).not.toHaveBeenCalled()
  })
  it('rejects an empty account ID', async () => {
    state.actor.userId = ' '
    expect((await request()).status).toBe(422)
    expect(state.execute).not.toHaveBeenCalled()
  })
})
