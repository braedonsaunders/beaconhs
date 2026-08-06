'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

// Start an equipment inspection from a flyout — no intermediary create page.
//
// The inspection a registered unit can run is NOT free choice: it is whatever
// is set up on the unit (its pre-use checklist plus its active schedules), so
// the type picker is scoped to the item rather than the tenant catalogue and
// disappears entirely once there is only one thing to run. Unregistered rental
// gear is pre-use only — we do not own its certification programme.

import { useState, useTransition } from 'react'
import { Button, Input, Label } from '@beaconhs/ui'
import type { PickerOption } from '@/lib/picker-options'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { startEquipmentInspection } from './_actions'

type TargetMode = 'registered' | 'rental'

export function NewEquipmentInspectionDrawer({
  initialItem,
  initialType,
  lockedItem = false,
}: {
  initialItem?: PickerOption
  /** Pre-selected when a schedule's "Start" link named the inspection. */
  initialType?: PickerOption
  /** Started from a unit's own page: the equipment is fixed. */
  lockedItem?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const [targetMode, setTargetMode] = useState<TargetMode>('registered')
  const [itemId, setItemId] = useState(initialItem?.value ?? '')
  const [typeId, setTypeId] = useState(initialType?.value ?? '')
  const [siteOrgUnitId, setSiteOrgUnitId] = useState('')
  const [pending, start] = useTransition()

  const ready = targetMode === 'registered' ? Boolean(itemId && typeId) : Boolean(typeId)

  return (
    <form
      id="equipment-new-inspection-form"
      action={(fd) => start(() => startEquipmentInspection(fd))}
      className="space-y-4"
    >
      <input type="hidden" name="targetMode" value={targetMode} />
      <input type="hidden" name="equipmentItemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="siteOrgUnitId" value={siteOrgUnitId} />

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
                  setTargetMode(mode)
                  setTypeId('')
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
              onChange={(next) => {
                setItemId(next)
                setTypeId('')
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
            <Input id="rentalName" name="rentalName" required maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalSerial">
              <GeneratedText id="m_0240a6c1ede8d7" />
            </Label>
            <Input id="rentalSerial" name="rentalSerial" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalProvider">
              <GeneratedText id="m_19500f7c2dec27" />
            </Label>
            <Input id="rentalProvider" name="rentalProvider" maxLength={200} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              <GeneratedText id="m_055f11420b2da4" />
            </Label>
            {/* Same Locations list journals and hazard assessments use, so a
                rental can be booked against the customer it is working for. */}
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

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_102414366b6321" />
        </Label>
        <RemoteSearchSelect
          lookup={
            targetMode === 'rental'
              ? 'equipment-rental-inspection-types'
              : 'equipment-item-scheduled-inspection-types'
          }
          contextId={targetMode === 'registered' ? itemId || undefined : undefined}
          value={typeId}
          initialOption={initialType}
          onChange={setTypeId}
          disabled={targetMode === 'registered' && !itemId}
          placeholder={tGenerated('m_00823ac933297d')}
          searchPlaceholder={tGenerated('m_18e2494ecfa1b5')}
          sheetTitle="Select inspection"
          ariaLabel="Inspection"
        />
        {targetMode === 'registered' && itemId ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_1d6b1d880eeeae" />
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={!ready || pending}>
        <GeneratedText id="m_050ae31d3122aa" />
      </Button>
    </form>
  )
}
