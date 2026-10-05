import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import {
  canCreateJournal,
  canEmailJournal,
  canMutateJournalEntry,
  journalMutationScope,
} from './_mutation-policy'

function context(permissions: string[] = [], isSuperAdmin = false): RequestContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    isSuperAdmin,
    timezone: 'America/Toronto',
    locale: 'en',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    localeOverride: null,
    membership: { id: 'membership-1', displayName: 'Test User' },
    personId: 'person-1',
    permissions: new Set(permissions),
    scopes: [{ type: 'tenant' }],
    db: async () => {
      throw new Error('Database access is not expected in a policy unit test')
    },
  }
}

describe('journal mutation policy', () => {
  it('does not let broad read access widen update-own', () => {
    const ctx = context(['journals.read.all', 'journals.update.own'])
    expect(journalMutationScope(ctx, 'edit')).toBe('self')
    expect(journalMutationScope(ctx, 'submit')).toBe('none')
  })

  it('uses assign as the explicit cross-author mutation permission', () => {
    const ctx = context(['journals.read.site', 'journals.assign'])
    expect(journalMutationScope(ctx, 'edit')).toBe('read_scope')
    expect(journalMutationScope(ctx, 'submit')).toBe('read_scope')
  })

  it('keeps create, submit/email, and edit permissions distinct', () => {
    const creator = context(['journals.create'])
    const submitter = context(['journals.submit'])
    expect(canCreateJournal(creator)).toBe(true)
    expect(journalMutationScope(creator, 'edit')).toBe('none')
    expect(canEmailJournal(creator)).toBe(false)
    expect(journalMutationScope(submitter, 'submit')).toBe('self')
    expect(canEmailJournal(submitter)).toBe(true)
  })

  it('allows super-admins through the explicit administrative scope', () => {
    const ctx = context([], true)
    expect(canCreateJournal(ctx)).toBe(true)
    expect(canEmailJournal(ctx)).toBe(true)
    expect(journalMutationScope(ctx, 'edit')).toBe('read_scope')
  })
})

describe('journal action control permissions', () => {
  const other = { personId: 'other-person', createdByTenantUserId: 'other-membership' }
  it('keeps a reviewer from seeing Submit on someone else’s draft', () => {
    const ctx = context(['journals.read.all', 'journals.submit'])
    expect(canMutateJournalEntry(ctx, 'submit', 'person-1', other)).toBe(false)
    expect(
      canMutateJournalEntry(ctx, 'submit', 'person-1', { ...other, personId: 'person-1' }),
    ).toBe(true)
    expect(
      canMutateJournalEntry(ctx, 'submit', null, {
        ...other,
        createdByTenantUserId: 'membership-1',
      }),
    ).toBe(true)
  })
  it('requires submit permission separately from editing and refuses missing identities', () => {
    const ctx = context(['journals.update.own'])
    const own = { personId: 'person-1', createdByTenantUserId: 'membership-1' }
    expect(canMutateJournalEntry(ctx, 'edit', 'person-1', own)).toBe(true)
    expect(canMutateJournalEntry(ctx, 'submit', 'person-1', own)).toBe(false)
    expect(
      canMutateJournalEntry({ ...context(['journals.submit']), membership: null }, 'submit', null, {
        personId: null,
        createdByTenantUserId: null,
      }),
    ).toBe(false)
    expect(canMutateJournalEntry(context(['journals.assign']), 'submit', 'person-1', other)).toBe(
      true,
    )
  })
})
