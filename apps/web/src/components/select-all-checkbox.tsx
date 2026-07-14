'use client'

export function SelectAllCheckbox({
  itemName,
  ariaLabel,
}: {
  itemName: string
  ariaLabel: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
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
