'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { unstable_rethrow, useSearchParams } from 'next/navigation'
import { Badge, Button } from '@beaconhs/ui'
import { X, LoaderCircle } from 'lucide-react'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { Pagination } from '@/components/pagination'
import { RawImage } from '@/components/raw-image'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { toast } from '@/lib/toast'
import type { SigningRosterData } from '@/lib/hazid-signing-roster'
import type { PickerOption } from '@/lib/picker-options'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { addSigningCrew, requestCrewSignatures, startSigningCollection } from './_signing-actions'
import { deleteSignature } from './_actions'
import { CrewSearch } from './_signature-form'
import { CrewSignatureDrawer } from './_crew-signature-drawer'

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
  const search = useSearchParams()
  const query = new URLSearchParams({ crewPage: search.get('crewPage') ?? '1' }).toString()
  const [live, setLive] = useState({ query, initial, data: initial })
  const data = live.query === query && live.initial === initial ? live.data : initial
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<PickerOption[]>([])
  const addingValues = useRef(new Set<string>())
  const generation = useRef(0)
  const [drawer, setDrawer] = useState<{
    revision: number
    signers: { id: string; name: string }[]
    ready: boolean
  } | null>(null)
  async function refresh(signal?: AbortSignal) {
    const request = ++generation.current
    const response = await fetch(`/api/hazard-assessments/${assessmentId}/signatures?${query}`, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok)
      throw new Error('Could not refresh signatures. Your saved signatures are safe. Try again.')
    const next = (await response.json()) as SigningRosterData
    if (signal?.aborted || request !== generation.current) return
    setLive({ query, initial, data: next })
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
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })
  useEffect(() => {
    const controller = new AbortController()
    const requests = generation
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      if (!document.hidden) {
        try {
          await refreshRef.current(controller.signal)
        } catch (err) {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : 'Could not refresh signatures')
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
      requests.current++
    }
  }, [assessmentId, query, initial])
  async function sync() {
    try {
      await refreshRef.current()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh signatures')
    }
  }
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
  function add(option: PickerOption) {
    if (addingValues.current.has(option.value)) return
    addingValues.current.add(option.value)
    setAdding((rows) => [...rows, option])
    setError(null)
    const colon = option.value.indexOf(':')
    const kind = option.value.slice(0, colon),
      id = option.value.slice(colon + 1)
    void (async () => {
      try {
        unwrapSigningResult(
          await addSigningCrew({
            assessmentId,
            personIds: kind === 'person' ? [id] : [],
            groupId: kind === 'group' ? id : undefined,
            crewId: kind === 'crew' ? id : undefined,
            externalNames: kind === 'external' ? [id] : [],
          }),
        )
        await sync()
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Could not add the crew')
      } finally {
        addingValues.current.delete(option.value)
        setAdding((rows) => rows.filter((row) => row.value !== option.value))
      }
    })()
  }
  function sign(signerId?: string) {
    const signers = data.rows
      .filter((r) => !r.signedAt && r.active)
      .map((r) => ({ id: r.id, name: r.name }))
    if (signerId) signers.sort((a, b) => Number(b.id === signerId) - Number(a.id === signerId))
    setDrawer({ revision: data.revision, signers, ready: false })
    run(async () => {
      try {
        await flushRecordSaves()
        const result = unwrapSigningResult(await startSigningCollection(assessmentId, signerId))
        if (!result.signers.length) throw new Error('No active crew members are waiting to sign')
        if (signerId)
          result.signers.sort((a, b) => Number(b.id === signerId) - Number(a.id === signerId))
        setDrawer({ ...result, ready: true })
      } catch (err) {
        setDrawer(null)
        throw err
      }
    })
  }
  function request() {
    run(async () => {
      await flushRecordSaves()
      const result = unwrapSigningResult(await requestCrewSignatures(assessmentId))
      toast.success(`${result.requested} ${t('signature requests queued.')}`)
      if (result.skipped || result.withoutPush)
        toast.info(
          t('People without an account sign here. Phone notifications require permission.'),
        )
      await sync()
    })
  }
  return (
    <div className="space-y-3" data-walkthrough="hazid-signing">
      <p role="status" aria-live="polite" className="font-medium">
        <GeneratedValue value="Signed" /> {data.signed}/{data.crewTotal}
      </p>
      {canUpdate && !data.locked ? (
        <>
          <CrewSearch
            assessmentId={assessmentId}
            onAdd={add}
            pendingValues={adding.map((o) => o.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-11 w-full min-w-0"
              onClick={() => sign()}
              disabled={pending || !!adding.length || data.crewTotal === data.signed}
            >
              <GeneratedValue value="Sign" />
            </Button>
            <Button
              className="h-11 w-full min-w-0"
              variant="outline"
              onClick={request}
              disabled={pending || !!adding.length || data.crewTotal === data.signed}
            >
              <GeneratedValue value="Request" />
            </Button>
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {adding.map((option) => (
          <li key={option.value} className="space-y-2 rounded-lg border p-3 dark:border-slate-700">
            <p className="flex items-center justify-between font-medium">
              {option.label}
              <LoaderCircle size={14} className="animate-spin" aria-label={t('Saving…')} />
            </p>
            <Badge variant="outline">
              <GeneratedValue value="Awaiting signature" />
            </Badge>
          </li>
        ))}
        {data.rows.map((row) => (
          <li
            key={row.id}
            className="relative space-y-2 rounded-lg border p-3 dark:border-slate-700"
          >
            <p className="pr-8 font-medium">{row.name}</p>
            {canUpdate && !data.locked && !row.signedAt ? (
              <Button
                className="absolute top-1 right-1 h-9 w-9 p-0"
                variant="ghost"
                disabled={pending}
                aria-label={t('Remove')}
                onClick={() =>
                  run(async () => {
                    const fd = new FormData()
                    fd.set('id', row.id)
                    fd.set('assessmentId', assessmentId)
                    await deleteSignature(fd)
                    await sync()
                  })
                }
              >
                <X size={16} />
              </Button>
            ) : null}
            {row.image ? (
              <RawImage
                optimizationReason="authenticated"
                src={row.image}
                alt={t('Signature')}
                className="h-16 max-w-full object-contain dark:rounded dark:bg-white"
              />
            ) : canUpdate && !data.locked ? (
              <button
                type="button"
                disabled={pending || !row.active || !!adding.length}
                onClick={() => sign(row.id)}
                className="flex h-20 w-full items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-600"
              >
                <GeneratedValue
                  value={row.active ? 'Awaiting signature' : 'Person inactive — remove from crew'}
                />
              </button>
            ) : (
              <Badge variant="outline">
                <GeneratedValue value="Awaiting signature" />
              </Badge>
            )}
          </li>
        ))}
      </ul>
      {!data.rows.length && !adding.length ? (
        <p className="text-sm text-slate-500">
          <GeneratedValue value="Add crew to prepare their signature spaces." />
        </p>
      ) : null}
      <Pagination
        basePath={`/hazard-assessments/${assessmentId}`}
        currentParams={Object.fromEntries(search)}
        total={data.total}
        page={data.page}
        perPage={data.perPage}
        pageParamKey="crewPage"
      />
      {drawer ? (
        <CrewSignatureDrawer {...drawer} onSaved={sync} onClose={() => setDrawer(null)} />
      ) : null}
    </div>
  )
}
