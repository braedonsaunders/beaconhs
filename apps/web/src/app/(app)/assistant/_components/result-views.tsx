'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Rich, clickable renderings of read/search tool output. Each find_* / get_* /
// read_* tool returns structured rows; the model can't be trusted to hand-write
// correct links, so we render the results ourselves as interactive cards that
// deep-link into the matching record page (new tab, so the chat is preserved —
// matching the markdown renderer's link behavior).
//
// Two reusable widgets:
//   • DocumentResultList — the native "document card" list (find_documents)
//   • RecordLinkTable    — a generic linked table for any row set (incidents,
//                          corrective actions, training, people, open items)
// plus RecordLinkCard for single-record reads (get_*/read_document).

import { type ReactNode } from 'react'
import {
  ArrowUpRight,
  ClipboardCheck,
  ExternalLink,
  FileText,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'
import { DocumentPreviewCard, useDocumentReader, type DocRef } from './document-reader'

// ---------------------------------------------------------------------------
// Routes + formatting
// ---------------------------------------------------------------------------

const HREF = {
  document: (id: string) => `/documents/${id}`,
  incident: (id: string) => `/incidents/${id}`,
  correctiveAction: (id: string) => `/corrective-actions/${id}`,
  person: (id: string) => `/people/${id}`,
  trainingRecord: (id: string) => `/training/records/${id}`,
}

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'warning' | 'success'

function humanize(v: unknown): string {
  return typeof v === 'string' && v ? v.replace(/_/g, ' ') : ''
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Render a date-ish value (ISO timestamp or YYYY-MM-DD) as "15 Jul 2026".
 * Formatted from UTC parts with a fixed month table — deterministic across
 * server and client so it can't trigger a hydration mismatch on reload.
 */
function fmtDate(v: unknown): string {
  if (!v) return '—'
  const s = String(v)
  // Treat a bare date as UTC midnight so the calendar day never shifts by TZ.
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s)
  if (Number.isNaN(d.getTime())) return s
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function docStatusVariant(s: string): BadgeVariant {
  if (s === 'published') return 'success'
  if (s === 'under_review') return 'warning'
  if (s === 'archived') return 'outline'
  return 'secondary'
}
function incidentStatusVariant(s: string): BadgeVariant {
  if (s === 'closed') return 'success'
  if (s === 'under_investigation' || s === 'pending_review') return 'warning'
  if (s === 'reopened') return 'destructive'
  return 'secondary'
}
function caStatusVariant(s: string): BadgeVariant {
  if (s === 'closed') return 'success'
  if (s === 'cancelled') return 'outline'
  if (s === 'pending_verification') return 'warning'
  return 'secondary'
}
/** Shared severity scale for incidents + corrective actions. */
function severityVariant(s: string): BadgeVariant {
  if (s === 'critical' || s === 'fatality' || s === 'lost_time') return 'destructive'
  if (s === 'high' || s === 'medical_aid') return 'warning'
  if (s === 'medium' || s === 'first_aid_only') return 'secondary'
  return 'outline'
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Card shell wrapping a result widget. */
function ResultShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <GeneratedValue value={children} />
    </div>
  )
}

/** "Showing N of M" footer when a list was capped. */
function TruncationNote({
  data,
  noun,
}: {
  data: { truncated?: unknown; total?: unknown; returned?: unknown }
  noun: string
}) {
  if (!data?.truncated || typeof data.total !== 'number' || typeof data.returned !== 'number') {
    return null
  }
  return (
    <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
      <GeneratedText id="m_01d77276c22eb1" /> <GeneratedValue value={data.returned} />{' '}
      <GeneratedText id="m_00e704d1194796" /> <GeneratedValue value={data.total} />{' '}
      <GeneratedValue value={noun} />
      <GeneratedValue
        value={data.total === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
      />{' '}
      <GeneratedText id="m_144bc0201d12ef" />
    </div>
  )
}

type Column = { key: string; label: string; className?: string; primary?: boolean }
type LinkRow = { id: string; href: string; cells: Record<string, ReactNode> }

/**
 * Generic table where the primary column links into the record. Compact,
 * horizontally scrollable, dark-mode aware. Reusable for any row set.
 */
function RecordLinkTable({
  columns,
  rows,
  noun,
  data,
}: {
  columns: Column[]
  rows: LinkRow[]
  noun: string
  data?: { truncated?: unknown; total?: unknown; returned?: unknown }
}) {
  if (rows.length === 0) return null
  return (
    <ResultShell>
      <div className="app-scroll overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <GeneratedValue
                value={columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      'px-3 py-2 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-400 uppercase dark:text-slate-500',
                      c.className,
                    )}
                  >
                    <GeneratedValue value={c.label} />
                  </th>
                ))}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <GeneratedValue
              value={rows.map((r) => (
                <tr
                  key={r.id}
                  className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <GeneratedValue
                    value={columns.map((c) => (
                      <td key={c.key} className={cn('px-3 py-2 align-middle', c.className)}>
                        <GeneratedValue
                          value={
                            c.primary ? (
                              <a
                                href={r.href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 font-medium text-teal-700 hover:underline dark:text-teal-300"
                              >
                                <span className="truncate">
                                  <GeneratedValue
                                    value={
                                      r.cells[c.key] ?? <GeneratedText id="m_107ab58c3c38bc" />
                                    }
                                  />
                                </span>
                                <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                              </a>
                            ) : (
                              (r.cells[c.key] ?? <span className="text-slate-400">—</span>)
                            )
                          }
                        />
                      </td>
                    ))}
                  />
                </tr>
              ))}
            />
          </tbody>
        </table>
      </div>
      <GeneratedValue value={data ? <TruncationNote data={data} noun={noun} /> : null} />
    </ResultShell>
  )
}

/** Single-record "open this" card for the get_ and read_ tools. */
function RecordLinkCard({
  href,
  icon: Icon,
  kicker,
  title,
  badges,
}: {
  href: string
  icon: LucideIcon
  kicker: string
  title: string
  badges?: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800 dark:hover:bg-teal-950/20"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 group-hover:bg-teal-100 group-hover:text-teal-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-teal-950/50 dark:group-hover:text-teal-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
          <GeneratedValue value={kicker} />
        </span>
        <span className="block truncate font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
          <GeneratedValue value={title} />
        </span>
      </span>
      <GeneratedValue value={badges} />
      <ExternalLink className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-teal-500 dark:text-slate-600" />
    </a>
  )
}

// ---------------------------------------------------------------------------
// Native document card list (find_documents)
// ---------------------------------------------------------------------------

type DocItem = {
  id: string
  key?: string | null
  title?: string | null
  category?: string | null
  status?: string | null
}

/** The clickable area of a document card: opens the in-chat reader when a
 *  provider is mounted, else falls back to opening the full page in a new tab. */
function DocOpenArea({
  reader,
  docRef,
  className,
  children,
}: {
  reader: ReturnType<typeof useDocumentReader>
  docRef: DocRef
  className?: string
  children: ReactNode
}) {
  if (reader) {
    return (
      <button type="button" onClick={() => reader.open(docRef)} className={className}>
        <GeneratedValue value={children} />
      </button>
    )
  }
  return (
    <a href={HREF.document(docRef.id)} target="_blank" rel="noreferrer" className={className}>
      <GeneratedValue value={children} />
    </a>
  )
}

function DocumentResultList({
  data,
}: {
  data: { items?: DocItem[]; truncated?: unknown; total?: unknown; returned?: unknown }
}) {
  const tGenerated = useGeneratedTranslations()
  const reader = useDocumentReader()
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) return null
  return (
    <ResultShell>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        <GeneratedValue
          value={items.map((d) => (
            <li
              key={d.id}
              className="group flex items-start gap-2 px-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <DocOpenArea
                reader={reader}
                docRef={{ id: d.id, title: d.title, key: d.key, status: d.status }}
                className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-1.5 text-left"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 group-hover:bg-teal-100 group-hover:text-teal-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-teal-950/50 dark:group-hover:text-teal-300">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                      <GeneratedValue value={d.title || <GeneratedText id="m_1a144508deb533" />} />
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue
                      value={
                        d.key ? (
                          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {d.key}
                          </code>
                        ) : null
                      }
                    />
                    <GeneratedValue
                      value={
                        d.category ? (
                          <span className="truncate">
                            <GeneratedValue value={d.category} />
                          </span>
                        ) : null
                      }
                    />
                  </span>
                </span>
              </DocOpenArea>
              <div className="flex shrink-0 items-center gap-1 py-2.5 pr-1.5">
                <GeneratedValue
                  value={
                    d.status ? (
                      <Badge variant={docStatusVariant(d.status)} className="shrink-0">
                        <GeneratedValue value={humanize(d.status)} />
                      </Badge>
                    ) : null
                  }
                />
                <a
                  href={HREF.document(d.id)}
                  target="_blank"
                  rel="noreferrer"
                  title={tGenerated('m_1878b86755b421')}
                  aria-label={tGenerated('m_1878b86755b421')}
                  className="rounded p-1 text-slate-300 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </li>
          ))}
        />
      </ul>
      <TruncationNote data={data} noun="document" />
    </ResultShell>
  )
}

// ---------------------------------------------------------------------------
// Section heading (for multi-table results like list_my_open_items)
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
      <GeneratedValue value={children} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>
function rowsOf(data: unknown): AnyRow[] {
  const items = (data as { items?: unknown })?.items
  return Array.isArray(items) ? (items as AnyRow[]) : []
}
function str(v: unknown): string {
  return v == null ? '' : String(v)
}

/**
 * Map a successful tool output to a rich result widget, or null when the tool
 * has no visual treatment (the model's text speaks for it).
 */
export function ToolResultView({ name, output }: { name: string; output: unknown }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  if (!output || typeof output !== 'object') return null
  const o = output as { ok?: boolean; data?: unknown }
  if (o.ok === false) return null
  const data = (o.data ?? o) as Record<string, unknown>
  if (!data || typeof data !== 'object') return null

  switch (name) {
    case 'find_documents':
      return <DocumentResultList data={data as never} />

    case 'find_incidents': {
      const rows = rowsOf(data).map((r) => ({
        id: str(r.id),
        href: HREF.incident(str(r.id)),
        cells: {
          reference: str(r.reference) || 'Incident',
          title: str(r.title) || '—',
          status: r.status ? (
            <Badge variant={incidentStatusVariant(str(r.status))}>
              <GeneratedValue value={humanize(r.status)} />
            </Badge>
          ) : null,
          severity: r.severity ? (
            <Badge variant={severityVariant(str(r.severity))}>
              <GeneratedValue value={humanize(r.severity)} />
            </Badge>
          ) : null,
        },
      }))
      return (
        <RecordLinkTable
          noun="incident"
          data={data}
          rows={rows}
          columns={[
            { key: 'reference', label: 'Reference', primary: true },
            { key: 'title', label: 'Title', className: 'w-full max-w-0 truncate' },
            { key: 'status', label: 'Status', className: 'whitespace-nowrap' },
            { key: 'severity', label: 'Severity', className: 'whitespace-nowrap' },
          ]}
        />
      )
    }

    case 'find_corrective_actions': {
      const rows = rowsOf(data).map((r) => ({
        id: str(r.id),
        href: HREF.correctiveAction(str(r.id)),
        cells: {
          reference: str(r.reference) || 'Action',
          title: str(r.title) || '—',
          status: r.status ? (
            <Badge variant={caStatusVariant(str(r.status))}>
              <GeneratedValue value={humanize(r.status)} />
            </Badge>
          ) : null,
          severity: r.severity ? (
            <Badge variant={severityVariant(str(r.severity))}>
              <GeneratedValue value={humanize(r.severity)} />
            </Badge>
          ) : null,
          dueOn: r.dueOn ? fmtDate(r.dueOn) : '—',
        },
      }))
      return (
        <RecordLinkTable
          noun="corrective action"
          data={data}
          rows={rows}
          columns={[
            { key: 'reference', label: 'Reference', primary: true },
            { key: 'title', label: 'Title', className: 'w-full max-w-0 truncate' },
            { key: 'status', label: 'Status', className: 'whitespace-nowrap' },
            { key: 'severity', label: 'Severity', className: 'whitespace-nowrap' },
            { key: 'dueOn', label: 'Due', className: 'whitespace-nowrap' },
          ]}
        />
      )
    }

    case 'find_training_records': {
      const rows = rowsOf(data).map((r) => ({
        id: str(r.id),
        href: HREF.trainingRecord(str(r.id)),
        cells: {
          course: str(r.course) || 'Training record',
          person: str(r.person) || '—',
          completedOn: r.completedOn ? fmtDate(r.completedOn) : '—',
          expiresOn: r.expiresOn ? fmtDate(r.expiresOn) : '—',
        },
      }))
      return (
        <RecordLinkTable
          noun="training record"
          data={data}
          rows={rows}
          columns={[
            { key: 'course', label: 'Course', primary: true, className: 'w-full max-w-0 truncate' },
            { key: 'person', label: 'Person', className: 'whitespace-nowrap' },
            { key: 'completedOn', label: 'Completed', className: 'whitespace-nowrap' },
            { key: 'expiresOn', label: 'Expires', className: 'whitespace-nowrap' },
          ]}
        />
      )
    }

    case 'find_people': {
      const rows = rowsOf(data).map((r) => ({
        id: str(r.id),
        href: HREF.person(str(r.id)),
        cells: {
          name: str(r.name) || 'Person',
          employeeNo: str(r.employeeNo) || '—',
          jobTitle: str(r.jobTitle) || '—',
        },
      }))
      return (
        <RecordLinkTable
          noun="person"
          rows={rows}
          columns={[
            { key: 'name', label: 'Name', primary: true },
            { key: 'employeeNo', label: 'Emp #', className: 'whitespace-nowrap' },
            { key: 'jobTitle', label: 'Job title', className: 'w-full max-w-0 truncate' },
          ]}
        />
      )
    }

    case 'list_my_open_items': {
      const cas = Array.isArray(data.openCorrectiveActions)
        ? (data.openCorrectiveActions as AnyRow[])
        : []
      const training = Array.isArray(data.trainingExpiringSoon)
        ? (data.trainingExpiringSoon as AnyRow[])
        : []
      if (cas.length === 0 && training.length === 0) return null
      return (
        <div className="space-y-3">
          <GeneratedValue
            value={
              cas.length > 0 ? (
                <div className="space-y-1.5">
                  <SectionHeading>
                    <GeneratedText id="m_041ba3186b3b50" />
                  </SectionHeading>
                  <RecordLinkTable
                    noun="corrective action"
                    rows={cas.map((r) => ({
                      id: str(r.id),
                      href: HREF.correctiveAction(str(r.id)),
                      cells: {
                        reference: str(r.reference) || 'Action',
                        title: str(r.title) || '—',
                        status: r.status ? (
                          <Badge variant={caStatusVariant(str(r.status))}>
                            <GeneratedValue value={humanize(r.status)} />
                          </Badge>
                        ) : null,
                        dueOn: r.dueOn ? fmtDate(r.dueOn) : '—',
                      },
                    }))}
                    columns={[
                      { key: 'reference', label: 'Reference', primary: true },
                      { key: 'title', label: 'Title', className: 'w-full max-w-0 truncate' },
                      { key: 'status', label: 'Status', className: 'whitespace-nowrap' },
                      { key: 'dueOn', label: 'Due', className: 'whitespace-nowrap' },
                    ]}
                  />
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              training.length > 0 ? (
                <div className="space-y-1.5">
                  <SectionHeading>
                    <GeneratedText id="m_1e2b853b3124fa" />
                  </SectionHeading>
                  <RecordLinkTable
                    noun="training record"
                    rows={training.map((r) => ({
                      id: str(r.id),
                      href: HREF.trainingRecord(str(r.id)),
                      cells: {
                        course: str(r.course) || 'Training record',
                        expiresOn: r.expiresOn ? fmtDate(r.expiresOn) : '—',
                      },
                    }))}
                    columns={[
                      {
                        key: 'course',
                        label: 'Course',
                        primary: true,
                        className: 'w-full max-w-0 truncate',
                      },
                      { key: 'expiresOn', label: 'Expires', className: 'whitespace-nowrap' },
                    ]}
                  />
                </div>
              ) : null
            }
          />
        </div>
      )
    }

    case 'get_incident':
      return data.id ? (
        <RecordLinkCard
          href={HREF.incident(str(data.id))}
          icon={TriangleAlert}
          kicker={str(data.reference) || 'Incident'}
          title={tGeneratedValue(str(data.title) || tGenerated('m_08be8294ed6700'))}
          badges={
            data.status ? (
              <Badge variant={incidentStatusVariant(str(data.status))} className="shrink-0">
                <GeneratedValue value={humanize(data.status)} />
              </Badge>
            ) : null
          }
        />
      ) : null

    case 'get_corrective_action':
      return data.id ? (
        <RecordLinkCard
          href={HREF.correctiveAction(str(data.id))}
          icon={ClipboardCheck}
          kicker={str(data.reference) || 'Corrective action'}
          title={tGeneratedValue(str(data.title) || tGenerated('m_004f8059566564'))}
          badges={
            data.status ? (
              <Badge variant={caStatusVariant(str(data.status))} className="shrink-0">
                <GeneratedValue value={humanize(data.status)} />
              </Badge>
            ) : null
          }
        />
      ) : null

    case 'read_document':
      return data.id ? (
        <DocumentPreviewCard
          id={str(data.id)}
          title={tGeneratedValue(str(data.title) || tGenerated('m_18ce070374179f'))}
          docKey={data.key ? str(data.key) : null}
          status={data.status ? str(data.status) : null}
        />
      ) : null

    default:
      return null
  }
}
