'use client'

// Trash button that confirms before submitting its (server-action) delete form.
// Matches the destructive-admin-action convention used across the app
// (window.confirm) so the rest of the list page stays server-rendered.

import { Trash2 } from 'lucide-react'

export function DeleteTemplateButton({ name }: { name: string }) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(`Delete the "${name}" email template? This can't be undone.`)) {
          e.preventDefault()
        }
      }}
      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
      title="Delete template"
    >
      <Trash2 size={15} />
    </button>
  )
}
