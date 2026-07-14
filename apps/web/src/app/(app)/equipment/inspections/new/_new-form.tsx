'use client'

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
        <Label>Equipment item *</Label>
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
          placeholder="Select equipment…"
          searchPlaceholder="Search by name or tag…"
          sheetTitle="Select equipment"
          ariaLabel="Equipment item"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Inspection type *</Label>
        <RemoteSearchSelect
          lookup="equipment-item-inspection-types"
          contextId={equipmentTypeId}
          value={typeId}
          initialOption={typeOption}
          onChange={setTypeId}
          onOptionChange={setTypeOption}
          disabled={!itemId}
          placeholder="Select an inspection type…"
          searchPlaceholder="Search types…"
          sheetTitle="Select inspection type"
          ariaLabel="Inspection type"
        />
      </div>
      <Button type="submit" disabled={!itemId || !typeId}>
        Start inspection
      </Button>
    </form>
  )
}
