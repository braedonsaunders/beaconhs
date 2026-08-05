'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

import { useState } from 'react'
import { Button, Input, Label } from '@beaconhs/ui'
import type { PickerOption } from '@/lib/picker-options'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { startEquipmentInspection } from '../_actions'

export function NewInspectionForm({
  initialItem,
  initialType,
}: {
  initialItem?: PickerOption
  initialType?: PickerOption
}) {
  const tGenerated = useGeneratedTranslations()
  const [targetMode, setTargetMode] = useState<'registered' | 'rental'>(
    initialItem ? 'registered' : 'registered',
  )
  const [itemId, setItemId] = useState(initialItem?.value ?? '')
  const [itemOption, setItemOption] = useState<PickerOption | undefined>(initialItem)
  const [typeId, setTypeId] = useState(initialType?.value ?? '')
  const [typeOption, setTypeOption] = useState<PickerOption | undefined>(initialType)
  const [siteOrgUnitId, setSiteOrgUnitId] = useState('')
  const equipmentTypeId =
    itemOption?.meta?.kind === 'equipment-inspection-item'
      ? (itemOption.meta.typeId ?? undefined)
      : undefined

  return (
    <form action={startEquipmentInspection} className="max-w-lg space-y-4">
      <input type="hidden" name="targetMode" value={targetMode} />
      <input type="hidden" name="equipmentItemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="siteOrgUnitId" value={siteOrgUnitId} />
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
                setTypeOption(undefined)
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
      {targetMode === 'registered' ? (
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
              setTypeOption(undefined)
              if (!next) setItemOption(undefined)
            }}
            onOptionChange={setItemOption}
            placeholder={tGenerated('m_115f6cd16bb283')}
            searchPlaceholder={tGenerated('m_05b2636288d921')}
            sheetTitle="Select equipment"
            ariaLabel="Equipment item"
          />
        </div>
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
              <GeneratedText id="m_102293438363d1" />
            </Label>
            <RemoteSearchSelect
              lookup="equipment-inspection-sites"
              value={siteOrgUnitId}
              onChange={setSiteOrgUnitId}
              placeholder={tGenerated('m_0616639a1daeee')}
              searchPlaceholder={tGenerated('m_1931aa93098220')}
              sheetTitle="Select site"
              ariaLabel="Inspection site"
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
              ? 'equipment-inspection-types'
              : 'equipment-item-inspection-types'
          }
          contextId={targetMode === 'registered' ? equipmentTypeId : undefined}
          value={typeId}
          initialOption={typeOption}
          onChange={setTypeId}
          onOptionChange={setTypeOption}
          disabled={targetMode === 'registered' && !itemId}
          placeholder={tGenerated('m_00823ac933297d')}
          searchPlaceholder={tGenerated('m_18e2494ecfa1b5')}
          sheetTitle="Select inspection type"
          ariaLabel="Inspection type"
        />
      </div>
      <Button type="submit" disabled={(targetMode === 'registered' && !itemId) || !typeId}>
        <GeneratedText id="m_050ae31d3122aa" />
      </Button>
    </form>
  )
}
