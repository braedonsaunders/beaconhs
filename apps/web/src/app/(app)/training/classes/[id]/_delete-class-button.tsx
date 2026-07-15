'use client'

import { GeneratedText } from '@/i18n/generated'

// Confirm-before-submit delete for the class record. Matches the destructive-
// action convention used across the app (confirmDialog) so the page stays
// server-rendered.

import { Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'

export function DeleteClassButton() {
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
      onClick={(e) => {
        e.preventDefault()
        const btn = e.currentTarget
        void confirmDialog({
          message:
            'Delete this class? This permanently removes it and its roster. This cannot be undone.',
          tone: 'danger',
        }).then((ok) => {
          if (ok) btn.form?.requestSubmit(btn)
        })
      }}
    >
      <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
    </Button>
  )
}
