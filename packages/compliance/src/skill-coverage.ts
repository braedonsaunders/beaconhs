export type SkillOutcome = 'draft' | 'expired' | 'complete' | 'tested' | 'recommended' | 'failed'
export type SkillStanding = 'valid' | 'expiring' | 'expired' | 'missing'
export type SkillTicket = {
  id: string
  personId: string | null
  skillTypeId: string | null
  status: SkillOutcome
  grantedOn: string
  expiresOn: string | null
  createdAt: Date
  deletedAt: Date | null
}

export function skillStanding(
  ticket: Pick<SkillTicket, 'status' | 'expiresOn'> | null,
  today: string,
  warningDays = 90,
): SkillStanding {
  if (!ticket) return 'missing'
  if (ticket.status === 'expired') return 'expired'
  if (ticket.status !== 'complete') return 'missing'
  if (!ticket.expiresOn) return 'valid'
  if (ticket.expiresOn < today) return 'expired'
  const warning = new Date(`${today}T00:00:00Z`)
  warning.setUTCDate(warning.getUTCDate() + warningDays)
  return ticket.expiresOn <= warning.toISOString().slice(0, 10) ? 'expiring' : 'valid'
}

/** Qualification evidence outranks unfinished/failed attempts. Within completed
 * qualifications, no expiry and then furthest expiry win, matching compliance. */
export function currentSkillTickets<T extends SkillTicket>(tickets: readonly T[]): T[] {
  const rank = (t: T) => (t.status === 'complete' ? 0 : t.status === 'expired' ? 1 : 2)
  const ordered = tickets
    .filter((t) => !t.deletedAt && t.personId && t.skillTypeId)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 0
          ? (b.expiresOn ?? '9999-12-31').localeCompare(a.expiresOn ?? '9999-12-31')
          : 0) ||
        b.grantedOn.localeCompare(a.grantedOn) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )
  const seen = new Set<string>()
  return ordered.filter((t) => {
    const key = `${t.personId}:${t.skillTypeId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
