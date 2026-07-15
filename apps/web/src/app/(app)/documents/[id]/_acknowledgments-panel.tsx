'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The Acknowledgments tab body: a URL-driven, server-paged roster of everyone
// who has signed, the current user's self-acknowledge action (with an optional
// signature), and an entry point to the group sign-off sheet.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BadgeCheck, Check, PenLine, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Badge, Button, SignaturePad } from '@beaconhs/ui'
import { acknowledgeDocument } from './_ack-actions'
import { RawImage } from '@/components/raw-image'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'

export type AckRow = {
  ackId: string
  personId: string
  name: string
  acknowledgedAt: string // ISO
  sessionId: string | null
  sessionTitle: string | null
  signatureUrl: string | null
}

type SelfStatus = 'can' | 'acked' | 'unpublished' | 'no-person'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export function AcknowledgmentsPanel({
  documentId,
  versionId,
  signOffHref,
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
  versionId: string | null
  signOffHref: string
  acks: AckRow[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
  selfStatus: SelfStatus
  selfAckedAt: string | null
  /** Group sign-off is a documents.manage surface — hide the entry for readers. */
  canManageSignOff: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [sig, setSig] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const basePath = `/documents/${documentId}`

  function submitSelfAck() {
    if (!versionId) return
    startTransition(async () => {
      try {
        const res = await acknowledgeDocument({ documentId, signatureDataUrl: sig })
        if (!res.ok) {
          toast.error(tGeneratedValue(res.error))
          return
        }
        toast.success(tGenerated('m_16ab93413661d2'))
        setSig(null)
        router.refresh()
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_1d1fa19fb2f80d')),
        )
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Self-acknowledge */}
      <GeneratedValue
        value={
          selfStatus === 'acked' ? (
            <Alert variant="success">
              <Check size={16} />
              <AlertTitle>
                <GeneratedText id="m_0945deabe6292c" />
              </AlertTitle>
              <GeneratedValue
                value={
                  selfAckedAt ? (
                    <AlertDescription>
                      <GeneratedText id="m_03bc5bb7f90899" />{' '}
                      <GeneratedValue value={new Date(selfAckedAt).toLocaleString()} />.
                    </AlertDescription>
                  ) : null
                }
              />
            </Alert>
          ) : selfStatus === 'can' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                <GeneratedText id="m_1359a3381f80a2" />
              </p>
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <PenLine size={12} /> <GeneratedText id="m_0c0bc02db58371" />{' '}
                  <span className="font-normal">
                    <GeneratedText id="m_1f61ed87b795bd" />
                  </span>
                </div>
                <SignaturePad value={sig} onChange={setSig} height={120} />
              </div>
              <Button
                type="button"
                className="mt-3 w-full"
                onClick={submitSelfAck}
                disabled={pending}
              >
                <Check size={14} />{' '}
                <GeneratedValue
                  value={
                    pending ? (
                      <GeneratedText id="m_0d17b2ff9d6215" />
                    ) : (
                      <GeneratedText id="m_12ef6648f77371" />
                    )
                  }
                />
              </Button>
            </div>
          ) : selfStatus === 'unpublished' ? (
            <Alert variant="warning">
              <AlertTitle>
                <GeneratedText id="m_17f1cc7a464731" />
              </AlertTitle>
              <AlertDescription>
                <GeneratedText id="m_0034e77e69a315" />
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertTitle>
                <GeneratedText id="m_03a0cae28cdecf" />
              </AlertTitle>
              <AlertDescription>
                <GeneratedText id="m_17af6e2c8f7d2b" />
              </AlertDescription>
            </Alert>
          )
        }
      />

      {/* Group sign-off entry — the sign-off sheet is manage-only */}
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

      {/* Roster */}
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
                        <div className="flex items-center gap-1.5">
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
                      <GeneratedValue
                        value={
                          row.signatureUrl ? (
                            <RawImage
                              src={row.signatureUrl}
                              alt={tGenerated('m_017383099e620c', { value0: row.name })}
                              optimizationReason="authenticated"
                              className="h-8 w-16 shrink-0 rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                            />
                          ) : null
                        }
                      />
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
