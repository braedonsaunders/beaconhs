'use client'

import { useGeneratedTranslations } from '@/i18n/generated'

// Trash button that confirms before submitting its (server-action) delete form.
// Matches the destructive-admin-action convention used across the app
// (confirmDialog) so the rest of the list page stays server-rendered.

import { Trash2 } from 'lucide-react'
import { confirmDialog } from '@/lib/confirm'

export function DeleteTemplateButton({ name }: { name: string }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <button
      type="submit"
      onClick={(e) => {
        e.preventDefault()
        const btn = e.currentTarget
        void confirmDialog({
          message: `Delete the "${name}" email template? This can't be undone.`,
          tone: 'danger',
        }).then((ok) => {
          if (ok) btn.form?.requestSubmit(btn)
        })
      }}
      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
      title={tGenerated('m_1797f6aea6a185')}
    >
      <Trash2 size={15} />
    </button>
  )
}
