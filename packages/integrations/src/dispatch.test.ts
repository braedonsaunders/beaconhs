import assert from 'node:assert/strict'
import test from 'node:test'
import { needsFailureRecord, summarizePriorDelivery } from './dispatch'

test('a delivery that failed before creating anything needs its own failure record', () => {
  assert.equal(needsFailureRecord({ ok: false, error: 'self-signed certificate' }), true)
  assert.equal(needsFailureRecord({ ok: false, error: 'connect failed', refs: [] }), true)
})

test('deliveries with refs (or successes) do not need a separate failure record', () => {
  assert.equal(
    needsFailureRecord({ ok: false, refs: [{ externalRef: '42' }], error: 'partial' }),
    false,
  )
  assert.equal(needsFailureRecord({ ok: true, refs: [] }), false)
  assert.equal(needsFailureRecord({ ok: true }), false)
})

test('a no-ref failure row keeps a subject incomplete without inventing refs', () => {
  assert.deepEqual(summarizePriorDelivery([{ externalRef: null, status: 'failed' }]), {
    refs: [],
    retryRefs: [],
    complete: false,
  })
  // Prior pushed refs survive a later no-ref failure so a retry can reverse.
  assert.deepEqual(
    summarizePriorDelivery([
      { externalRef: '42', status: 'pushed' },
      { externalRef: null, status: 'failed' },
    ]),
    { refs: ['42'], retryRefs: [], complete: false },
  )
})
