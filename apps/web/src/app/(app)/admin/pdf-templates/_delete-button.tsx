'use client'

// Trash button that confirms before submitting its (server-action) delete form.

import { Trash2 } from 'lucide-react'
import { confirmDialog } from '@/lib/confirm'

export function DeletePdfTemplateButton({ name }: { name: string }) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        e.preventDefault()
        const btn = e.currentTarget
        void confirmDialog({
          message: `Delete the "${name}" PDF template? This can't be undone.`,
          tone: 'danger',
        }).then((ok) => {
          if (ok) btn.form?.requestSubmit(btn)
        })
      }}
      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
      title="Delete template"
    >
      <Trash2 size={15} />
    </button>
  )
}
