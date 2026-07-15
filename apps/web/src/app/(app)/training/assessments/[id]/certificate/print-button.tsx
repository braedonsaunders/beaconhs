'use client'

import { GeneratedText } from '@/i18n/generated'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
    >
      <GeneratedText id="m_023edb6d8e74c3" />
    </button>
  )
}
