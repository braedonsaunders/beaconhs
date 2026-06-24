'use client'

// Confirm-before-submit delete for the class record. Matches the destructive-
// action convention used across the app (window.confirm) so the page stays
// server-rendered.

import { Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'

export function DeleteClassButton() {
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
      onClick={(e) => {
        if (
          !window.confirm(
            'Delete this class? This permanently removes it and its roster. This cannot be undone.',
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      <Trash2 size={14} /> Delete
    </Button>
  )
}
