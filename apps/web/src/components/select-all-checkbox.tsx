'use client'
import { useGeneratedValueTranslations } from '@/i18n/generated'

export function SelectAllCheckbox({
  itemName,
  ariaLabel,
}: {
  itemName: string
  ariaLabel: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <input
      type="checkbox"
      aria-label={tGeneratedValue(ariaLabel)}
      onChange={(event) => {
        const form = event.currentTarget.form
        if (!form) return
        for (const input of form.querySelectorAll<HTMLInputElement>(
          `input[type="checkbox"][name="${CSS.escape(itemName)}"]`,
        )) {
          input.checked = event.currentTarget.checked
        }
      }}
    />
  )
}
