'use client'

import Link from 'next/link'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { useEffect, useState, useTransition } from 'react'
import { unstable_rethrow, useRouter, useSearchParams } from 'next/navigation'
import { Badge, Button, Select } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { RawImage } from '@/components/raw-image'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { toast } from '@/lib/toast'
import type { SigningRosterData } from '@/lib/hazid-signing-roster'
import { requestCrewSignatures, startSigningCollection } from './_signing-actions'
import { deleteSignature, unlockAssessment } from './_actions'

export function SigningRoster({
  assessmentId,
  initial,
  canUpdate,
}: {
  assessmentId: string
  initial: SigningRosterData
  canUpdate: boolean
}) {
  const t = useGeneratedValueTranslations()
  const router = useRouter(),
    search = useSearchParams()
  const query = search.toString()
  const [live, setLive] = useState({ query, initial, data: initial })
  const data = live.query === query && live.initial === initial ? live.data : initial
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let stopped = false,
      timer: ReturnType<typeof setTimeout>
    async function refresh() {
      if (!document.hidden) {
        try {
          const response = await fetch(
            `/api/hazard-assessments/${assessmentId}/signatures?${query}`,
            { cache: 'no-store', signal: controller.signal },
          )
          if (!response.ok)
            throw new Error(
              'Could not refresh signatures. Your saved signatures are safe. Try again.',
            )
          const next = (await response.json()) as SigningRosterData
          if (!stopped) {
            setLive({ query, initial, data: next })
            setError(null)
            window.dispatchEvent(
              new CustomEvent('hazid-signatures-updated', {
                detail: {
                  assessmentId,
                  signed: next.signed,
                  total: next.crewTotal,
                  revision: next.revision,
                },
              }),
            )
          }
        } catch (err) {
          if (!stopped)
            setError(err instanceof Error ? err.message : 'Could not refresh signatures')
        }
      }
      if (!stopped) timer = setTimeout(refresh, 4000)
    }
    void refresh()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [assessmentId, query, initial])
  function run(action: () => Promise<void>) {
    setError(null)
    start(async () => {
      try {
        await action()
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Could not save changes')
      }
    })
  }
  function collect(signerId?: string) {
    run(async () => {
      await flushRecordSaves()
      unwrapSigningResult(await startSigningCollection(assessmentId))
      router.push(
        `/hazard-assessments/${assessmentId}/collect${signerId ? `?signer=${signerId}` : ''}` as any,
      )
    })
  }
  function request() {
    run(async () => {
      await flushRecordSaves()
      const result = unwrapSigningResult(await requestCrewSignatures(assessmentId))
      const copy = `${result.requested} ${t('signature requests queued.')}${result.skipped ? ` ${result.skipped} ${t('crew members were skipped; use this phone for anyone without an account.')}` : ''}${result.withoutPush ? ` ${result.withoutPush} ${t('people have not enabled push on a device. Their request is in the notification inbox; email and SMS follow tenant settings.')}` : ''}`
      setMessage(copy)
      toast.success(t('Signature requests queued'))
    })
  }
  const params = Object.fromEntries(search)
  return (
    <div className="space-y-3" data-walkthrough="hazid-signing">
      <p role="status" aria-live="polite" className="font-medium">
        <GeneratedValue value="Signed" /> {data.signed}/{data.crewTotal} ·{' '}
        <GeneratedValue value="Revision" /> {data.revision}
      </p>
      {canUpdate && !data.locked ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/hazard-assessments/${assessmentId}?drawer=add-crew` as any}>
            <Button size="sm" variant="outline" disabled={pending}>
              <GeneratedValue value="Add crew" />
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => collect()}
            disabled={pending || data.crewTotal === data.signed}
          >
            <GeneratedValue value="Collect on this phone" />
          </Button>
          <Button size="sm" onClick={request} disabled={pending || data.crewTotal === data.signed}>
            <GeneratedValue value="Request / resend unsigned signatures" />
          </Button>
          {data.frozen ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                run(async () => {
                  if (
                    !window.confirm(
                      t(
                        'Start a new revision? Previous signatures stay in history. Everyone must review and sign again.',
                      ),
                    )
                  )
                    return
                  const fd = new FormData()
                  fd.set('id', assessmentId)
                  await unlockAssessment(fd)
                })
              }
              disabled={pending}
            >
              <GeneratedValue value="Start new revision" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {data.frozen ? (
        <p className="text-sm text-slate-500">
          <GeneratedValue value="Signing has started. The job content is frozen until you start a new revision." />
        </p>
      ) : null}
      <Link
        href={`/hazard-assessments/${assessmentId}/signing-history` as any}
        className="text-sm text-teal-700 underline dark:text-teal-300"
      >
        <GeneratedValue value="Signing history" />
      </Link>
      {message ? (
        <p
          role="status"
          className="rounded border border-teal-300 bg-teal-50 p-3 text-sm dark:bg-teal-950"
        >
          <GeneratedValue value={message} />
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput paramKey="crewQ" pageParamKey="crewPage" placeholder={t('Search crew…')} />
        <Select
          value={search.get('crewStatus') ?? ''}
          aria-label={t('Signature status')}
          onChange={(e) => {
            const next = new URLSearchParams(search)
            if (e.target.value) next.set('crewStatus', e.target.value)
            else next.delete('crewStatus')
            next.delete('crewPage')
            router.replace(`/hazard-assessments/${assessmentId}?${next}` as any, { scroll: false })
          }}
        >
          <option value="">{t('All signatures')}</option>
          <option value="awaiting">{t('Awaiting signature')}</option>
          <option value="signed">{t('Signed')}</option>
        </Select>
      </div>
      {!data.rows.length ? (
        <p className="text-sm text-slate-500">
          <GeneratedValue value="No crew members match. Add the crew to prepare their signature spaces." />
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((row) => (
            <li key={row.id} className="space-y-2 rounded-lg border p-3 dark:border-slate-700">
              <p className="font-medium">{row.name}</p>
              <Badge variant={row.signedAt ? 'success' : 'outline'}>
                <GeneratedValue
                  value={
                    row.signedAt
                      ? 'Signed'
                      : row.expiresAt && new Date(row.expiresAt) <= new Date()
                        ? 'Request expired'
                        : row.requestedAt
                          ? 'Requested · awaiting signature'
                          : 'Awaiting signature'
                  }
                />
              </Badge>
              {row.image ? (
                <RawImage
                  optimizationReason="authenticated"
                  src={row.image}
                  alt={t('Signature')}
                  className="h-16 max-w-full object-contain dark:rounded dark:bg-white"
                />
              ) : null}
              {!row.signedAt ? (
                <p className="text-xs text-slate-500">
                  <GeneratedValue
                    value={
                      !row.active
                        ? 'Person inactive — remove from crew'
                        : row.remoteAvailable
                          ? 'Can sign on own phone'
                          : 'Collect on this phone — no linked account'
                    }
                  />
                </p>
              ) : null}
              {canUpdate && !data.locked && !row.signedAt ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => collect(row.id)}
                    disabled={pending || !row.active}
                  >
                    <GeneratedValue value="Sign" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const fd = new FormData()
                        fd.set('id', row.id)
                        fd.set('assessmentId', assessmentId)
                        await deleteSignature(fd)
                      })
                    }
                  >
                    <GeneratedValue value="Remove" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination
        basePath={`/hazard-assessments/${assessmentId}`}
        currentParams={params}
        total={data.total}
        page={data.page}
        perPage={data.perPage}
        pageParamKey="crewPage"
      />
    </div>
  )
}
