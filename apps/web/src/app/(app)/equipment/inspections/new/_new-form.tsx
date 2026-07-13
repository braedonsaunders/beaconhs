'use client'

// Start-inspection form: pick an equipment item + an inspection type, then the
// server action creates the record, materialises the criteria, and redirects to
// the fill page. SearchSelects back hidden inputs so the plain server-action
// form submits the ids. Type-restricted templates (appliesToTypeId) only show
// for items of that equipment type — the server action enforces the same rule.

import { useMemo, useState } from 'react'
import { Button, Label, SearchSelect } from '@beaconhs/ui'
import { startEquipmentInspection } from '../_actions'

type NewInspectionItemOption = {
  value: string
  label: string
  hint?: string
  typeId: string | null
}

type NewInspectionTypeOption = {
  value: string
  label: string
  hint?: string
  appliesToTypeId: string | null
}

export function NewInspectionForm({
  itemOptions,
  typeOptions,
  defaultItemId,
  defaultTypeId,
}: {
  itemOptions: NewInspectionItemOption[]
  typeOptions: NewInspectionTypeOption[]
  defaultItemId: string
  defaultTypeId: string
}) {
  const [itemId, setItemId] = useState(defaultItemId)
  const [typeId, setTypeId] = useState(defaultTypeId)

  const selectedItem = itemOptions.find((i) => i.value === itemId) ?? null
  const applicableTypes = useMemo(
    () =>
      typeOptions.filter(
        (t) =>
          !t.appliesToTypeId || (selectedItem != null && t.appliesToTypeId === selectedItem.typeId),
      ),
    [typeOptions, selectedItem],
  )
  // Clear a type that stops applying when the item changes.
  const effectiveTypeId = applicableTypes.some((t) => t.value === typeId) ? typeId : ''

  return (
    <form action={startEquipmentInspection} className="max-w-lg space-y-4">
      <input type="hidden" name="equipmentItemId" value={itemId} />
      <input type="hidden" name="typeId" value={effectiveTypeId} />
      <div className="space-y-1.5">
        <Label>Equipment item *</Label>
        <SearchSelect
          value={itemId}
          onChange={setItemId}
          options={itemOptions.map(({ value, label, hint }) => ({ value, label, hint }))}
          placeholder="Select equipment…"
          searchPlaceholder="Search by name or tag…"
          sheetTitle="Select equipment"
          ariaLabel="Equipment item"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Inspection type *</Label>
        <SearchSelect
          value={effectiveTypeId}
          onChange={setTypeId}
          options={applicableTypes.map(({ value, label, hint }) => ({ value, label, hint }))}
          placeholder="Select an inspection type…"
          searchPlaceholder="Search types…"
          sheetTitle="Select inspection type"
          ariaLabel="Inspection type"
        />
      </div>
      <Button type="submit" disabled={!itemId || !effectiveTypeId}>
        Start inspection
      </Button>
    </form>
  )
}
