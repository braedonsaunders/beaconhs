import { describe, expect, it } from 'vitest'
import {
  isForeignKeyViolation,
  isUniqueViolation,
  pgError,
  pgErrorCode,
  safeDbErrorMessage,
} from './pg-error'

/** Shape drizzle-orm produces: wrapper message + PostgresError on `cause`. */
function drizzleWrapped(cause: unknown): Error {
  const error = new Error(
    'Failed query: insert into "ppe_items" ("id", "tenant_id") values ($1,$2)',
  )
  error.name = 'DrizzleQueryError'
  ;(error as Error & { cause?: unknown }).cause = cause
  return error
}

const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
  code: '23505',
  constraint_name: 'ppe_items_tenant_serial_ux',
  table_name: 'ppe_items',
  detail: 'Key (tenant_id, serial_number)=(…, E30047) already exists.',
})

describe('pgError', () => {
  it('reads the code through the drizzle wrapper', () => {
    expect(pgErrorCode(drizzleWrapped(uniqueViolation))).toBe('23505')
    expect(pgError(drizzleWrapped(uniqueViolation))?.constraint).toBe('ppe_items_tenant_serial_ux')
  })

  it('still reads a bare postgres error', () => {
    expect(pgErrorCode(uniqueViolation)).toBe('23505')
  })

  it('accepts the legacy `constraint` spelling', () => {
    expect(pgError({ code: '23505', constraint: 'documents_tenant_key_live_ux' })?.constraint).toBe(
      'documents_tenant_key_live_ux',
    )
  })

  it('ignores non-Postgres errors', () => {
    expect(pgErrorCode(new Error('boom'))).toBeNull()
    expect(pgErrorCode({ code: 'MODULE_NOT_FOUND' })).toBeNull()
    expect(pgErrorCode({ code: 'ENOENT' })).toBeNull()
    expect(pgErrorCode(null)).toBeNull()
    expect(pgErrorCode(undefined)).toBeNull()
  })

  it('terminates on a self-referential cause chain', () => {
    const looped = new Error('looped') as Error & { cause?: unknown }
    looped.cause = looped
    expect(pgErrorCode(looped)).toBeNull()
  })
})

describe('isUniqueViolation', () => {
  it('matches with and without a constraint filter', () => {
    const wrapped = drizzleWrapped(uniqueViolation)
    expect(isUniqueViolation(wrapped)).toBe(true)
    expect(isUniqueViolation(wrapped, 'ppe_items_tenant_serial_ux')).toBe(true)
    expect(isUniqueViolation(wrapped, 'some_other_ux')).toBe(false)
  })

  it('does not match other SQLSTATEs', () => {
    expect(isUniqueViolation(drizzleWrapped({ code: '23503' }))).toBe(false)
    expect(isForeignKeyViolation(drizzleWrapped({ code: '23503' }))).toBe(true)
  })
})

describe('safeDbErrorMessage', () => {
  it('never leaks the raw failed-query dump', () => {
    expect(safeDbErrorMessage(drizzleWrapped(uniqueViolation), 'Could not save.')).toBe(
      'Could not save.',
    )
    expect(safeDbErrorMessage(new Error('Failed query: select 1'), 'Could not save.')).toBe(
      'Could not save.',
    )
  })

  it('passes through a deliberate application error', () => {
    expect(safeDbErrorMessage(new Error('Active holder not found.'), 'Could not save.')).toBe(
      'Active holder not found.',
    )
  })
})
