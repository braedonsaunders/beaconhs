'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Manager-only acknowledgments roster: who signed, when, which version, and
// whether it was individual or a group session. Signatures open as evidence —
// they are never shown as a thumbnail strip. Self-ack lives on /read.

import Link from 'next/link'
import { BadgeCheck, Users } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { SignatureEvidence } from './_signature-evidence'

export type AckRow = {
  ackId: string
  personId: string
  name: string
  acknowledgedAt: string
  version: number | null
  sessionId: string | null
  sessionTitle: string | null
  signatureUrl: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export function AcknowledgmentsPanel({
  documentId,
  signOffHref,
  readHref,
  acks,
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
  selfStatus,
  selfAckedAt,
  canManageSignOff,
}: {
  documentId: string
  signOffHref: string
  readHref: string
  acks: AckRow[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
  selfStatus: 'can' | 'acked' | 'unpublished' | 'no-person'
  selfAckedAt: string | null
  canManageSignOff: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const basePath = `/documents/${documentId}`

  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          selfStatus === 'unpublished' ? null : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/60">
              <GeneratedValue
                value={
                  selfStatus === 'acked' ? (
                    <p className="text-slate-700 dark:text-slate-200">
                      <GeneratedText id="m_0945deabe6292c" />
                      <GeneratedValue
                        value={
                          selfAckedAt ? (
                            <>
                              {' · '}
                              <GeneratedText id="m_03bc5bb7f90899" />{' '}
                              <GeneratedValue value={new Date(selfAckedAt).toLocaleString()} />.
                            </>
                          ) : null
                        }
                      />
                    </p>
                  ) : (
                    <p className="text-slate-700 dark:text-slate-200">
                      <GeneratedText id="m_1359a3381f80a2" />
                    </p>
                  )
                }
              />
              <Link href={readHref} className="mt-2 inline-block">
                <Button type="button" variant="outline" size="sm">
                  <GeneratedText id="m_0431e4b7409595" />
                </Button>
              </Link>
            </div>
          )
        }
      />

      <GeneratedValue
        value={
          canManageSignOff && selfStatus !== 'unpublished' ? (
            <Link href={signOffHref}>
              <Button type="button" variant="outline" className="w-full">
                <Users size={14} /> <GeneratedText id="m_017be457518ec5" />
              </Button>
            </Link>
          ) : null
        }
      />

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            <GeneratedText id="m_0664908f5b6c68" /> <GeneratedValue value={total} />
          </h3>
        </div>

        <TableToolbar className="mb-2">
          <SearchInput
            placeholder={tGenerated('m_159cbad753d749')}
            paramKey="ackQ"
            pageParamKey="ackPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="ackType"
            pageParamKey="ackPage"
            label={tGenerated('m_1d05fa7a091a9b')}
            options={[
              { value: 'individual', label: 'Individual' },
              { value: 'group', label: 'Group sign-off' },
            ]}
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="ackSort"
            pageParamKey="ackPage"
            label={tGenerated('m_126e942baf656b')}
            defaultValue="recent"
            hideAll
            options={[
              { value: 'recent', label: 'Most recent' },
              { value: 'name', label: 'Name' },
            ]}
          />
        </TableToolbar>

        <GeneratedValue
          value={
            acks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <GeneratedValue
                  value={
                    total === 0 ? (
                      <span className="flex flex-col items-center gap-1">
                        <BadgeCheck size={20} className="text-slate-300 dark:text-slate-600" />
                        <GeneratedText id="m_0ada9cc345ff47" />
                      </span>
                    ) : (
                      <GeneratedText id="m_1986fdeb7bd8d2" />
                    )
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                <GeneratedValue
                  value={acks.map((row) => (
                    <li key={row.ackId} className="flex items-center gap-3 py-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <GeneratedValue value={initials(row.name)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/people/${row.personId}`}
                          className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          <GeneratedValue value={row.name} />
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="text-xs text-slate-500 dark:text-slate-400"
                            title={tGeneratedValue(new Date(row.acknowledgedAt).toLocaleString())}
                          >
                            <GeneratedValue
                              value={new Date(row.acknowledgedAt).toLocaleDateString()}
                            />
                          </span>
                          <GeneratedValue
                            value={
                              row.version != null ? (
                                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                  <GeneratedText id="m_1c693e59d64fb2" />
                                  <GeneratedValue value={row.version} />
                                </Badge>
                              ) : null
                            }
                          />
                          <GeneratedValue
                            value={
                              row.sessionId ? (
                                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
                                  <Users size={9} />
                                  <GeneratedValue
                                    value={
                                      row.sessionTitle ? (
                                        row.sessionTitle
                                      ) : (
                                        <GeneratedText id="m_0d06af9d4c7f60" />
                                      )
                                    }
                                  />
                                </Badge>
                              ) : null
                            }
                          />
                        </div>
                      </div>
                      <SignatureEvidence name={row.name} signatureUrl={row.signatureUrl} />
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />

        <Pagination
          basePath={basePath}
          currentParams={currentParams}
          total={filteredTotal}
          page={page}
          perPage={perPage}
          pageParamKey="ackPage"
        />
      </div>
    </div>
  )
}
