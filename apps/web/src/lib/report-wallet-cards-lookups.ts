import type { ReportRunResult } from '@beaconhs/reports'

export const WALLET_CARD_REPORT_ENTITIES = new Set(['training_matrix', 'training_records'])
export const MAX_REPORT_WALLET_CARDS = 200

export function reportSupportsWalletCards(entity: string): boolean {
  return WALLET_CARD_REPORT_ENTITIES.has(entity)
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value == null ? '' : String(value).trim()
}

export type WalletCardLookup = {
  employeeNo: string
  courseCode: string
  personName: string
  courseName: string
}

export function walletCardLookupsFromResult(result: ReportRunResult): WalletCardLookup[] {
  const seen = new Set<string>()
  const pairs: WalletCardLookup[] = []
  for (const group of result.groups) {
    for (const row of group.rows) {
      const lookup: WalletCardLookup = {
        employeeNo: cell(row, 'employee_no'),
        courseCode: cell(row, 'course_code'),
        personName: cell(row, 'person_name') || cell(row, 'person_id'),
        courseName: cell(row, 'course_name') || cell(row, 'course_id'),
      }
      if (!lookup.employeeNo && !lookup.personName) continue
      if (!lookup.courseCode && !lookup.courseName) continue
      const key = `${lookup.employeeNo}|${lookup.personName}|${lookup.courseCode}|${lookup.courseName}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(lookup)
    }
  }
  return pairs
}

export function parseWalletCardPersonName(
  value: string,
): { lastName: string; firstName: string } | null {
  const [lastName, firstName] = value.split(',').map((part) => part.trim())
  return lastName && firstName ? { lastName, firstName } : null
}
