'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

import { useState } from 'react'
import { Button, Label } from '@beaconhs/ui'
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
  const [itemId, setItemId] = useState(initialItem?.value ?? '')
  const [itemOption, setItemOption] = useState<PickerOption | undefined>(initialItem)
  const [typeId, setTypeId] = useState(initialType?.value ?? '')
  const [typeOption, setTypeOption] = useState<PickerOption | undefined>(initialType)
  const equipmentTypeId =
    itemOption?.meta?.kind === 'equipment-inspection-item'
      ? (itemOption.meta.typeId ?? undefined)
      : undefined

  return (
    <form action={startEquipmentInspection} className="max-w-lg space-y-4">
      <input type="hidden" name="equipmentItemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />
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
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_102414366b6321" />
        </Label>
        <RemoteSearchSelect
          lookup="equipment-item-inspection-types"
          contextId={equipmentTypeId}
          value={typeId}
          initialOption={typeOption}
          onChange={setTypeId}
          onOptionChange={setTypeOption}
          disabled={!itemId}
          placeholder={tGenerated('m_00823ac933297d')}
          searchPlaceholder={tGenerated('m_18e2494ecfa1b5')}
          sheetTitle="Select inspection type"
          ariaLabel="Inspection type"
        />
      </div>
      <Button type="submit" disabled={!itemId || !typeId}>
        <GeneratedText id="m_050ae31d3122aa" />
      </Button>
    </form>
  )
}
