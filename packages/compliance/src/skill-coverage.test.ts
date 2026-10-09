import { describe, expect, it } from 'vitest'
import { currentSkillTickets, skillStanding, type SkillTicket } from './skill-coverage'

const ticket = (id: string, changes: Partial<SkillTicket> = {}): SkillTicket => ({
  id,
  personId: 'person',
  skillTypeId: 'skill',
  status: 'complete',
  grantedOn: '2026-01-01',
  expiresOn: '2026-12-31',
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
  ...changes,
})

describe('current skill qualification', () => {
  it('a replacement hides the old expired ticket, regardless of input order', () => {
    const old = ticket('old', { expiresOn: '2025-12-31' })
    const renewed = ticket('renewed')
    expect(currentSkillTickets([old, renewed]).map((t) => t.id)).toEqual(['renewed'])
    expect(currentSkillTickets([renewed, old]).map((t) => t.id)).toEqual(['renewed'])
  })
  it('failed, unfinished, and revoked attempts do not displace valid evidence', () => {
    expect(
      currentSkillTickets([
        ticket('valid'),
        ticket('failed', { status: 'failed', grantedOn: '2026-09-01' }),
        ticket('revoked', { expiresOn: null, deletedAt: new Date() }),
      ]).map((t) => t.id),
    ).toEqual(['valid'])
  })
  it('unlimited evidence wins and each skill is distinct', () => {
    expect(
      currentSkillTickets([
        ticket('dated'),
        ticket('unlimited', { expiresOn: null }),
        ticket('second', { skillTypeId: 'other' }),
      ])
        .map((t) => t.id)
        .sort(),
    ).toEqual(['second', 'unlimited'])
  })
  it('expiry is inclusive and outcomes are not qualifications', () => {
    expect(skillStanding(ticket('one', { expiresOn: '2026-10-09' }), '2026-10-09')).toBe('expiring')
    expect(skillStanding(ticket('one', { expiresOn: '2026-10-08' }), '2026-10-09')).toBe('expired')
    expect(skillStanding(ticket('one', { status: 'failed', expiresOn: null }), '2026-10-09')).toBe(
      'missing',
    )
  })
})
