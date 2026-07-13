import assert from 'node:assert/strict'
import test from 'node:test'
import { httpDestination } from './destinations/http'
import { sqlDestination } from './destinations/sql'
import { summarizePriorDelivery } from './dispatch'
import { deliveryRef } from './idempotency'
import type { DeliverContext, DestinationTestContext } from './types'

const unusedDb = (() =>
  Promise.reject(
    new Error('database should not be called'),
  )) as unknown as DestinationTestContext['db']

test('HTTP destination connectivity checks reject non-HTTPS and private targets without egress', async () => {
  const base = { tenantId: 'tenant', db: unusedDb, secrets: {} }
  const insecure = await httpDestination.test?.({
    ...base,
    config: { url: 'http://example.com' },
  })
  assert.equal(insecure?.ok, false)
  assert.match(insecure?.error ?? '', /must use HTTPS/)

  const privateTarget = await httpDestination.test?.({
    ...base,
    config: { url: 'https://127.0.0.1/hook' },
  })
  assert.equal(privateTarget?.ok, false)
  assert.match(privateTarget?.error ?? '', /blocked non-public/)
})

test('HTTP destination resumes a known partial attempt without replaying successful items', async () => {
  const triggerKey = 'incident.created'
  const subjectId = '00000000-0000-4000-8000-000000000001'
  const ref = deliveryRef('http', triggerKey, subjectId, 0)
  const ctx: DeliverContext = {
    tenantId: 'tenant',
    db: unusedDb,
    config: {
      method: 'POST',
      url: 'https://127.0.0.1/this-must-not-be-requested',
    },
    secrets: {},
    triggerKey,
    subjectId,
    items: [{ reference: 'INC-1' }],
    mapping: {},
    priorRefs: [ref],
    retryRefs: [ref],
    oncePerRecord: false,
    log: () => {},
  }
  const result = await httpDestination.deliver(ctx)
  assert.equal(result.ok, true)
  assert.deepEqual(result.refs, [{ externalRef: ref }])
  assert.match(result.summary ?? '', /already succeeded/)
})

test('partial ledger refs remain retryable and only completed refs satisfy send-once', () => {
  assert.deepEqual(summarizePriorDelivery([{ externalRef: 'http:one', status: 'failed' }]), {
    refs: ['http:one'],
    retryRefs: ['http:one'],
    complete: false,
  })
  assert.deepEqual(summarizePriorDelivery([{ externalRef: 'http:one', status: 'pushed' }]), {
    refs: ['http:one'],
    retryRefs: [],
    complete: true,
  })
})

test('SQL destination requires an identity column before it can connect or insert', async () => {
  const result = await sqlDestination.deliver({
    tenantId: 'tenant',
    db: unusedDb,
    config: {
      dbKind: 'postgres',
      host: 'db.example.com',
      database: 'payroll',
      username: 'service',
      ssl: true,
    },
    secrets: { password: 'secret' },
    triggerKey: 'training.completed',
    subjectId: '00000000-0000-4000-8000-000000000001',
    items: [{ personId: 'person-1' }],
    mapping: { table: 'timesheet', columns: { person_id: '{{personId}}' } },
    priorRefs: [],
    retryRefs: [],
    oncePerRecord: false,
    log: () => {},
  })
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /identity column is required/)
})
