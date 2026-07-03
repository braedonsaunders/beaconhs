'use client'

// The Acknowledgments tab body: a searchable / sortable / paginated roster of
// everyone who has signed, the current user's self-acknowledge action (with an
// optional signature), and an entry point to the group sign-off sheet. Acks per
// document are bounded, so filtering/sorting/paging happen in-component for an
// instant feel with no cross-tab URL-param juggling.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowDownUp,
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Search,
  Users,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  SignaturePad,
} from '@beaconhs/ui'
import { acknowledgeDocument } from './_ack-actions'
import { uploadSignatureDataUrl } from '@/lib/upload-signature'

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
type SortKey = 'recent' | 'name'

const PER_PAGE = 12

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
  selfStatus,
  selfAckedAt,
  canManageSignOff,
}: {
  documentId: string
  versionId: string | null
  signOffHref: string
  acks: AckRow[]
  selfStatus: SelfStatus
  selfAckedAt: string | null
  /** Group sign-off is a documents.manage surface — hide the entry for readers. */
  canManageSignOff: boolean
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [page, setPage] = useState(1)
  const [sig, setSig] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const rows = term ? acks.filter((a) => a.name.toLowerCase().includes(term)) : acks.slice()
    rows.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : b.acknowledgedAt.localeCompare(a.acknowledgedAt),
    )
    return rows
  }, [acks, q, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = Math.min(page, pageCount)
  const pageRows = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)

  function submitSelfAck() {
    if (!versionId) return
    startTransition(async () => {
      try {
        const signatureAttachmentId = sig ? await uploadSignatureDataUrl(sig) : null
        const res = await acknowledgeDocument({ documentId, signatureAttachmentId })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success('Document acknowledged')
        setSig(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not acknowledge')
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Self-acknowledge */}
      {selfStatus === 'acked' ? (
        <Alert variant="success">
          <Check size={16} />
          <AlertTitle>You've acknowledged this</AlertTitle>
          {selfAckedAt ? (
            <AlertDescription>Recorded {new Date(selfAckedAt).toLocaleString()}.</AlertDescription>
          ) : null}
        </Alert>
      ) : selfStatus === 'can' ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            By acknowledging you confirm you've read and understood this document.
          </p>
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <PenLine size={12} /> Signature <span className="font-normal">(optional)</span>
            </div>
            <SignaturePad value={sig} onChange={setSig} height={120} />
          </div>
          <Button type="button" className="mt-3 w-full" onClick={submitSelfAck} disabled={pending}>
            <Check size={14} /> {pending ? 'Acknowledging…' : 'Acknowledge'}
          </Button>
        </div>
      ) : selfStatus === 'unpublished' ? (
        <Alert variant="warning">
          <AlertTitle>Not yet published</AlertTitle>
          <AlertDescription>
            Publish a version before users can acknowledge this document.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <AlertTitle>Account not linked to a person</AlertTitle>
          <AlertDescription>
            Acknowledgments require a person record in the directory.
          </AlertDescription>
        </Alert>
      )}

      {/* Group sign-off entry — the sign-off sheet is manage-only */}
      {canManageSignOff && selfStatus !== 'unpublished' ? (
        <Link href={signOffHref}>
          <Button type="button" variant="outline" className="w-full">
            <Users size={14} /> Record group sign-off
          </Button>
        </Link>
      ) : null}

      {/* Roster */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Signed by {acks.length}
          </h3>
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Toggle sort"
          >
            <ArrowDownUp size={12} /> {sort === 'recent' ? 'Most recent' : 'Name'}
          </button>
        </div>

        {acks.length > 6 ? (
          <div className="relative mb-2">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="Search people…"
              className="pl-8"
            />
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {acks.length === 0 ? (
              <span className="flex flex-col items-center gap-1">
                <BadgeCheck size={20} className="text-slate-300 dark:text-slate-600" />
                No acknowledgments yet
              </span>
            ) : (
              'No people match your search.'
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {pageRows.map((row) => (
              <li key={row.ackId} className="flex items-center gap-3 py-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {initials(row.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/people/${row.personId}`}
                    className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {row.name}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-xs text-slate-500 dark:text-slate-400"
                      title={new Date(row.acknowledgedAt).toLocaleString()}
                    >
                      {new Date(row.acknowledgedAt).toLocaleDateString()}
                    </span>
                    {row.sessionId ? (
                      <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
                        <Users size={9} />
                        {row.sessionTitle ? row.sessionTitle : 'Group'}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {row.signatureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.signatureUrl}
                    alt={`${row.name} signature`}
                    className="h-8 w-16 shrink-0 rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              Page {current} of {pageCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="rounded-md border border-slate-200 p-1 enabled:hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={current >= pageCount}
                className="rounded-md border border-slate-200 p-1 enabled:hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
