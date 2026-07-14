import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FormResponseParentLockedError,
  FormResponseParentIntegrityError,
  hazardAssessmentParentId,
  lockFormResponseForMutation,
} from './form-response-parent-lock'
import type { Database } from './client'

function transactionWithSelectResults(...results: unknown[][]): {
  tx: Database
  terminalQueries: string[]
} {
  const terminalQueries: string[] = []
  let selection = 0
  const tx = {
    select() {
      const result = results[selection] ?? []
      const label = `select-${selection++}`
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = () => chain
      chain.limit = () => chain
      chain.for = () => {
        terminalQueries.push(`${label}:locked`)
        return Promise.resolve(result)
      }
      chain.then = (
        resolve: (value: unknown[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        terminalQueries.push(`${label}:read`)
        return Promise.resolve(result).then(resolve, reject)
      }
      return chain
    },
  } as unknown as Database
  return { tx, terminalQueries }
}

const response = {
  id: 'response-1',
  sourceEntityType: 'hazid_assessment',
  sourceEntityId: 'assessment-1',
}

describe('form-response parent locking', () => {
  it('recognizes only the canonical Hazard-assessment source link', () => {
    expect(
      hazardAssessmentParentId({ sourceEntityType: 'incident', sourceEntityId: 'incident-1' }),
    ).toBeNull()
    expect(
      hazardAssessmentParentId({
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: 'assessment-1',
      }),
    ).toBe('assessment-1')
  })

  it('fails closed when a Hazard response has no parent identifier', () => {
    expect(() =>
      hazardAssessmentParentId({
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: null,
      }),
    ).toThrow(FormResponseParentIntegrityError)
  })

  it('returns a locked response only after locking its unlocked parent first', async () => {
    const { tx, terminalQueries } = transactionWithSelectResults(
      [
        {
          sourceEntityType: response.sourceEntityType,
          sourceEntityId: response.sourceEntityId,
        },
      ],
      [{ locked: false }],
      [response],
    )

    await expect(lockFormResponseForMutation(tx, 'tenant-1', response.id)).resolves.toBe(response)
    expect(terminalQueries).toEqual(['select-0:read', 'select-1:locked', 'select-2:locked'])
  })

  it('rejects a locked or missing Hazard parent before touching the response lock', async () => {
    for (const [parentRows, errorType] of [
      [[{ locked: true }], FormResponseParentLockedError],
      [[], FormResponseParentIntegrityError],
    ] as const) {
      const { tx, terminalQueries } = transactionWithSelectResults(
        [
          {
            sourceEntityType: response.sourceEntityType,
            sourceEntityId: response.sourceEntityId,
          },
        ],
        [...parentRows],
        [response],
      )
      await expect(lockFormResponseForMutation(tx, 'tenant-1', response.id)).rejects.toBeInstanceOf(
        errorType,
      )
      expect(terminalQueries).toEqual(['select-0:read', 'select-1:locked'])
    }
  })

  it('fails closed when the source link changes between discovery and row lock', async () => {
    const { tx } = transactionWithSelectResults(
      [
        {
          sourceEntityType: response.sourceEntityType,
          sourceEntityId: response.sourceEntityId,
        },
      ],
      [{ locked: false }],
      [{ ...response, sourceEntityId: 'assessment-2' }],
    )
    await expect(lockFormResponseForMutation(tx, 'tenant-1', response.id)).rejects.toBeInstanceOf(
      FormResponseParentIntegrityError,
    )
  })

  it('locks standalone responses directly and returns null for missing rows', async () => {
    const standalone = { ...response, sourceEntityType: 'incident', sourceEntityId: 'incident-1' }
    const existing = transactionWithSelectResults(
      [
        {
          sourceEntityType: standalone.sourceEntityType,
          sourceEntityId: standalone.sourceEntityId,
        },
      ],
      [standalone],
    )
    await expect(lockFormResponseForMutation(existing.tx, 'tenant-1', standalone.id)).resolves.toBe(
      standalone,
    )
    expect(existing.terminalQueries).toEqual(['select-0:read', 'select-1:locked'])

    const missing = transactionWithSelectResults([])
    await expect(
      lockFormResponseForMutation(missing.tx, 'tenant-1', response.id),
    ).resolves.toBeNull()
    expect(missing.terminalQueries).toEqual(['select-0:read'])
  })

  it('locks parent before response and revalidates the discovered source', () => {
    const source = readFileSync(new URL('./form-response-parent-lock.ts', import.meta.url), 'utf8')
    const snapshot = source.indexOf('const [snapshot]')
    const parentLock = source.indexOf(".for('update')", snapshot)
    const responseSelect = source.indexOf('const [response]', parentLock)
    const responseLock = source.indexOf(".for('update')", responseSelect)
    const sourceRevalidation = source.indexOf(
      'response.sourceEntityType !== snapshot.sourceEntityType',
      responseLock,
    )

    expect(snapshot).toBeGreaterThanOrEqual(0)
    expect(parentLock).toBeGreaterThan(snapshot)
    expect(responseSelect).toBeGreaterThan(parentLock)
    expect(responseLock).toBeGreaterThan(responseSelect)
    expect(sourceRevalidation).toBeGreaterThan(responseLock)
    expect(source.match(/eq\(formResponses\.tenantId, tenantId\)/gu)).toHaveLength(2)
    expect(source).toContain('eq(hazidAssessments.tenantId, tenantId)')
    expect(source).toContain('isNull(hazidAssessments.deletedAt)')
  })
})
