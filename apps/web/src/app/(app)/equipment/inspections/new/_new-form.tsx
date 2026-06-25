'use client'

// Start-inspection form: pick an equipment item + an inspection type, then the
// server action creates the record, materialises the criteria, and redirects to
// the fill page. SearchSelects back hidden inputs so the plain server-action
// form submits the ids.

import { useState } from 'react'
import { Button, Label, SearchSelect, type SelectOption } from '@beaconhs/ui'
import { startEquipmentInspection } from '../_actions'

export function NewInspectionForm({
  itemOptions,
  typeOptions,
  defaultItemId,
  defaultTypeId,
}: {
  itemOptions: SelectOption[]
  typeOptions: SelectOption[]
  defaultItemId: string
  defaultTypeId: string
}) {
  const [itemId, setItemId] = useState(defaultItemId)
  const [typeId, setTypeId] = useState(defaultTypeId)

  return (
    <form action={startEquipmentInspection} className="max-w-lg space-y-4">
      <input type="hidden" name="equipmentItemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />
      <div className="space-y-1.5">
        <Label>Equipment item *</Label>
        <SearchSelect
          value={itemId}
          onChange={setItemId}
          options={itemOptions}
          placeholder="Select equipment…"
          searchPlaceholder="Search by name or tag…"
          sheetTitle="Select equipment"
          ariaLabel="Equipment item"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Inspection type *</Label>
        <SearchSelect
          value={typeId}
          onChange={setTypeId}
          options={typeOptions}
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
