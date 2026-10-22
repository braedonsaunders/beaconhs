'use client'
import { useState, useTransition } from 'react'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { pickString } from '@/lib/list-params'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import {
  ServicePlanFields,
  STANDARD_SERVICE_METERS,
  type ServiceMeterOption,
} from '@/components/equipment/service-plan-fields'
import type { ServicePlanInput } from '@/lib/equipment/service-plans'
import { saveServicePlan, recordServiceCompletion, saveEquipmentMeter } from '../_service-actions'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'

type Plan = ServicePlanInput & { id: string; cycleId: string; lastCompletedOn: string | null }
export function ServiceDrawers({
  itemId,
  today,
  closeHref,
  drawer,
  editing,
  meters,
  readings,
}: {
  itemId: string
  today: string
  closeHref: string
  drawer: string | undefined
  editing: Plan | null
  meters: ServiceMeterOption[]
  readings: Record<string, number | null>
}) {
  const t = useGeneratedValueTranslations()
  return (
    <>
      <UrlDrawer
        open={drawer === 'service-new' || (drawer === 'service-edit' && !!editing)}
        closeHref={closeHref}
        title={t(editing ? 'Edit maintenance' : 'Add maintenance')}
        size="lg"
      >
        <ServiceEditor
          key={editing?.id ?? 'new'}
          itemId={itemId}
          today={today}
          closeHref={closeHref}
          editing={editing}
          meters={meters}
        />
      </UrlDrawer>
      <UrlDrawer
        open={drawer === 'service-complete' && !!editing}
        closeHref={closeHref}
        title={t('Record completed maintenance')}
        size="md"
      >
        {editing ? (
          <ServiceCompletion
            key={editing.cycleId}
            itemId={itemId}
            today={today}
            closeHref={closeHref}
            plan={editing}
            meters={meters}
            readings={readings}
          />
        ) : null}
      </UrlDrawer>
    </>
  )
}
function ServiceEditor({
  itemId,
  today,
  closeHref,
  editing,
  meters,
}: {
  itemId: string
  today: string
  closeHref: string
  editing: Plan | null
  meters: ServiceMeterOption[]
}) {
  const [value, setValue] = useState<ServicePlanInput>(
    editing ?? {
      name: '',
      rules: [{ kind: 'calendar', every: 3, unit: 'month', dueOn: today }],
      match: 'any',
      isActive: true,
    },
  )
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()
  const online = useOnlineAction()
  const t = useGeneratedValueTranslations()
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        start(async () => {
          await online('finish', async () => {
            try {
              const result = await saveServicePlan(itemId, value)
              if (!result.ok) {
                setError(result.error)
                return
              }
              router.push(closeHref as never, { scroll: false })
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not save maintenance.')
            }
          })
        })
      }}
    >
      <ServicePlanFields
        value={value}
        onChange={setValue}
        meters={meters}
        today={today}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        <GeneratedValue value={pending ? 'Saving…' : 'Save maintenance'} />
      </Button>
    </form>
  )
}
function ServiceCompletion({
  itemId,
  today,
  closeHref,
  plan,
  meters,
  readings,
}: {
  itemId: string
  today: string
  closeHref: string
  plan: Plan
  meters: ServiceMeterOption[]
  readings: Record<string, number | null>
}) {
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [amount, setAmount] = useState('')
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      Object.entries(readings).filter((v): v is [string, number] => v[1] !== null),
    ),
  )
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()
  const online = useOnlineAction()
  const t = useGeneratedValueTranslations()
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        start(async () => {
          await online('finish', async () => {
            try {
              const result = await recordServiceCompletion({
                itemId,
                planId: plan.id,
                cycleId: plan.cycleId,
                completedOn: date,
                notes,
                readings: values,
                amount,
              })
              if (!result.ok) {
                setError(result.error)
                return
              }
              router.push(closeHref as never, { scroll: false })
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not record maintenance.')
            }
          })
        })
      }}
    >
      <p className="font-medium">{plan.name}</p>
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Recording completion advances every condition from the completion date and readings. The previous cycle stays in the equipment log." />
      </p>
      <div>
        <Label htmlFor="service-completed">
          <GeneratedValue value="Completed on" />
        </Label>
        <Input
          id="service-completed"
          type="date"
          required
          min={plan.lastCompletedOn ?? '1902-01-01'}
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={pending}
        />
      </div>
      {[...STANDARD_SERVICE_METERS, ...meters].map((meter) => {
        const required = plan.rules.some((rule) => rule.kind === 'meter' && rule.meter === meter.id)
        return (
          <div key={meter.id}>
            <Label htmlFor={`completion-${meter.id}`}>
              {t(meter.name)} ({t(meter.unit)}){required ? ' *' : ''}
            </Label>
            <Input
              id={`completion-${meter.id}`}
              type="number"
              min={0}
              step={meter.id === 'odometer' ? 1 : meter.id === 'engine_hours' ? 0.1 : 0.001}
              required={required}
              value={values[meter.id] ?? ''}
              onChange={(e) =>
                setValues((previous) => {
                  const next = { ...previous }
                  if (e.target.value === '') delete next[meter.id]
                  else next[meter.id] = Number(e.target.value)
                  return next
                })
              }
              disabled={pending}
            />
          </div>
        )
      })}
      <div>
        <Label htmlFor="service-notes">
          <GeneratedValue value="Work performed / reference" />
        </Label>
        <Textarea
          id="service-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={5000}
          disabled={pending}
        />
      </div>
      <div>
        <Label htmlFor="service-cost">
          <GeneratedValue value="Cost (optional)" />
        </Label>
        <Input
          id="service-cost"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        <GeneratedValue value={pending ? 'Saving…' : 'Record completed'} />
      </Button>
    </form>
  )
}
export function ServiceCounters({
  itemId,
  meters,
  today,
  readings,
  currentParams,
}: {
  itemId: string
  meters: ServiceMeterOption[]
  today: string
  readings: Record<string, number | null>
  currentParams: Record<string, string | string[] | undefined>
}) {
  const [open, setOpen] = useState<ServiceMeterOption | null>(null)
  const query = pickString(currentParams.meter_q) ?? ''
  const page = Math.max(1, Math.floor(Number(pickString(currentParams.meter_page)) || 1))
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()
  const t = useGeneratedValueTranslations()
  const online = useOnlineAction()
  const allMeters = [
    ...STANDARD_SERVICE_METERS.map((m) => ({ ...m, value: readings[m.id] ?? null })),
    ...meters,
  ]
  const filtered = allMeters.filter((m) =>
    `${m.name} ${m.unit}`.toLowerCase().includes(query.toLowerCase()),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 8))
  const currentPage = Math.min(page, pages)
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">
          <GeneratedValue value="Usage counters" />
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setError('')
            setOpen({ id: crypto.randomUUID(), name: '', unit: '', value: null })
          }}
        >
          <GeneratedValue value="Add counter" />
        </Button>
      </div>
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Track cycles, tonnes, miles, or another cumulative measure. Update readings here; maintenance uses the latest saved reading. Engine hours and kilometres use the equipment's normal meters." />
      </p>
      <SearchInput
        paramKey="meter_q"
        pageParamKey="meter_page"
        placeholder={t('Search counters')}
      />
      {filtered.slice((currentPage - 1) * 8, currentPage * 8).map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
          <span>
            {m.name} · {m.value ?? '—'} {m.unit}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setError('')
              setOpen(m)
            }}
          >
            <GeneratedValue value="Update reading" />
          </Button>
        </div>
      ))}
      {!filtered.length ? (
        <p className="text-sm text-slate-500">
          <GeneratedValue value="No custom counters found." />
        </p>
      ) : null}
      <Pagination
        basePath={`/equipment/${itemId}`}
        currentParams={currentParams}
        page={currentPage}
        total={filtered.length}
        perPage={8}
        pageParamKey="meter_page"
      />
      {open ? (
        <CounterEditor
          key={open.id}
          itemId={itemId}
          meter={open}
          today={today}
          pending={pending}
          error={error}
          onClose={() => {
            if (!pending) setOpen(null)
          }}
          onSave={(m) => {
            start(async () => {
              await online('finish', async () => {
                try {
                  const result = await saveEquipmentMeter({ ...m, itemId, value: m.value ?? 0 })
                  if (result.ok) {
                    setOpen(null)
                    router.refresh()
                  } else setError(result.error)
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Could not save counter.')
                }
              })
            })
          }}
        />
      ) : null}
    </section>
  )
}
import { Drawer } from '@beaconhs/ui'
function CounterEditor({
  meter,
  onClose,
  onSave,
  pending,
  error,
}: {
  itemId: string
  meter: ServiceMeterOption
  today: string
  onClose: () => void
  onSave: (v: ServiceMeterOption) => void
  pending: boolean
  error: string
}) {
  const [value, setValue] = useState(meter)
  const t = useGeneratedValueTranslations()
  return (
    <Drawer open onClose={onClose} title={t('Usage counter')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(value)
        }}
      >
        <div>
          <Label>
            <GeneratedValue value="Counter name" />
          </Label>
          <Input
            required
            value={value.name}
            disabled={value.id === 'engine_hours' || value.id === 'odometer'}
            maxLength={120}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </div>
        <div>
          <Label>
            <GeneratedValue value="Counter unit" />
          </Label>
          <Input
            required
            value={value.unit}
            disabled={value.id === 'engine_hours' || value.id === 'odometer'}
            maxLength={40}
            onChange={(e) => setValue({ ...value, unit: e.target.value })}
          />
        </div>
        <div>
          <Label>
            <GeneratedValue value="Current reading" />
          </Label>
          <Input
            type="number"
            required
            min={0}
            step={value.id === 'odometer' ? 1 : value.id === 'engine_hours' ? 0.1 : 0.001}
            value={value.value ?? ''}
            onChange={(e) => setValue({ ...value, value: Number(e.target.value) })}
          />
        </div>
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Changing a reading does not rewrite maintenance history or next-due thresholds. Meter replacements must be reconciled with each affected maintenance plan." />
        </p>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {t(error)}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          <GeneratedValue value={pending ? 'Saving…' : 'Save counter'} />
        </Button>
      </form>
    </Drawer>
  )
}
