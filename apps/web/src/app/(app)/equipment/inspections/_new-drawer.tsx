'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// "Start an inspection" flyout — no intermediary page.
//
// Two steps, in the same panel: what is being inspected, then which check. The
// check is NOT free choice on a registered unit: it is whatever is set up on
// that unit (its pre-use checklist plus its active schedules), so the options
// are searched remotely per item. Unregistered rental gear is pre-use only —
// we do not own its certification programme.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'
import type { PickerOption } from '@/lib/picker-options'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { startEquipmentInspection } from './_actions'

type TargetMode = 'registered' | 'rental'
export function NewEquipmentInspectionDrawer({
  initialItem,
  initialType,
  lockedItem = false,
  returnTo,
}: {
  initialItem?: PickerOption
  /** Pre-selected when a schedule's "Start" link named the inspection. */
  initialType?: PickerOption
  /** Started from a unit's own page: the equipment is fixed. */
  lockedItem?: boolean
  /** In-app path the started inspection should open over. Defaults to the register. */
  returnTo?: string
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const [targetMode, setTargetMode] = useState<TargetMode>('registered')
  const [itemId, setItemId] = useState(initialItem?.value ?? '')
  const [siteOrgUnitId, setSiteOrgUnitId] = useState('')
  const [rentalName, setRentalName] = useState('')
  const [rentalSerial, setRentalSerial] = useState('')
  const [rentalProvider, setRentalProvider] = useState('')
  const [typeId, setTypeId] = useState(initialType?.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const lookup =
    targetMode === 'rental'
      ? 'equipment-rental-inspection-types'
      : 'equipment-item-scheduled-inspection-types'
  const contextId = targetMode === 'registered' ? itemId : ''
  const ready = targetMode === 'registered' ? Boolean(itemId) : rentalName.trim().length > 0

  function startInspection() {
    if (pending || !ready || !typeId) return
    setError(null)
    const fd = new FormData()
    fd.set('targetMode', targetMode)
    fd.set('equipmentItemId', itemId)
    fd.set('typeId', typeId)
    fd.set('siteOrgUnitId', siteOrgUnitId)
    fd.set('rentalName', rentalName)
    fd.set('rentalSerial', rentalSerial)
    fd.set('rentalProvider', rentalProvider)
    if (returnTo) fd.set('returnTo', returnTo)
    start(async () => {
      try {
        await startEquipmentInspection(fd)
      } catch {
        setError('Could not start the inspection. Your entries are kept. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {lockedItem ? null : (
        <div className="space-y-2">
          <Label>
            <GeneratedText id="m_13d280882bc797" />
          </Label>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['registered', 'rental'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (mode === targetMode) return
                  setTargetMode(mode)
                  setTypeId('')
                  setError(null)
                }}
                className={
                  targetMode === mode
                    ? 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'rounded-md px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300'
                }
              >
                {mode === 'registered' ? (
                  <GeneratedText id="m_1145902d32ac68" />
                ) : (
                  <GeneratedText id="m_03bcd05f089364" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {targetMode === 'registered' ? (
        lockedItem ? null : (
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1fb2813300fb71" />
            </Label>
            <RemoteSearchSelect
              lookup="equipment-inspection-items"
              value={itemId}
              initialOption={initialItem}
              onChange={(value) => {
                setItemId(value)
                setTypeId('')
                setError(null)
              }}
              placeholder={tGenerated('m_115f6cd16bb283')}
              searchPlaceholder={tGenerated('m_05b2636288d921')}
              sheetTitle="Select equipment"
              ariaLabel="Equipment item"
            />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rentalName">
              <GeneratedText id="m_178a4669441c00" />
            </Label>
            <Input
              id="rentalName"
              value={rentalName}
              onChange={(e) => setRentalName(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalSerial">
              <GeneratedText id="m_0240a6c1ede8d7" />
            </Label>
            <Input
              id="rentalSerial"
              value={rentalSerial}
              onChange={(e) => setRentalSerial(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalProvider">
              <GeneratedText id="m_19500f7c2dec27" />
            </Label>
            <Input
              id="rentalProvider"
              value={rentalProvider}
              onChange={(e) => setRentalProvider(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              <GeneratedText id="m_055f11420b2da4" />
            </Label>
            {/* Same Locations list journals and hazard assessments use, so a
                rental can be booked against the customer it works for. */}
            <RemoteSearchSelect
              lookup="equipment-inspection-sites"
              value={siteOrgUnitId}
              onChange={setSiteOrgUnitId}
              placeholder={tGenerated('m_0616639a1daeee')}
              searchPlaceholder={tGenerated('m_1931aa93098220')}
              sheetTitle="Location"
              ariaLabel="Location"
            />
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Label>
          <GeneratedText id="m_102414366b6321" />
        </Label>

        <RemoteSearchSelect
          lookup={lookup}
          contextId={contextId || undefined}
          value={typeId}
          initialOption={targetMode === 'registered' ? initialType : undefined}
          onChange={(value) => {
            setTypeId(value)
            setError(null)
          }}
          disabled={pending || (targetMode === 'registered' && !itemId)}
          placeholder={tGeneratedValue('Select inspection type')}
          searchPlaceholder={tGenerated('m_18e2494ecfa1b5')}
          sheetTitle={tGeneratedValue('Select inspection type')}
          ariaLabel={tGeneratedValue('Inspection type')}
          clearable={false}
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              <GeneratedValue value={error} />
            </AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" onClick={startInspection} disabled={!ready || !typeId || pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : null}
          <GeneratedValue value="Start inspection" />
        </Button>
      </div>
    </div>
  )
}
