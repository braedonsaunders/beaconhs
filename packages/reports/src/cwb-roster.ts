import type { ReportCustomQuery, ReportRunResult } from '@braedonsaunders/appkit-reports'

/** The CWB roster remains an ordinary editable report query. */
export function isCwbRoster(query: ReportCustomQuery): boolean {
  return (
    query.entity === 'skill_assignments' &&
    query.mode === 'rows' &&
    ['cwb_type', 'cwb_process', 'cwb_position', 'cwb_level', 'shop_field_layoff'].every((key) =>
      query.columns.includes(key),
    ) &&
    query.filters?.combinator === 'and' &&
    query.filters.rules.some(
      (rule) =>
        'field' in rule &&
        rule.field === 'authority_code' &&
        rule.op === 'eq' &&
        rule.value === 'CWB',
    )
  )
}

/** Native report groups, shared by preview, export and scheduled delivery. */
export function cwbRosterResult(
  result: ReportRunResult,
  company: { name: string; address: string; accountNumber: string },
  printedAt = new Date(),
): ReportRunResult {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    month: '2-digit',
  }).format(printedAt)
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
  }).format(printedAt)
  const codes = company.accountNumber.split(',').map((code) => code.trim())
  const groups = result.groups.flatMap((group) => {
    const standard = group.title
    const account =
      standard === 'W47.2'
        ? (codes[1] ?? codes[0])
        : standard === 'W186'
          ? (codes[2] ?? codes[0])
          : codes[0]
    const employed = new Set(group.rows.map((row) => row.person_name)).size
    return [
      {
        ...group,
        title: `Qualification — ${standard}`,
        subtitle: `Company code: ${account ?? ''} · Standard: ${standard} · Total # of welders employed: ${employed} · Month: ${month} · Year: ${year}`,
        columns: [
          { key: 'row_number', label: 'No.', semanticType: 'number' as const },
          ...group.columns.map((column) => ({
            ...column,
            label:
              column.key === 'cwb_position'
                ? 'Position'
                : column.key === 'cwb_level'
                  ? 'Level'
                  : column.key === 'expires_on'
                    ? 'Expiry'
                    : column.key === 'shop_field_layoff'
                      ? 'S / F / L'
                      : column.label,
          })),
        ],
        rows: group.rows.map((row, index) => ({ ...row, row_number: index + 1 })),
      },
      {
        kind: 'section' as const,
        title: 'Monthly report',
        columns: [
          { key: 'note', label: 'Note', semanticType: 'category' as const },
          {
            key: 'signature',
            label: 'Welding Supervisor’s Signature',
            semanticType: 'category' as const,
          },
        ],
        rows: [
          {
            note: 'Complete monthly and retain in your file for review by a CWB representative during visits and audits.',
            signature: '________________________________',
          },
        ],
      },
    ]
  })
  const instructions =
    'Type: W (Welder), O (Operator), T (Tack Welder), P (Probationary Welder). Process: show each qualification on its own line. Position / Class / Category: F (Flat), H (Horizontal), V (Vertical), VD (Vertical Down), O (Overhead). Level I, II or III applies to W47.2 only. Show qualification expiry and qualifying authority; S = Shop, F = Field, L = Layoff.'
  return {
    ...result,
    summary: [],
    groups: [
      {
        kind: 'section',
        title: 'Canadian Welding Bureau — Division of CWB Group, Industry Services',
        columns: [
          { key: 'company', label: 'Company Name', semanticType: 'category' },
          { key: 'form', label: 'Form', semanticType: 'category' },
        ],
        rows: [{ company: company.name.toUpperCase(), form: 'CWB Form 108E/2002-1' }],
      },
      {
        kind: 'section',
        title: 'Report of Welders, Welding Operators, Tack Welders',
        columns: [{ key: 'address', label: 'Address', semanticType: 'category' }],
        rows: [{ address: company.address.toUpperCase() }],
      },
      {
        kind: 'section',
        title: 'Qualification key',
        columns: [{ key: 'instructions', label: 'Instructions', semanticType: 'category' }],
        rows: [{ instructions }],
      },
      ...groups,
    ],
  }
}
